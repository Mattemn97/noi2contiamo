import { describe, expect, it } from "vitest";
import {
  autoSplit,
  bpToCents,
  categorySplit,
  centsToBp,
  checkSplit,
  equalSplit,
  familySplitIssues,
  memberAmounts,
  reapplySplits,
  resolveSplit,
  sameShares,
  soloSplit,
  transactionSchema,
  type Transaction,
} from "./index";

const A = "0190a000-0000-7000-8000-00000000000a";
const B = "0190a000-0000-7000-8000-00000000000b";
const CASA = "0190a000-0000-7000-8000-000000000101";
const AFFITTO = "0190a000-0000-7000-8000-000000000102";
const SVAGO = "0190a000-0000-7000-8000-000000000103";
const STIPENDIO = "0190a000-0000-7000-8000-000000000104";
const FAMILY = { defaultSplit: { kind: "bp" as const, shares: { [A]: 5000, [B]: 5000 } } };
const RENT = { kind: "bp" as const, shares: { [A]: 6000, [B]: 4000 } };
const categories = [
  { id: CASA, parentId: null, defaultSplit: RENT },
  { id: AFFITTO, parentId: CASA, defaultSplit: null },
  { id: SVAGO, parentId: null, defaultSplit: null },
  { id: STIPENDIO, parentId: null, defaultSplit: null },
];
const accounts = [
  { id: "comune", ownerMemberId: null },
  { id: "personale-a", ownerMemberId: A },
];
const ctx = { family: FAMILY, categories, accounts };

let seq = 0;
function tx(over: Partial<Transaction>): Transaction {
  seq += 1;
  return transactionSchema.parse({
    id: `0190a000-0000-7000-8000-${String(seq).padStart(12, "0")}`,
    type: "expense",
    date: "2026-11-01",
    amountCents: 10001,
    accountId: "0190a000-0000-7000-8000-0000000000c0",
    categoryId: null,
    split: { kind: "bp", source: "default", shares: FAMILY.defaultSplit.shares },
    createdAtMs: 1,
    createdByMemberId: A,
    updatedAtMs: 1,
    updatedByMemberId: A,
    ...over,
  });
}

describe("precedenza (AC-1, AC-2, AC-8)", () => {
  it("privato > manuale > regola > categoria > proprietario > famiglia", () => {
    const manual = { kind: "cents" as const, shares: { [B]: 100 } };
    const rule = soloSplit(B);
    const family = FAMILY.defaultSplit;
    expect(resolveSplit({ privateOwner: A, manual, rule, category: RENT, family })).toEqual({
      kind: "bp",
      source: "default",
      shares: { [A]: 10000 },
    });
    expect(resolveSplit({ manual, rule, category: RENT, family })).toEqual({ ...manual, source: "manual" });
    expect(resolveSplit({ rule, category: RENT, incomeOwner: A, family }).source).toBe("rule");
    expect(resolveSplit({ category: RENT, incomeOwner: A, family }).source).toBe("category");
    expect(resolveSplit({ incomeOwner: A, family })).toEqual({
      kind: "bp",
      source: "default",
      shares: { [A]: 10000 },
    });
    expect(resolveSplit({ family }).shares).toEqual(family.shares);
  });

  it("una sottocategoria senza divisione eredita dalla principale", () => {
    expect(categorySplit(AFFITTO, categories)).toEqual(RENT);
    expect(categorySplit(CASA, categories)).toEqual(RENT);
    expect(categorySplit(SVAGO, categories)).toBeNull();
    expect(categorySplit(null, categories)).toBeNull();
  });

  it("entrata su conto personale senza divisione di categoria va al proprietario", () => {
    const base = { categoryId: STIPENDIO, visibility: "shared" as const, ownerMemberId: null };
    expect(autoSplit({ ...base, type: "income", accountId: "personale-a" }, ctx).shares).toEqual({
      [A]: 10000,
    });
    expect(autoSplit({ ...base, type: "income", accountId: "comune" }, ctx).shares).toEqual(
      FAMILY.defaultSplit.shares,
    );
    expect(autoSplit({ ...base, type: "expense", accountId: "personale-a" }, ctx).shares).toEqual(
      FAMILY.defaultSplit.shares,
    );
    expect(
      autoSplit({ ...base, categoryId: CASA, type: "income", accountId: "personale-a" }, ctx).source,
    ).toBe("category");
  });

  it("un movimento privato ignora la categoria", () => {
    expect(
      autoSplit(
        {
          type: "expense",
          categoryId: CASA,
          accountId: "personale-a",
          visibility: "private",
          ownerMemberId: A,
        },
        ctx,
      ),
    ).toEqual({ kind: "bp", source: "default", shares: { [A]: 10000 } });
  });
});

describe("arrotondamento e controllo (AC-3)", () => {
  it("100,01 € al 60/40 → 60,01 e 40,00; 0,01 € al 50/50 → al membro minore", () => {
    expect(memberAmounts(10001, { ...RENT, source: "category" })).toEqual({ [A]: 6001, [B]: 4000 });
    expect(memberAmounts(1, { ...FAMILY.defaultSplit, source: "default" })).toEqual({ [A]: 1, [B]: 0 });
  });

  it("checkSplit: somma esatta, quote vuote, quote a zero tolte", () => {
    expect(checkSplit({ kind: "bp", shares: { [A]: 10000, [B]: 0 } }, 500)).toEqual({
      ok: true,
      value: { kind: "bp", shares: { [A]: 10000 } },
    });
    expect(checkSplit({ kind: "bp", shares: { [A]: 6000, [B]: 3000 } }, 500)).toEqual({
      ok: false,
      error: { code: "sum", diff: -1000 },
    });
    expect(checkSplit({ kind: "cents", shares: { [A]: 300, [B]: 250 } }, 500)).toEqual({
      ok: false,
      error: { code: "sum", diff: 50 },
    });
    expect(checkSplit({ kind: "cents", shares: { [A]: 300, [B]: 200 } }, 500).ok).toBe(true);
    expect(checkSplit({ kind: "cents", shares: { [A]: null, [B]: 0 } }, 500)).toEqual({
      ok: false,
      error: { code: "empty" },
    });
    expect(checkSplit({ kind: "cents", shares: { [A]: 1.5 } }, 1.5).ok).toBe(false);
  });

  it("cambio di modalità: somme esatte", () => {
    expect(bpToCents(10001, { [A]: 6000, [B]: 4000 })).toEqual({ [A]: 6001, [B]: 4000 });
    expect(bpToCents(100, { [A]: 5000, [B]: null })).toEqual({ [A]: 100, [B]: 0 });
    expect(bpToCents(0, { [A]: 5000 })).toEqual({ [A]: 0 });
    expect(centsToBp({ [A]: 1, [B]: 2 })).toEqual({ [A]: 3333, [B]: 6667 });
    expect(centsToBp({ [A]: null, [B]: 0 })).toEqual({ [A]: 0, [B]: 0 });
  });

  it("scorciatoie e confronto", () => {
    expect(equalSplit([B, A]).shares).toEqual({ [A]: 5000, [B]: 5000 });
    expect(soloSplit(B)).toEqual({ kind: "bp", shares: { [B]: 10000 } });
    expect(sameShares({ kind: "bp", shares: { [A]: 10000, [B]: 0 } }, soloSplit(A))).toBe(true);
    expect(sameShares({ kind: "cents", shares: { [A]: 10000 } }, soloSplit(A))).toBe(false);
    expect(sameShares(RENT, FAMILY.defaultSplit)).toBe(false);
  });
});

describe("riapplica (AC-5, AC-6)", () => {
  const ctxTx = {
    ...ctx,
    accounts: [{ id: "0190a000-0000-7000-8000-0000000000c0", ownerMemberId: null }],
  };

  it("cambia solo default e category, mai manual né rule, e solo se cambia qualcosa", () => {
    const stale = tx({ categoryId: AFFITTO });
    const fresh = tx({ categoryId: CASA, split: { ...RENT, source: "category" } });
    const manual = tx({ categoryId: CASA, split: { kind: "bp", source: "manual", shares: { [B]: 10000 } } });
    const rule = tx({ categoryId: CASA, split: { kind: "bp", source: "rule", shares: { [B]: 10000 } } });
    const other = tx({ categoryId: SVAGO });
    const changed = reapplySplits([stale, fresh, manual, rule, other], ctxTx);
    expect(changed.map((t) => t.id)).toEqual([stale.id]);
    expect(changed[0]?.split).toEqual({ ...RENT, source: "category" });
  });

  it("limitato a una categoria comprende le sottocategorie", () => {
    const sub = tx({ categoryId: AFFITTO });
    const away = tx({ categoryId: SVAGO, split: { kind: "bp", source: "category", shares: { [B]: 10000 } } });
    expect(reapplySplits([sub, away], { ...ctxTx, categoryId: CASA }).map((t) => t.id)).toEqual([sub.id]);
    expect(reapplySplits([sub, away], ctxTx).map((t) => t.id)).toEqual([sub.id, away.id]);
  });

  it("salta giroconti e privati; i rimborsi seguono la stessa risoluzione", () => {
    const refund = tx({ categoryId: CASA, isRefund: true });
    const transfer = tx({
      type: "transfer",
      toAccountId: "0190a000-0000-7000-8000-0000000000c1",
      split: null,
    });
    const changed = reapplySplits([refund, transfer], ctxTx);
    expect(changed.map((t) => t.id)).toEqual([refund.id]);
    expect(changed[0]?.isRefund).toBe(true);
  });
});

describe("divisione della famiglia (AC-7)", () => {
  it("valida schema e membri attivi", () => {
    const active = new Set([A, B]);
    expect(familySplitIssues(FAMILY.defaultSplit, active)).toEqual([]);
    expect(familySplitIssues({ kind: "bp", shares: { [A]: 9000 } }, active)).toHaveLength(1);
    expect(familySplitIssues(soloSplit(A), new Set([B]))).toHaveLength(1);
  });
});
