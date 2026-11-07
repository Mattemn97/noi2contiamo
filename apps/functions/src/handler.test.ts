// La funzione `bank` con un magazzino in memoria e un Enable Banking finto: nessuna rete, nessun Firebase.
import { createVerify, generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createClient } from "./enableBanking.js";
import {
  handleBank,
  routeOf,
  type AuthState,
  type BankRequest,
  type Connection,
  type Deps,
  type Secrets,
  type Store,
} from "./handler.js";
import { makeJwt } from "./jwt.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

function memoryStore(roles: Record<string, "owner" | "member">) {
  const secrets = new Map<string, Secrets>();
  const states = new Map<string, AuthState>();
  const connections = new Map<string, Connection>();
  const store: Store = {
    role: async (f, uid) => roles[`${f}/${uid}`] ?? null,
    getSecrets: async (f) => secrets.get(f) ?? null,
    setSecrets: async (f, s) => void secrets.set(f, s),
    putAuthState: async (f, s, v) => void states.set(`${f}/${s}`, v),
    takeAuthState: async (f, s) => {
      const v = states.get(`${f}/${s}`) ?? null;
      states.delete(`${f}/${s}`);
      return v;
    },
    purgeAuthStates: async () => undefined,
    addConnection: async (f, c) => void connections.set(`${f}/${c.id}`, c),
    listConnections: async (f, uid) =>
      [...connections.entries()].filter(([k, c]) => k.startsWith(`${f}/`) && c.uid === uid).map(([, c]) => c),
    getConnection: async (f, id) => connections.get(`${f}/${id}`) ?? null,
    deleteConnection: async (f, id) => void connections.delete(`${f}/${id}`),
  };
  return { store, secrets, states, connections };
}

const calls: { url: URL; method: string; headers: Record<string, string>; body: unknown }[] = [];
const fakeFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : input.toString());
  const body = init?.body ? (JSON.parse(init.body as string) as unknown) : undefined;
  calls.push({ url, method: init?.method ?? "GET", headers: init?.headers as Record<string, string>, body });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
  if (url.pathname === "/aspsps")
    return json({
      aspsps: [{ name: "Banca Prova", country: "IT", logo: "x.png", maximum_consent_validity: 365 * 86400 }],
    });
  if (url.pathname === "/auth") return json({ url: "https://bank.example/login", authorization_id: "a" });
  if (url.pathname === "/sessions" && init?.method === "POST")
    return json({
      session_id: "sess-1",
      accounts: [
        { uid: "acc-1", account_id: { iban: "IT60X0542811101000000123456" }, name: "Conto", currency: "EUR" },
      ],
      access: { valid_until: "2099-01-01T00:00:00+00:00" },
    });
  if (url.pathname === "/sessions/sess-1") return new Response(null, { status: 204 });
  if (url.pathname === "/accounts/acc-1/transactions")
    return url.searchParams.get("continuation_key")
      ? json({ transactions: [{ entry_reference: "2" }], continuation_key: null })
      : json({ transactions: [{ entry_reference: "1" }], continuation_key: "k2" });
  return json({ message: "no" }, 404);
};

function setup(roles: Record<string, "owner" | "member"> = { "f1/anna": "owner", "f1/bruno": "member" }) {
  const mem = memoryStore(roles);
  let n = 0;
  const deps: Deps = {
    verifyToken: async (t) => (t.startsWith("tok-") ? t.slice(4) : null),
    store: mem.store,
    makeClient: (s) =>
      createClient(s.appId, s.privateKeyPem, { fetch: fakeFetch, now: () => 1_700_000_000_000 }),
    now: () => 1_700_000_000_000,
    randomState: () => `state-${String(++n)}`,
    newId: () => `conn-${String(n)}`,
  };
  const call = (
    uid: string | null,
    method: string,
    path: string,
    extra: { query?: Record<string, string>; body?: unknown } = {},
  ) =>
    handleBank(deps, {
      method,
      path,
      query: extra.query ?? {},
      body: extra.body,
      idToken: uid ? `tok-${uid}` : null,
    } satisfies BankRequest);
  return { ...mem, call };
}

describe("jwt", () => {
  it("è RS256 con kid, iss, aud e scadenza di un'ora", () => {
    const token = makeJwt("app-1", PEM, 1000);
    const [header, body, signature] = token.split(".") as [string, string, string];
    expect(JSON.parse(Buffer.from(header, "base64url").toString())).toEqual({
      typ: "JWT",
      alg: "RS256",
      kid: "app-1",
    });
    expect(JSON.parse(Buffer.from(body, "base64url").toString())).toEqual({
      iss: "enablebanking.com",
      aud: "api.enablebanking.com",
      iat: 1000,
      exp: 4600,
    });
    expect(
      createVerify("RSA-SHA256")
        .update(`${header}.${body}`)
        .verify(publicKey, Buffer.from(signature, "base64url")),
    ).toBe(true);
  });

  it("rifiuta una chiave che non è RSA", () => {
    expect(() => makeJwt("app-1", "non una chiave", 1)).toThrow();
  });
});

describe("percorsi", () => {
  it("toglie il nome della funzione e le barre", () => {
    expect(routeOf("/bank/connections/abc/")).toEqual(["connections", "abc"]);
    expect(routeOf("/status")).toEqual(["status"]);
  });
});

describe("funzione bank", () => {
  it("chiede l'accesso e l'appartenenza alla famiglia", async () => {
    const { call } = setup();
    expect((await call(null, "GET", "/status", { query: { familyId: "f1" } })).status).toBe(401);
    expect((await call("zoe", "GET", "/status", { query: { familyId: "f1" } })).status).toBe(403);
    expect((await call("anna", "GET", "/status", { query: { familyId: "altra" } })).status).toBe(403);
  });

  it("configura solo il proprietario, valida la chiave e non la restituisce mai", async () => {
    const { call, secrets } = setup();
    const body = { familyId: "f1", appId: "app-1", privateKeyPem: PEM };
    expect((await call("bruno", "GET", "/status", { query: { familyId: "f1" } })).body).toEqual({
      available: true,
      configured: false,
      canConfigure: false,
    });
    expect((await call("bruno", "PUT", "/config", { body })).status).toBe(403);
    expect((await call("anna", "PUT", "/config", { body: { ...body, privateKeyPem: "boh" } })).status).toBe(
      400,
    );
    const done = await call("anna", "PUT", "/config", { body });
    expect(done).toEqual({ status: 200, body: { configured: true } });
    expect(secrets.get("f1")).toEqual({ appId: "app-1", privateKeyPem: PEM.trim() });
    const status = await call("anna", "GET", "/status", { query: { familyId: "f1" } });
    expect(status.body).toEqual({ available: true, configured: true, canConfigure: true });
    expect(JSON.stringify(status)).not.toContain("PRIVATE");
  });

  it("senza configurazione risponde not_configured", async () => {
    const { call } = setup();
    const response = await call("anna", "GET", "/aspsps", { query: { familyId: "f1", country: "IT" } });
    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({ code: "not_configured" });
  });

  it("collega una banca, legge i movimenti con la paginazione e la scollega", async () => {
    const { call, states } = setup();
    await call("anna", "PUT", "/config", { body: { familyId: "f1", appId: "app-1", privateKeyPem: PEM } });
    calls.length = 0;

    const banks = await call("anna", "GET", "/aspsps", { query: { familyId: "f1", country: "IT" } });
    expect(banks.body).toEqual([{ name: "Banca Prova", country: "IT", logo: "x.png", maxConsentDays: 180 }]);

    const auth = await call("anna", "POST", "/auth", {
      body: {
        familyId: "f1",
        aspspName: "Banca Prova",
        country: "IT",
        redirectUrl: "http://localhost:5173/importa/banca",
      },
    });
    expect(auth).toEqual({ status: 200, body: { url: "https://bank.example/login" } });
    const sent = calls.find((c) => c.url.pathname === "/auth")?.body as {
      state: string;
      access: { valid_until: string };
    };
    expect(sent.state).toBe("state-1");
    expect(sent.access.valid_until).toBe(new Date(1_700_000_000_000 + 180 * 86_400_000).toISOString());
    expect(calls.every((c) => /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/.test(c.headers.Authorization ?? ""))).toBe(
      true,
    );

    // un altro membro non può usare lo stato di Anna
    expect(
      (await call("bruno", "POST", "/sessions", { body: { familyId: "f1", code: "c", state: "state-1" } }))
        .status,
    ).toBe(403);
    expect(states.size).toBe(0);
    await call("anna", "POST", "/auth", {
      body: {
        familyId: "f1",
        aspspName: "Banca Prova",
        country: "IT",
        redirectUrl: "http://x/importa/banca",
      },
    });
    const created = await call("anna", "POST", "/sessions", {
      body: { familyId: "f1", code: "codice", state: "state-2" },
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      bankName: "Banca Prova",
      accounts: [{ uid: "acc-1", iban: "IT60X0542811101000000123456" }],
    });
    expect(JSON.stringify(created.body)).not.toContain("sess-1");
    const connectionId = (created.body as { id: string }).id;

    expect(
      ((await call("anna", "GET", "/connections", { query: { familyId: "f1" } })).body as unknown[]).length,
    ).toBe(1);
    expect(
      ((await call("bruno", "GET", "/connections", { query: { familyId: "f1" } })).body as unknown[]).length,
    ).toBe(0);

    const query = {
      familyId: "f1",
      connectionId,
      accountUid: "acc-1",
      dateFrom: "2026-01-01",
      dateTo: "2026-02-01",
    };
    const txs = await call("anna", "GET", "/transactions", { query });
    expect(
      (txs.body as { transactions: { entry_reference: string }[] }).transactions.map(
        (t) => t.entry_reference,
      ),
    ).toEqual(["1", "2"]);
    expect(
      (await call("anna", "GET", "/transactions", { query: { ...query, accountUid: "altro" } })).status,
    ).toBe(404);
    expect((await call("bruno", "GET", "/transactions", { query })).status).toBe(404);
    expect(
      (await call("anna", "GET", "/transactions", { query: { ...query, dateFrom: "ieri" } })).status,
    ).toBe(400);

    const removed = await call("anna", "DELETE", `/connections/${connectionId}`, {
      query: { familyId: "f1" },
    });
    expect(removed.status).toBe(204);
    expect(calls.some((c) => c.method === "DELETE" && c.url.pathname === "/sessions/sess-1")).toBe(true);
    expect(
      ((await call("anna", "GET", "/connections", { query: { familyId: "f1" } })).body as unknown[]).length,
    ).toBe(0);
  });
});
