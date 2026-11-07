// La logica della funzione `bank` (open banking, feature 24), senza Firebase: tutto ciò che tocca il mondo
// (token, Firestore, rete) entra da `Deps`, così si prova con dati finti. Stessa API di /api/bank del server Python.
import {
  BankError,
  consentDays,
  createClient,
  type EnableBankingClient,
  type SessionSummary,
} from "./enableBanking.js";

export interface Secrets {
  readonly appId: string;
  readonly privateKeyPem: string;
}

export interface Connection {
  readonly id: string;
  readonly uid: string;
  readonly sessionId: string;
  readonly bankName: string;
  readonly country: string;
  readonly validUntil: string;
  readonly accounts: SessionSummary["accounts"];
  readonly createdAtMs: number;
}

export interface AuthState {
  readonly uid: string;
  readonly aspspName: string;
  readonly country: string;
  readonly createdAtMs: number;
}

/** Il magazzino: `bankingSecrets/{familyId}` e le sue sottoraccolte, che solo l'Admin SDK può leggere. */
export interface Store {
  /** Il ruolo di chi ha un accesso alla famiglia (`families/{f}/access/{uid}`), null se non è membro. */
  role(familyId: string, uid: string): Promise<"owner" | "member" | null>;
  getSecrets(familyId: string): Promise<Secrets | null>;
  setSecrets(familyId: string, secrets: Secrets): Promise<void>;
  putAuthState(familyId: string, state: string, value: AuthState): Promise<void>;
  /** Legge e cancella lo stato: si usa una volta sola. */
  takeAuthState(familyId: string, state: string): Promise<AuthState | null>;
  purgeAuthStates(familyId: string, olderThanMs: number): Promise<void>;
  addConnection(familyId: string, connection: Connection): Promise<void>;
  listConnections(familyId: string, uid: string): Promise<Connection[]>;
  getConnection(familyId: string, id: string): Promise<Connection | null>;
  deleteConnection(familyId: string, id: string): Promise<void>;
}

export interface Deps {
  readonly verifyToken: (idToken: string) => Promise<string | null>;
  readonly store: Store;
  readonly makeClient?: (secrets: Secrets) => EnableBankingClient;
  readonly now?: () => number;
  readonly randomState?: () => string;
  readonly newId?: () => string;
}

export interface BankRequest {
  readonly method: string;
  readonly path: string;
  readonly query: Readonly<Record<string, string>>;
  readonly body: unknown;
  readonly idToken: string | null;
}

export interface BankResponse {
  readonly status: number;
  readonly body?: unknown;
}

const STATE_TTL_MS = 30 * 60 * 1000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const COUNTRY = /^[A-Z]{2}$/;
const DAY_MS = 86_400_000;

const reply = (status: number, body?: unknown): BankResponse => ({ status, body });
const fail = (status: number, code: string, message: string): BankResponse =>
  reply(status, { code, message });
const STATUS_OF: Record<string, number> = { not_configured: 409, consent_expired: 409, bank_error: 502 };
const bankFailure = (error: BankError) => fail(STATUS_OF[error.code] ?? 502, error.code, error.message);

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;
const text = (body: unknown, key: string, max: number): string | null => {
  const value = isObject(body) ? body[key] : undefined;
  return typeof value === "string" && value.length > 0 && value.length <= max ? value : null;
};

/** Il percorso senza barre in fondo e senza il nome della funzione, se il proxy lo lascia. */
export function routeOf(path: string): string[] {
  return path
    .split("/")
    .filter((s) => s !== "")
    .filter((s, i) => !(i === 0 && s === "bank"));
}

export async function handleBank(deps: Deps, req: BankRequest): Promise<BankResponse> {
  const now = deps.now ?? Date.now;
  const makeClient = deps.makeClient ?? ((s: Secrets) => createClient(s.appId, s.privateKeyPem));
  const { store } = deps;
  const [head, id] = routeOf(req.path);

  const uid = req.idToken ? await deps.verifyToken(req.idToken) : null;
  if (!uid) return fail(401, "unauthenticated", "Accedi per usare la banca.");

  const familyId =
    req.method === "GET" || req.method === "DELETE" ? req.query.familyId : text(req.body, "familyId", 128);
  if (!familyId || !/^[\w-]{1,128}$/.test(familyId)) return fail(400, "invalid", "Manca la famiglia.");
  const role = await store.role(familyId, uid);
  if (role === null) return fail(403, "forbidden", "Non fai parte di questa famiglia.");

  const secrets = await store.getSecrets(familyId);
  const client = () => {
    if (!secrets)
      throw new BankError("not_configured", "Open banking non è configurato per questa famiglia.");
    return makeClient(secrets);
  };

  try {
    if (head === "status" && req.method === "GET")
      return reply(200, { available: true, configured: secrets !== null, canConfigure: role === "owner" });

    if (head === "config" && req.method === "PUT") {
      if (role !== "owner")
        return fail(403, "forbidden", "Solo il proprietario della famiglia può configurare la banca.");
      const appId = text(req.body, "appId", 200);
      const privateKeyPem = text(req.body, "privateKeyPem", 20_000);
      if (!appId || !privateKeyPem || !privateKeyPem.includes("PRIVATE KEY"))
        return fail(400, "invalid", "Servono l'App ID e la chiave privata (file private.key).");
      const candidate = { appId: appId.trim(), privateKeyPem: privateKeyPem.trim() };
      try {
        await makeClient(candidate).aspsps("IT");
      } catch (error) {
        if (error instanceof BankError)
          return fail(400, "bank_error", `Enable Banking non accetta queste credenziali: ${error.message}`);
        throw error;
      }
      await store.setSecrets(familyId, candidate);
      return reply(200, { configured: true });
    }

    if (head === "aspsps" && req.method === "GET") {
      const country = req.query.country ?? "";
      if (!COUNTRY.test(country)) return fail(400, "invalid", "Paese non valido.");
      const banks = await client().aspsps(country);
      return reply(
        200,
        banks.map((b) => ({
          name: b.name,
          country: b.country ?? country,
          logo: b.logo ?? null,
          maxConsentDays: consentDays(b.maximum_consent_validity),
        })),
      );
    }

    if (head === "auth" && req.method === "POST") {
      const aspspName = text(req.body, "aspspName", 200);
      const country = text(req.body, "country", 2);
      const redirectUrl = text(req.body, "redirectUrl", 1000);
      if (!aspspName || !country || !COUNTRY.test(country) || !redirectUrl)
        return fail(400, "invalid", "Richiesta di collegamento non valida.");
      const eb = client();
      const bank = (await eb.aspsps(country)).find((b) => b.name === aspspName);
      const days = consentDays(bank?.maximum_consent_validity);
      const state = (
        deps.randomState ??
        (() => crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", ""))
      )();
      const url = await eb.startAuth({
        aspspName,
        country,
        redirectUrl,
        state,
        validUntil: new Date(now() + days * DAY_MS).toISOString(),
      });
      if (!url) return fail(502, "bank_error", "Enable Banking non ha dato l'indirizzo della banca.");
      await store.purgeAuthStates(familyId, now() - STATE_TTL_MS);
      await store.putAuthState(familyId, state, { uid, aspspName, country, createdAtMs: now() });
      return reply(200, { url });
    }

    if (head === "sessions" && req.method === "POST") {
      const code = text(req.body, "code", 2000);
      const state = text(req.body, "state", 128);
      if (!code || !state) return fail(400, "invalid", "Mancano codice o stato.");
      const saved = await store.takeAuthState(familyId, state);
      if (!saved || saved.uid !== uid || saved.createdAtMs < now() - STATE_TTL_MS)
        return fail(403, "forbidden", "Richiesta di collegamento non riconosciuta o scaduta.");
      const session = await client().createSession(code);
      if (!session.sessionId) return fail(502, "bank_error", "Enable Banking non ha creato la sessione.");
      const connection: Connection = {
        id: (deps.newId ?? (() => crypto.randomUUID()))(),
        uid,
        sessionId: session.sessionId,
        bankName: saved.aspspName,
        country: saved.country,
        validUntil: session.validUntil,
        accounts: session.accounts,
        createdAtMs: now(),
      };
      await store.addConnection(familyId, connection);
      return reply(200, publicConnection(connection));
    }

    if (head === "connections" && req.method === "GET" && id === undefined) {
      const all = await store.listConnections(familyId, uid);
      return reply(200, all.map(publicConnection));
    }

    if (head === "connections" && req.method === "DELETE" && id !== undefined) {
      const connection = await store.getConnection(familyId, id);
      if (!connection || connection.uid !== uid) return fail(404, "not_found", "Collegamento non trovato.");
      try {
        await client().deleteSession(connection.sessionId);
      } catch {
        // Sessione già scaduta o chiave cambiata: si toglie comunque il collegamento.
      }
      await store.deleteConnection(familyId, id);
      return reply(204);
    }

    if (head === "transactions" && req.method === "GET") {
      const { connectionId = "", accountUid = "", dateFrom = "", dateTo = "" } = req.query;
      if (!ISO_DAY.test(dateFrom) || !ISO_DAY.test(dateTo) || !accountUid || !connectionId)
        return fail(400, "invalid", "Parametri non validi.");
      const connection = await store.getConnection(familyId, connectionId);
      if (!connection || connection.uid !== uid || !connection.accounts.some((a) => a.uid === accountUid))
        return fail(404, "not_found", "Conto non trovato.");
      if (connection.validUntil && connection.validUntil < new Date(now()).toISOString())
        return fail(409, "consent_expired", "Il consenso alla banca è scaduto: collega di nuovo la banca.");
      return reply(200, { transactions: await client().transactions(accountUid, dateFrom, dateTo) });
    }
  } catch (error) {
    if (error instanceof BankError) return bankFailure(error);
    throw error;
  }
  return fail(404, "not_found", "Percorso sconosciuto.");
}

function publicConnection(c: Connection) {
  return {
    id: c.id,
    bankName: c.bankName,
    country: c.country,
    validUntil: c.validUntil,
    accounts: c.accounts,
  };
}
