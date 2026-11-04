import { describe, expect, it } from "vitest";
import {
  accountDefaults,
  checkTransaction,
  COLLECTION_NAMES,
  familySchema,
  newId,
  parseDoc,
  type Account,
  type Category,
  type Transaction,
} from "../index";

const me = newId();
const partner = newId();
const audit = { createdAtMs: 1, createdByMemberId: me, updatedAtMs: 1, updatedByMemberId: me };
const accountId = newId();
const otherAccountId = newId();

const baseTx = {
  id: newId(),
  type: "expense",
  date: "2026-11-03",
  amountCents: 10001,
  accountId,
  split: { kind: "bp", source: "default", shares: { [me]: 6000, [partner]: 4000 } },
  ...audit,
};

const parseTx = (patch: Record<string, unknown>) => parseDoc("transactions", { ...baseTx, ...patch });

describe("schemi delle collezioni (AC-1)", () => {
  it("esiste uno schema per ogni collezione di famiglia", () => {
    expect(COLLECTION_NAMES).toEqual([
      "members",
      "invites",
      "accounts",
      "categories",
      "payees",
      "transactions",
      "rules",
      "importProfiles",
      "importBatches",
      "recurrences",
      "recurrenceDismissals",
      "memberSettings",
      "reminders",
    ]);
  });

  it("un movimento valido passa e riceve i default alla lettura", () => {
    const result = parseTx({});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      isRefund: false,
      categoryId: null,
      description: "",
      visibility: "shared",
      provenance: { category: "manual", payee: "manual", split: "manual" },
      ruleIds: [],
      importFingerprints: [],
    });
  });

  it.each([
    ["importo non intero", { amountCents: 10.5 }],
    ["importo zero", { amountCents: 0 }],
    ["data non YYYY-MM-DD", { date: "03/11/2026" }],
    ["data impossibile", { date: "2026-02-30" }],
    ["id non UUIDv7", { id: "8c1d2f4e-1b2a-4c3d-8e9f-0a1b2c3d4e5f" }],
    ["campo sconosciuto", { amount: 10 }],
    ["percentuale fuori da 0..10000", { split: { kind: "bp", source: "manual", shares: { [me]: 10001 } } }],
  ])("rifiuta %s con un errore come valore", (_label, patch) => {
    const result = parseTx(patch);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.length).toBeGreaterThan(0);
  });

  it("rifiuta una percentuale fuori range anche nella divisione della famiglia", () => {
    const family = {
      id: newId(),
      name: "Casa",
      defaultSplit: { kind: "bp", shares: { [me]: -1, [partner]: 10001 } },
      createdByUserId: "u1",
      ...audit,
    };
    expect(familySchema.safeParse(family).success).toBe(false);
    const ok = familySchema.parse({ ...family, defaultSplit: { kind: "bp", shares: { [me]: 10000 } } });
    expect(ok.currency).toBe("EUR");
    expect(ok.schemaVersion).toBe(1);
  });

  it("valida un documento minimo di ogni altra collezione", () => {
    const docs = {
      members: { id: me, displayName: "Io", role: "owner", joinedAtMs: 1 },
      invites: { id: newId(), expiresAtMs: 10 },
      accounts: { id: accountId, name: "Conto", kind: "checking", initialBalanceDate: "2026-01-01" },
      categories: { id: newId(), name: "Spesa", kind: "expense" },
      payees: { id: newId(), name: "Bar Caffè", normalizedName: "bar caffe" },
      rules: { id: newId(), name: "Bar", conditions: { types: ["expense"] }, actions: { payeeId: newId() } },
      importProfiles: {
        id: newId(),
        name: "Banca",
        delimiter: ";",
        hasHeader: true,
        columns: { date: { header: "Data" }, description: [{ index: 2 }], amount: { header: "Importo" } },
        dateFormat: "dd/MM/yyyy",
        decimalSeparator: ",",
        thousandsSeparator: ".",
        sign: { mode: "negativeIsExpense" },
      },
      importBatches: {
        id: newId(),
        accountId,
        fileName: "estratto.csv",
        fileHash: "a".repeat(64),
        rowCount: 2,
        importedCount: 2,
        duplicateCount: 0,
        dateFrom: "2026-10-01",
        dateTo: "2026-10-31",
        importedAtMs: 1,
      },
      recurrences: {
        id: newId(),
        name: "Affitto",
        type: "expense",
        accountId,
        expectedAmountCents: 80000,
        frequency: { unit: "month", interval: 1, dayOfMonth: 31 },
        startDate: "2026-01-31",
      },
      recurrenceDismissals: { id: "abc123", dismissedAtMs: 1, dismissedByMemberId: me },
      memberSettings: { id: me },
      reminders: {
        id: newId(),
        memberId: me,
        kind: "settlement",
        fireAtMs: 1,
        title: "Pareggio",
        dedupKey: "k",
      },
    } as const;
    for (const [name, doc] of Object.entries(docs)) {
      const result = parseDoc(name as keyof typeof docs, { ...doc, ...audit });
      expect(result.ok, `${name}: ${JSON.stringify(result.ok ? null : result.error)}`).toBe(true);
    }
    const settings = parseDoc("memberSettings", { id: me, ...audit });
    expect(settings.ok && settings.value.notifications.recurringDue).toEqual({ enabled: true, leadDays: 2 });
  });

  it("rifiuta regole senza condizioni o senza azioni, conto privato senza proprietario, payee non normalizzato", () => {
    expect(
      parseDoc("rules", { id: newId(), name: "x", conditions: {}, actions: { payeeId: me }, ...audit }).ok,
    ).toBe(false);
    expect(
      parseDoc("rules", { id: newId(), name: "x", conditions: { types: ["income"] }, actions: {}, ...audit })
        .ok,
    ).toBe(false);
    expect(
      parseDoc("accounts", {
        id: newId(),
        name: "Mio",
        kind: "cash",
        visibility: "private",
        initialBalanceDate: "2026-01-01",
        ...audit,
      }).ok,
    ).toBe(false);
    expect(parseDoc("payees", { id: newId(), name: "Bar", normalizedName: "Bar", ...audit }).ok).toBe(false);
  });
});

describe("invarianti del movimento (AC-2)", () => {
  it("un giroconto vuole due conti diversi, niente categoria e niente split", () => {
    const transfer = { type: "transfer", split: null, toAccountId: otherAccountId };
    expect(parseTx(transfer).ok).toBe(true);
    expect(parseTx({ ...transfer, toAccountId: accountId }).ok).toBe(false);
    expect(parseTx({ ...transfer, toAccountId: null }).ok).toBe(false);
    expect(parseTx({ ...transfer, categoryId: newId() }).ok).toBe(false);
    expect(parseTx({ ...transfer, split: baseTx.split }).ok).toBe(false);
    expect(parseTx({ ...transfer, settlement: { fromMemberId: me, toMemberId: me } }).ok).toBe(false);
    expect(parseTx({ ...transfer, settlement: { fromMemberId: me, toMemberId: partner } }).ok).toBe(true);
  });

  it("entrate e spese vogliono una split; settlement e toAccountId solo sui giroconti", () => {
    expect(parseTx({ split: null }).ok).toBe(false);
    expect(parseTx({ toAccountId: otherAccountId }).ok).toBe(false);
    expect(parseTx({ settlement: { fromMemberId: me, toMemberId: partner } }).ok).toBe(false);
  });

  it("le quote sommano a 10000 punti base o ad amountCents centesimi", () => {
    expect(
      parseTx({ split: { kind: "bp", source: "manual", shares: { [me]: 5000, [partner]: 4999 } } }).ok,
    ).toBe(false);
    expect(
      parseTx({ split: { kind: "cents", source: "manual", shares: { [me]: 10000, [partner]: 1 } } }).ok,
    ).toBe(true);
    expect(parseTx({ split: { kind: "cents", source: "manual", shares: { [me]: 10000 } } }).ok).toBe(false);
  });

  it("privato solo col proprietario come unico membro nelle quote", () => {
    const priv = { visibility: "private", ownerMemberId: me };
    expect(parseTx({ ...priv, split: { kind: "bp", source: "manual", shares: { [me]: 10000 } } }).ok).toBe(
      true,
    );
    expect(parseTx(priv).ok).toBe(false);
    expect(parseTx({ visibility: "private" }).ok).toBe(false);
  });

  const account = (patch: Partial<Account> = {}): Account => ({
    id: accountId,
    name: "Conto",
    kind: "checking",
    ownerMemberId: null,
    visibility: "shared",
    initialBalanceCents: 0,
    initialBalanceDate: "2026-01-01",
    order: 0,
    archivedAtMs: null,
    ...audit,
    ...patch,
  });
  const category = (kind: "income" | "expense"): Category => ({
    id: newId(),
    name: "Cat",
    kind,
    parentId: null,
    defaultSplit: null,
    color: null,
    icon: null,
    order: 0,
    archivedAtMs: null,
    ...audit,
  });
  const tx = (patch: Record<string, unknown> = {}): Transaction => {
    const parsed = parseTx(patch);
    if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
    return parsed.value;
  };
  const members = new Set([me, partner]);

  it("la categoria deve avere lo stesso kind del movimento", () => {
    const expense = category("expense");
    const ctx = { account: account(), toAccount: null, memberIds: members };
    expect(checkTransaction(tx({ categoryId: expense.id }), { ...ctx, category: expense }).ok).toBe(true);
    const income = category("income");
    expect(checkTransaction(tx({ categoryId: income.id }), { ...ctx, category: income }).ok).toBe(false);
  });

  it("le quote citano solo membri della famiglia e il conto deve esistere", () => {
    expect(
      checkTransaction(tx(), { account: null, toAccount: null, category: null, memberIds: members }).ok,
    ).toBe(false);
    expect(
      checkTransaction(tx(), {
        account: account(),
        toAccount: null,
        category: null,
        memberIds: new Set([me]),
      }).ok,
    ).toBe(false);
  });

  it("privato solo su un conto privato dello stesso proprietario", () => {
    const priv = tx({
      visibility: "private",
      ownerMemberId: me,
      split: { kind: "bp", source: "manual", shares: { [me]: 10000 } },
    });
    const ctx = { toAccount: null, category: null, memberIds: members };
    expect(
      checkTransaction(priv, { ...ctx, account: account({ visibility: "private", ownerMemberId: me }) }).ok,
    ).toBe(true);
    expect(checkTransaction(priv, { ...ctx, account: account() }).ok).toBe(false);
    expect(
      checkTransaction(priv, { ...ctx, account: account({ visibility: "private", ownerMemberId: partner }) })
        .ok,
    ).toBe(false);
    expect(
      checkTransaction(tx(), { ...ctx, account: account({ visibility: "private", ownerMemberId: me }) }).ok,
    ).toBe(false);
  });

  it("i default di visibilità e pagatore vengono dal conto", () => {
    const mine = account({ visibility: "private", ownerMemberId: me });
    expect(accountDefaults(mine)).toEqual({ visibility: "private", ownerMemberId: me, payerMemberId: me });
    expect(accountDefaults(mine, account())).toEqual({
      visibility: "shared",
      ownerMemberId: null,
      payerMemberId: me,
    });
    expect(accountDefaults(account())).toEqual({
      visibility: "shared",
      ownerMemberId: null,
      payerMemberId: null,
    });
  });
});
