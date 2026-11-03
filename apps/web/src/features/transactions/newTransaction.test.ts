import { newId, parseDoc, type Account, type Category, type Family } from "@noi2contiamo/core";
import { describe, expect, it } from "vitest";
import { signedCents } from "@noi2contiamo/core";
import { calendarDate } from "./TransactionsPage";
import {
  buildTransaction,
  buildTransfer,
  draftOf,
  transferDraftOf,
  type TransactionDraft,
} from "./newTransaction";

const ownerId = newId();
const audit = { createdAtMs: 1, createdByMemberId: ownerId, updatedAtMs: 1, updatedByMemberId: ownerId };
const family = {
  id: newId(),
  defaultSplit: { kind: "bp", shares: { [ownerId]: 10000 } },
} as unknown as Family;
const parse = (collection: "accounts" | "categories", doc: object): unknown => {
  const parsed = parseDoc(collection, { ...doc, ...audit });
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.error));
  return parsed.value;
};
const shared = parse("accounts", {
  id: newId(),
  name: "Conto comune",
  kind: "checking",
  initialBalanceDate: "2026-01-01",
}) as Account;
const personal = parse("accounts", {
  id: newId(),
  name: "Mio",
  kind: "cash",
  visibility: "private",
  ownerMemberId: ownerId,
  initialBalanceDate: "2026-01-01",
}) as Account;
const food = parse("categories", { id: newId(), name: "Spesa", kind: "expense" }) as Category;
const rent = parse("categories", {
  id: newId(),
  name: "Affitto",
  kind: "expense",
  defaultSplit: { kind: "bp", shares: { [ownerId]: 10000 } },
}) as Category;
const salary = parse("categories", { id: newId(), name: "Stipendio", kind: "income" }) as Category;
const ctx = { id: newId(), family, accounts: [shared, personal], categories: [food, rent, salary] };
const draft: TransactionDraft = {
  type: "expense",
  amountCents: 4250,
  date: "2026-11-03",
  categoryId: food.id,
  accountId: shared.id,
  description: "  Supermercato ",
};

describe("buildTransaction", () => {
  it("una spesa sul conto comune usa la divisione della famiglia e passa lo schema di core", () => {
    const built = buildTransaction(draft, ctx);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.value).toMatchObject({
      amountCents: 4250,
      description: "Supermercato",
      visibility: "shared",
      ownerMemberId: null,
      payerMemberId: null,
      split: { kind: "bp", source: "default", shares: { [ownerId]: 10000 } },
    });
    expect(parseDoc("transactions", { ...built.value, ...audit }).ok).toBe(true);
  });

  it("la divisione della categoria vince su quella della famiglia", () => {
    const built = buildTransaction({ ...draft, categoryId: rent.id }, ctx);
    expect(built.ok && built.value.split?.source).toBe("category");
  });

  it("su un conto privato il movimento è privato del proprietario", () => {
    const built = buildTransaction({ ...draft, accountId: personal.id }, ctx);
    expect(built.ok && [built.value.visibility, built.value.ownerMemberId]).toEqual(["private", ownerId]);
  });

  it("segnala importo mancante o zero, categoria di un altro tipo e conto mancante", () => {
    expect(buildTransaction({ ...draft, amountCents: null }, ctx)).toEqual({ ok: false, error: ["amount"] });
    expect(buildTransaction({ ...draft, amountCents: 0 }, ctx)).toEqual({ ok: false, error: ["amount"] });
    expect(buildTransaction({ ...draft, categoryId: salary.id }, ctx)).toEqual({
      ok: false,
      error: ["category"],
    });
    expect(buildTransaction({ ...draft, accountId: null, categoryId: null }, ctx)).toEqual({
      ok: false,
      error: ["category", "account"],
    });
  });
});

describe("registro", () => {
  it("il verso dell'importo: entrate +, spese −, rimborsi al contrario", () => {
    expect(signedCents({ type: "income", amountCents: 100, isRefund: false })).toBe(100);
    expect(signedCents({ type: "expense", amountCents: 100, isRefund: false })).toBe(-100);
    expect(signedCents({ type: "expense", amountCents: 100, isRefund: true })).toBe(100);
    expect(signedCents({ type: "transfer", amountCents: 100, isRefund: false })).toBe(0);
  });

  it("la data di calendario resta lo stesso giorno in ogni fuso", () => {
    const date = calendarDate("2026-03-01");
    expect([date.getFullYear(), date.getMonth(), date.getDate()]).toEqual([2026, 2, 1]);
  });
});

describe("buildTransaction su un movimento esistente", () => {
  const partnerId = newId();
  const built = buildTransaction(draft, ctx);
  if (!built.ok) throw new Error("atteso ok");
  const existing = parseDoc("transactions", {
    ...built.value,
    notes: "da conservare",
    payerMemberId: partnerId,
    split: { kind: "bp", source: "manual", shares: { [ownerId]: 5000, [partnerId]: 5000 } },
    provenance: { category: "manual", payee: "manual", split: "manual" },
    ...audit,
  });
  if (!existing.ok) throw new Error(JSON.stringify(existing.error));
  const tx = existing.value;

  it("draftOf riempie il modulo; i giroconti non si modificano qui", () => {
    expect(draftOf(tx)).toMatchObject({ type: "expense", amountCents: 4250, accountId: shared.id });
    expect(draftOf({ ...tx, type: "transfer" })).toBeNull();
  });

  it("tiene id, note, divisione manuale e chi ha pagato; niente audit nel documento", () => {
    const edited = buildTransaction(
      { ...draft, amountCents: 5000, categoryId: rent.id, split: draftOf(tx)?.split ?? null },
      { ...ctx, existing: tx },
    );
    if (!edited.ok) throw new Error("atteso ok");
    expect(edited.value).toMatchObject({
      id: tx.id,
      amountCents: 5000,
      categoryId: rent.id,
      notes: "da conservare",
      payerMemberId: partnerId,
      split: tx.split,
      provenance: { category: "manual", split: "manual" },
    });
    expect(edited.value).not.toHaveProperty("createdAtMs");
  });

  it("cambiare conto rifà visibilità e chi ha pagato; sul conto privato tutto al proprietario", () => {
    const auto = {
      ...tx,
      split: { kind: "bp" as const, source: "default" as const, shares: { [ownerId]: 10000 } },
    };
    const edited = buildTransaction(
      { ...draft, accountId: personal.id, categoryId: rent.id },
      { ...ctx, existing: auto },
    );
    if (!edited.ok) throw new Error("atteso ok");
    expect(edited.value).toMatchObject({
      visibility: "private",
      ownerMemberId: ownerId,
      payerMemberId: ownerId,
      split: { kind: "bp", source: "default", shares: { [ownerId]: 10000 } },
    });
  });

  const auto = {
    ...tx,
    split: {
      kind: "bp" as const,
      source: "default" as const,
      shares: { [ownerId]: 5000, [partnerId]: 5000 },
    },
    provenance: { ...tx.provenance, split: "default" as const },
  };

  it("fotografia: stessa categoria e conto tengono la divisione salvata, un'altra categoria la rifà (AC-5)", () => {
    const same = buildTransaction({ ...draft, amountCents: 999 }, { ...ctx, existing: auto });
    expect(same.ok && same.value.split).toEqual(auto.split);
    const moved = buildTransaction({ ...draft, categoryId: rent.id }, { ...ctx, existing: auto });
    expect(moved.ok && moved.value.split).toEqual({
      kind: "bp",
      source: "category",
      shares: { [ownerId]: 10000 },
    });
  });

  it("tornare automatica da una manuale risolve di nuovo", () => {
    const back = buildTransaction({ ...draft, split: null }, { ...ctx, existing: tx });
    expect(back.ok && back.value.split?.source).toBe("default");
    expect(back.ok && back.value.provenance?.split).toBe("default");
  });
});

describe("divisione a mano nel modulo (AC-3, AC-4)", () => {
  const partnerId = newId();
  const members = ctx;

  it("in importo deve sommare all'importo; le quote a zero si tolgono", () => {
    const ok = buildTransaction(
      { ...draft, split: { kind: "cents", shares: { [ownerId]: 4000, [partnerId]: 250 } } },
      members,
    );
    expect(ok.ok && ok.value.split).toEqual({
      kind: "cents",
      source: "manual",
      shares: { [ownerId]: 4000, [partnerId]: 250 },
    });
    expect(ok.ok && ok.value.provenance?.split).toBe("manual");
    expect(
      buildTransaction(
        { ...draft, split: { kind: "cents", shares: { [ownerId]: 4000, [partnerId]: 249 } } },
        members,
      ),
    ).toEqual({ ok: false, error: ["split"] });
    const zero = buildTransaction(
      { ...draft, split: { kind: "bp", shares: { [ownerId]: 10000, [partnerId]: 0 } } },
      members,
    );
    expect(zero.ok && zero.value.split?.shares).toEqual({ [ownerId]: 10000 });
  });

  it("in percentuale deve fare 100%", () => {
    expect(
      buildTransaction(
        { ...draft, split: { kind: "bp", shares: { [ownerId]: 6000, [partnerId]: null } } },
        members,
      ),
    ).toEqual({ ok: false, error: ["split"] });
  });

  it("un movimento privato ignora la divisione a mano", () => {
    const built = buildTransaction(
      { ...draft, accountId: personal.id, split: { kind: "bp", shares: { [partnerId]: 10000 } } },
      members,
    );
    expect(built.ok && built.value.split).toEqual({
      kind: "bp",
      source: "default",
      shares: { [ownerId]: 10000 },
    });
  });

  it("un'entrata su un conto personale condiviso va al proprietario", () => {
    const mineShared = { ...shared, id: newId(), ownerMemberId: partnerId };
    const built = buildTransaction(
      { ...draft, type: "income", categoryId: salary.id, accountId: mineShared.id },
      { ...members, accounts: [...ctx.accounts, mineShared] },
    );
    expect(built.ok && built.value.split).toEqual({
      kind: "bp",
      source: "default",
      shares: { [partnerId]: 10000 },
    });
  });
});

describe("buildTransfer (spec 0005, AC-1)", () => {
  const draft = {
    amountCents: 2500,
    date: "2026-11-03",
    accountId: personal.id,
    toAccountId: shared.id,
    description: " Versamento ",
  };

  it("un giroconto non ha categoria, destinatario né divisione; visibilità dai due conti", () => {
    const built = buildTransfer(draft, { id: ctx.id, accounts: ctx.accounts });
    expect(built.ok && built.value).toMatchObject({
      type: "transfer",
      accountId: personal.id,
      toAccountId: shared.id,
      categoryId: null,
      payeeId: null,
      split: null,
      settlement: null,
      description: "Versamento",
      visibility: "shared",
      payerMemberId: ownerId,
    });
  });

  it("conti mancanti o uguali e importo vuoto sono errori del modulo", () => {
    expect(
      buildTransfer({ ...draft, toAccountId: personal.id }, { id: ctx.id, accounts: ctx.accounts }),
    ).toEqual({
      ok: false,
      error: ["sameAccount"],
    });
    expect(
      buildTransfer(
        { ...draft, amountCents: null, toAccountId: null },
        { id: ctx.id, accounts: ctx.accounts },
      ),
    ).toEqual({ ok: false, error: ["amount", "toAccount"] });
  });

  it("modificando un pareggio resta il settlement; una spesa che diventa giroconto perde divisione e categoria", () => {
    const settlement = { fromMemberId: ownerId, toMemberId: newId() };
    const existing = parseDoc("transactions", {
      ...audit,
      id: newId(),
      type: "transfer",
      date: "2026-11-01",
      amountCents: 100,
      accountId: shared.id,
      toAccountId: personal.id,
      settlement,
    });
    if (!existing.ok) throw new Error("doc");
    const edited = buildTransfer(draft, { id: ctx.id, accounts: ctx.accounts, existing: existing.value });
    expect(edited.ok && edited.value).toMatchObject({ id: existing.value.id, settlement, amountCents: 2500 });
    expect(transferDraftOf(existing.value)).toMatchObject({ toAccountId: personal.id, amountCents: 100 });

    const spesa = buildTransaction(
      {
        type: "expense",
        amountCents: 900,
        date: "2026-11-03",
        categoryId: food.id,
        accountId: shared.id,
        description: "",
      },
      ctx,
    );
    if (!spesa.ok) throw new Error("spesa");
    const asDoc = parseDoc("transactions", { ...spesa.value, ...audit });
    if (!asDoc.ok) throw new Error("doc");
    const moved = buildTransfer(draft, { id: ctx.id, accounts: ctx.accounts, existing: asDoc.value });
    expect(moved.ok && moved.value).toMatchObject({
      id: asDoc.value.id,
      categoryId: null,
      split: null,
      settlement: null,
    });
    if (moved.ok) expect(parseDoc("transactions", { ...moved.value, ...audit }).ok).toBe(true);
  });
});
