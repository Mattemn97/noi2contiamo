// Client di Enable Banking (stesso comportamento di server/src/noi2contiamo_server/enable_banking.py).
import { makeJwt } from "./jwt.js";

const BASE_URL = "https://api.enablebanking.com";
const MAX_CONSENT_DAYS = 180;
const MAX_PAGES = 50;

export type BankErrorCode = "not_configured" | "bank_error" | "consent_expired";

export class BankError extends Error {
  constructor(
    readonly code: BankErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export interface Aspsp {
  readonly name: string;
  readonly country?: string;
  readonly logo?: string;
  readonly maximum_consent_validity?: number;
}

export interface SessionSummary {
  readonly sessionId: string;
  readonly validUntil: string;
  readonly accounts: readonly { uid: string; iban: string | null; name: string; currency: string }[];
}

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null;
const asString = (value: unknown): string => (typeof value === "string" ? value : "");

/** `maximum_consent_validity` è in secondi; un valore piccolo si legge come giorni. Mai oltre 180. */
export function consentDays(maxValidity: unknown): number {
  if (typeof maxValidity === "number" && Number.isInteger(maxValidity) && maxValidity > 0) {
    const days = maxValidity > 3650 ? Math.floor(maxValidity / 86400) : maxValidity;
    return Math.max(1, Math.min(days, MAX_CONSENT_DAYS));
  }
  return 90;
}

export function summarizeSession(data: Json): SessionSummary {
  const accounts = (Array.isArray(data.accounts) ? (data.accounts as unknown[]) : []).flatMap((a) => {
    if (!isObject(a) || !asString(a.uid)) return [];
    const iban = isObject(a.account_id) ? asString(a.account_id.iban) : "";
    return [
      {
        uid: asString(a.uid),
        iban: iban || null,
        name: asString(a.name) || asString(a.product),
        currency: asString(a.currency) || "EUR",
      },
    ];
  });
  return {
    sessionId: asString(data.session_id),
    validUntil: isObject(data.access) ? asString(data.access.valid_until) : "",
    accounts,
  };
}

export interface ClientOptions {
  readonly fetch?: typeof fetch;
  readonly now?: () => number;
}

export function createClient(appId: string, privateKeyPem: string, options: ClientOptions = {}) {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? Date.now;

  async function request(
    method: string,
    path: string,
    init: { query?: Record<string, string>; body?: unknown } = {},
  ) {
    let token: string;
    try {
      token = makeJwt(appId, privateKeyPem, Math.floor(now() / 1000));
    } catch {
      throw new BankError("not_configured", "La chiave privata non è valida.");
    }
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(init.query ?? {})) url.searchParams.set(key, value);
    let response: Response;
    try {
      response = await doFetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        signal: AbortSignal.timeout(30_000),
      });
    } catch {
      throw new BankError("bank_error", "Enable Banking non risponde.");
    }
    const text = await response.text();
    if ([401, 403, 410].includes(response.status) && text.toLowerCase().includes("expired"))
      throw new BankError("consent_expired", "Il consenso alla banca è scaduto: collega di nuovo la banca.");
    let parsed: unknown;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch {
      parsed = undefined;
    }
    if (response.status >= 400) {
      const detail = isObject(parsed) ? asString(parsed.message) || asString(parsed.error) : "";
      throw new BankError("bank_error", detail || `Enable Banking ha risposto ${String(response.status)}.`);
    }
    if (!isObject(parsed)) throw new BankError("bank_error", "Risposta non valida da Enable Banking.");
    return parsed;
  }

  return {
    async aspsps(country: string): Promise<Aspsp[]> {
      const data = await request("GET", "/aspsps", { query: { country, psu_type: "personal" } });
      return (Array.isArray(data.aspsps) ? (data.aspsps as unknown[]) : []).flatMap((b) =>
        isObject(b) && asString(b.name) ? [b as unknown as Aspsp] : [],
      );
    },
    async startAuth(input: {
      aspspName: string;
      country: string;
      redirectUrl: string;
      state: string;
      validUntil: string;
    }): Promise<string> {
      const data = await request("POST", "/auth", {
        body: {
          access: { valid_until: input.validUntil },
          aspsp: { name: input.aspspName, country: input.country },
          state: input.state,
          redirect_url: input.redirectUrl,
          psu_type: "personal",
        },
      });
      return asString(data.url);
    },
    async createSession(code: string): Promise<SessionSummary> {
      return summarizeSession(await request("POST", "/sessions", { body: { code } }));
    },
    async deleteSession(sessionId: string): Promise<void> {
      await request("DELETE", `/sessions/${encodeURIComponent(sessionId)}`);
    },
    /** Tutte le pagine, seguendo `continuation_key`. */
    async transactions(accountUid: string, dateFrom: string, dateTo: string): Promise<Json[]> {
      const out: Json[] = [];
      let query: Record<string, string> = { date_from: dateFrom, date_to: dateTo };
      for (let page = 0; page < MAX_PAGES; page++) {
        const data = await request("GET", `/accounts/${encodeURIComponent(accountUid)}/transactions`, {
          query,
        });
        out.push(
          ...(Array.isArray(data.transactions) ? (data.transactions as unknown[]).filter(isObject) : []),
        );
        const key = asString(data.continuation_key);
        if (!key) break;
        query = { date_from: dateFrom, date_to: dateTo, continuation_key: key };
      }
      return out;
    },
  };
}

export type EnableBankingClient = ReturnType<typeof createClient>;
