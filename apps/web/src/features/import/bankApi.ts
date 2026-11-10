// Client della connessione alla banca (feature 24). Il browser non può chiamare Enable Banking (niente CORS):
// parla con un backend che firma e inoltra, scelto dalla build: `/api/bank/` sul server Python, la Cloud
// Function `bank` su Firebase. La logica pura (righe, lotti) sta in `packages/core`; qui solo rete.
import { BankTransaction } from "@noi2contiamo/core";
import { logInfo, logWarn } from "../../debug/log";

export interface BankStatus {
  readonly configured: boolean;
  readonly canConfigure: boolean;
}

export interface BankAspsp {
  readonly name: string;
  readonly country: string;
  readonly logo: string | null;
  readonly maxConsentDays: number;
}

export interface BankAccount {
  readonly uid: string;
  readonly iban: string | null;
  readonly name: string;
  readonly currency: string;
}

export interface BankConnection {
  readonly id: string;
  readonly bankName: string;
  readonly country: string;
  readonly validUntil: string;
  readonly accounts: readonly BankAccount[];
}

/** Errore atteso del backend: `code` è not_configured, bank_error, consent_expired, forbidden, ... */
export class BankApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface TransactionsQuery {
  readonly familyId: string;
  readonly connectionId: string;
  readonly accountUid: string;
  readonly dateFrom: string;
  readonly dateTo: string;
}

export interface BankApi {
  /** Null = connessione non disponibile (rete, 404, risposta che non è JSON). */
  status(familyId: string): Promise<BankStatus | null>;
  saveConfig(input: { familyId: string; appId: string; privateKeyPem: string }): Promise<void>;
  aspsps(familyId: string, country: string): Promise<BankAspsp[]>;
  startAuth(input: {
    familyId: string;
    aspspName: string;
    country: string;
    redirectUrl: string;
  }): Promise<string>;
  createSession(input: { familyId: string; code: string; state: string }): Promise<BankConnection>;
  connections(familyId: string): Promise<BankConnection[]>;
  deleteConnection(familyId: string, id: string): Promise<void>;
  transactions(query: TransactionsQuery): Promise<{ transactions: BankTransaction[]; skipped: number }>;
}

export interface BankApiOptions {
  /** Con la barra finale: `/api/bank/` oppure `https://europe-west1-<progetto>.cloudfunctions.net/bank/`. */
  readonly baseUrl: string;
  /** Intestazioni di autenticazione per ogni richiesta (e il token CSRF sulle scritture). */
  readonly headers: (method: string) => Promise<Record<string, string>>;
  readonly fetch?: typeof globalThis.fetch;
  readonly statusTimeoutMs?: number;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

export function createBankApi(options: BankApiOptions): BankApi {
  const doFetch =
    options.fetch ?? ((input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init));

  async function call(
    method: string,
    path: string,
    query: Record<string, string> = {},
    body?: unknown,
    signal?: AbortSignal,
  ) {
    const url = `${options.baseUrl}${path}${Object.keys(query).length > 0 ? `?${new URLSearchParams(query).toString()}` : ""}`;
    const headers = {
      ...(await options.headers(method)),
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    };
    return doFetch(url, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal ? { signal } : {}),
    });
  }

  async function json(
    method: string,
    path: string,
    query: Record<string, string> = {},
    body?: unknown,
  ): Promise<unknown> {
    // Nel registro solo metodo, percorso ed esito: parametri e corpo possono contenere codici di accesso.
    const start = performance.now();
    const ms = () => Math.round(performance.now() - start);
    let response: Response;
    try {
      response = await call(method, path, query, body);
    } catch {
      logWarn("bank.call", { method, path, status: 0, duration: ms() });
      throw new BankApiError("bank_error", "Rete non raggiungibile", 0);
    }
    if (response.status === 204) {
      logInfo("bank.call", { method, path, status: 204, duration: ms() });
      return null;
    }
    const data: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const code = isObject(data) && typeof data.code === "string" ? data.code : "generic";
      const message = isObject(data) && typeof data.message === "string" ? data.message : "";
      logWarn("bank.call", { method, path, status: response.status, code, message, duration: ms() });
      throw new BankApiError(code, message, response.status);
    }
    logInfo("bank.call", { method, path, status: response.status, duration: ms() });
    return data;
  }

  const list = (data: unknown): Record<string, unknown>[] =>
    Array.isArray(data) ? data.filter(isObject) : [];
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const toConnection = (raw: Record<string, unknown>): BankConnection => ({
    id: str(raw.id),
    bankName: str(raw.bankName),
    country: str(raw.country),
    validUntil: str(raw.validUntil),
    accounts: list(raw.accounts).map((a) => ({
      uid: str(a.uid),
      iban: typeof a.iban === "string" ? a.iban : null,
      name: str(a.name),
      currency: str(a.currency) || "EUR",
    })),
  });

  return {
    async status(familyId) {
      const controller = new AbortController();
      const timer = setTimeout(() => {
        controller.abort();
      }, options.statusTimeoutMs ?? 4000);
      try {
        const response = await call("GET", "status", { familyId }, undefined, controller.signal);
        if (!response.ok) return null;
        const data: unknown = await response.json();
        if (!isObject(data) || data.available !== true) return null;
        return { configured: data.configured === true, canConfigure: data.canConfigure === true };
      } catch {
        return null;
      } finally {
        clearTimeout(timer);
      }
    },
    async saveConfig(input) {
      await json("PUT", "config", {}, input);
    },
    async aspsps(familyId, country) {
      const data = await json("GET", "aspsps", { familyId, country });
      return list(data).map((b) => ({
        name: str(b.name),
        country: str(b.country) || country,
        logo: typeof b.logo === "string" ? b.logo : null,
        maxConsentDays: typeof b.maxConsentDays === "number" ? b.maxConsentDays : 90,
      }));
    },
    async startAuth(input) {
      const data = await json("POST", "auth", {}, input);
      const url = isObject(data) ? str(data.url) : "";
      if (!url) throw new BankApiError("bank_error", "", 502);
      return url;
    },
    async createSession(input) {
      const data = await json("POST", "sessions", {}, input);
      if (!isObject(data)) throw new BankApiError("bank_error", "", 502);
      return toConnection(data);
    },
    async connections(familyId) {
      return list(await json("GET", "connections", { familyId })).map(toConnection);
    },
    async deleteConnection(familyId, id) {
      await json("DELETE", `connections/${encodeURIComponent(id)}`, { familyId });
    },
    async transactions(query) {
      const data = await json("GET", "transactions", { ...query });
      const raw = isObject(data) && Array.isArray(data.transactions) ? (data.transactions as unknown[]) : [];
      const parsed = raw.map((item) => BankTransaction.safeParse(item));
      return {
        transactions: parsed.flatMap((p) => (p.success ? [p.data] : [])),
        skipped: parsed.filter((p) => !p.success).length,
      };
    },
  };
}

/**
 * Il client della build: server Python → `/api/bank/` con cookie di sessione e token CSRF; Firebase → la funzione
 * `bank` con il token di accesso. Con l'emulatore Firebase la funzione non c'è: connessione non disponibile.
 */
export function createDefaultBankApi(): BankApi {
  if (import.meta.env.VITE_BACKEND === "demo") return unavailableApi;
  if (import.meta.env.VITE_BACKEND === "firebase") {
    const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
    if (import.meta.env.VITE_USE_FIREBASE_EMULATOR === "true" || !projectId) return unavailableApi;
    return createBankApi({
      baseUrl: `https://europe-west1-${projectId}.cloudfunctions.net/bank/`,
      headers: async () => {
        const { getAuth } = await import("firebase/auth");
        const token = await getAuth().currentUser?.getIdToken();
        return token ? { Authorization: `Bearer ${token}` } : {};
      },
    });
  }
  let csrf: string | null = null;
  return createBankApi({
    baseUrl: "/api/bank/",
    headers: async (method) => {
      if (method === "GET") return {};
      if (csrf === null) {
        const response = await fetch("/api/v1/auth/session");
        const data: unknown = await response.json();
        csrf = isObject(data) && typeof data.csrfToken === "string" ? data.csrfToken : "";
      }
      return { "X-CSRF-Token": csrf };
    },
  });
}

const unavailableApi: BankApi = {
  status: () => Promise.resolve(null),
  saveConfig: () => Promise.reject(new BankApiError("bank_error", "", 0)),
  aspsps: () => Promise.reject(new BankApiError("bank_error", "", 0)),
  startAuth: () => Promise.reject(new BankApiError("bank_error", "", 0)),
  createSession: () => Promise.reject(new BankApiError("bank_error", "", 0)),
  connections: () => Promise.resolve([]),
  deleteConnection: () => Promise.resolve(),
  transactions: () => Promise.reject(new BankApiError("bank_error", "", 0)),
};
