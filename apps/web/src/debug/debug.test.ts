import { newId } from "@noi2contiamo/core";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DataQueryError } from "../data/queries";
import { errorCode } from "./errorCode";
import { applyDebugParam, isDebugEnabled, logError, logInfo, setDebugEnabled } from "./log";
import { summarizeOps, withLogging } from "./loggedAdapter";
import { describeError, HIDDEN, redact, safeText, shortId } from "./redact";

describe("redact", () => {
  it("lascia passare solo i campi tecnici e nasconde tutto il resto", () => {
    expect(
      redact({
        collection: "transactions",
        count: 3,
        ok: true,
        description: "Cena da Mario",
        amountCents: 4500,
        email: "anna@example.com",
        familyId: "0192f3a4-aaaa-bbbb-cccc-1234567890ab",
      }),
    ).toEqual({
      collection: "transactions",
      count: 3,
      ok: true,
      description: HIDDEN,
      amountCents: HIDDEN,
      email: HIDDEN,
      familyId: "0192f3a4…",
    });
  });

  it("filtra anche dentro oggetti e liste, e taglia le liste lunghe", () => {
    const out = redact({
      error: { code: "invalid", issues: [{ path: "payeeId", message: "x", value: "segreto" }] },
    });
    expect(out).toEqual({
      error: { code: "invalid", issues: [{ path: "payeeId", message: "x", value: HIDDEN }] },
    });
    const many = redact({ issues: Array.from({ length: 25 }, (_, i) => ({ path: String(i) })) });
    expect((many.issues as unknown[]).at(-1)).toBe("… altri 5");
  });

  it("maschera email, IBAN, numeri lunghi e token anche nei messaggi", () => {
    const text = safeText(
      "utente anna@example.com IBAN IT60X0542811101000000123456 carta 4111111111111111 Bearer abc.def.ghi",
    );
    expect(text).not.toMatch(/anna@|IT60X|4111111111111111|abc\.def/);
    expect(text).toContain("[email]");
    expect(safeText("x".repeat(500))).toHaveLength(201);
    expect(shortId("abc")).toBe("abc");
  });

  it("riduce un errore a nome, codice e messaggio filtrati", () => {
    const error = Object.assign(new Error("permesso negato per anna@example.com"), {
      code: "permission-denied",
    });
    expect(describeError(error)).toEqual({
      errorName: "Error",
      message: "permesso negato per [email]",
      code: "permission-denied",
    });
    expect(describeError(new DataQueryError({ code: "forbidden" }))).toMatchObject({
      errorName: "DataQueryError",
      error: { code: "forbidden" },
    });
  });
});

describe("registro", () => {
  beforeEach(() => {
    setDebugEnabled(false);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    setDebugEnabled(false);
  });

  it("scrive i dettagli solo se acceso, gli errori sempre", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    logInfo("prova", { count: 1 });
    expect(info).not.toHaveBeenCalled();
    logError("guasto", new Error("x"));
    expect(error).toHaveBeenCalledOnce();
    applyDebugParam("?debug=1");
    expect(isDebugEnabled()).toBe(true);
    logInfo("prova", { count: 1 });
    expect(info).toHaveBeenCalledWith("[N2C]", expect.any(String), "prova", { count: 1 });
    applyDebugParam("?debug=0");
    expect(isDebugEnabled()).toBe(false);
  });

  it("l'adapter registrato non scrive mai documenti, email, password o token", async () => {
    setDebugEnabled(true);
    const lines: string[] = [];
    const capture = (...args: unknown[]) => {
      lines.push(JSON.stringify(args));
    };
    vi.spyOn(console, "info").mockImplementation(capture);
    vi.spyOn(console, "warn").mockImplementation(capture);
    vi.spyOn(console, "error").mockImplementation(capture);

    const adapter = withLogging(createMemoryAdapter());
    await adapter.auth.signUp("anna.segreta@example.com", "password-segretissima");
    const familyId = newId();
    const created = await adapter.membership.createFamily({
      family: { id: familyId, name: "Famiglia Segreta" },
      ownerMember: { id: newId(), displayName: "Anna Segreta" },
      defaults: { categories: [] },
    });
    expect(created.ok).toBe(true);
    const account = await adapter.put(familyId, "accounts", {
      id: newId(),
      name: "Conto Segreto",
      kind: "checking",
      initialBalanceDate: "2026-01-01",
      initialBalanceCents: 987654,
    });
    if (!account.ok) throw new Error("conto");
    const invite = await adapter.membership.createInvite(familyId, { id: newId() });
    if (!invite.ok) throw new Error("invito");
    await adapter.membership.acceptInvite(invite.value.token, "Bruno");
    await adapter.list(familyId, "accounts");

    const all = lines.join("\n");
    for (const secret of [
      "anna.segreta",
      "password-segretissima",
      "Famiglia Segreta",
      "Anna Segreta",
      "Conto Segreto",
      "987654",
      invite.value.token,
    ])
      expect(all).not.toContain(secret);
    expect(all).toContain("data.put");
    expect(all).toContain("accounts");
  });

  it("riassume un commit per collezione senza contenuti", () => {
    expect(
      summarizeOps([
        { type: "put", collection: "payees", doc: { id: "p", name: "Segreto" } as never },
        { type: "put", collection: "transactions", doc: { id: "t" } as never },
        { type: "put", collection: "transactions", doc: { id: "u" } as never },
        { type: "remove", collection: "importBatches", id: "b" },
      ]),
    ).toEqual({ ops: 4, collections: ["put payees: 1", "put transactions: 2", "remove importBatches: 1"] });
  });
});

describe("errorCode", () => {
  it("dà codice e motivo per gli errori dei dati, il codice o il nome per gli altri", () => {
    expect(errorCode(new DataQueryError({ code: "conflict", reason: "in_use" }))).toBe("conflict/in_use");
    expect(errorCode(new DataQueryError({ code: "forbidden" }))).toBe("forbidden");
    expect(errorCode(Object.assign(new Error("x"), { code: "permission-denied" }))).toBe("permission-denied");
    expect(errorCode(new TypeError("x"))).toBe("TypeError");
    expect(errorCode("boh")).toBe("unknown");
  });
});
