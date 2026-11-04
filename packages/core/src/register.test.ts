import { describe, expect, it } from "vitest";
import {
  NONE,
  SUMMARY_DIMENSIONS,
  addDays,
  filterTransactions,
  pageOf,
  periodRange,
  signedCents,
  sumRows,
  summarize,
  totalsOf,
  type RegisterTx,
} from "./register";

let seq = 0;
const tx = (patch: Partial<RegisterTx> = {}): RegisterTx => ({
  id: `t${String(++seq).padStart(3, "0")}`,
  type: "expense",
  date: "2026-11-03",
  amountCents: 1000,
  isRefund: false,
  accountId: "a1",
  toAccountId: null,
  categoryId: "food",
  payeeId: null,
  payerMemberId: "anna",
  description: "",
  notes: null,
  ...patch,
});

const sample: RegisterTx[] = [
  tx({ amountCents: 4250, payeeId: "p1", description: "Supermercato Coop" }),
  tx({ amountCents: 333, categoryId: "bar", payerMemberId: "bruno", date: "2026-10-31" }),
  tx({ amountCents: 1000, isRefund: true, payeeId: "p1", notes: "reso" }),
  tx({ type: "income", amountCents: 250000, categoryId: "salary", accountId: "a2", payerMemberId: "bruno" }),
  tx({ type: "income", amountCents: 999, isRefund: true, categoryId: "salary", payerMemberId: null }),
  tx({ type: "transfer", amountCents: 50000, categoryId: null, accountId: "a2", toAccountId: "a1" }),
  tx({ amountCents: 1, categoryId: null, payerMemberId: null, date: "2025-12-31" }),
];

describe("signedCents", () => {
  it("entrate +, spese −, rimborsi al contrario, giroconti a zero", () => {
    expect(signedCents({ type: "income", amountCents: 100, isRefund: false })).toBe(100);
    expect(signedCents({ type: "expense", amountCents: 100, isRefund: false })).toBe(-100);
    expect(signedCents({ type: "expense", amountCents: 100, isRefund: true })).toBe(100);
    expect(signedCents({ type: "income", amountCents: 100, isRefund: true })).toBe(-100);
    expect(signedCents({ type: "transfer", amountCents: 100, isRefund: false })).toBe(0);
  });
});

describe("periodRange", () => {
  it("scorciatoie rispetto a oggi, con mesi corti, bisestili e cambio d'anno", () => {
    expect(periodRange("thisMonth", "2028-02-10")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(periodRange("lastMonth", "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(periodRange("last30", "2026-03-01")).toEqual({ from: "2026-01-31", to: "2026-03-01" });
    expect(periodRange("thisYear", "2026-11-03")).toEqual({ from: "2026-01-01", to: "2026-12-31" });
    expect(periodRange("lastYear", "2026-11-03")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(periodRange("all", "2026-11-03")).toEqual({ from: null, to: null });
  });

  it("personalizzato: aperto da un lato o con le date invertite", () => {
    expect(periodRange("custom", "2026-11-03", { from: "2026-05-01", to: null })).toEqual({
      from: "2026-05-01",
      to: null,
    });
    expect(periodRange("custom", "2026-11-03", { from: "2026-05-10", to: "2026-05-01" })).toEqual({
      from: "2026-05-01",
      to: "2026-05-10",
    });
  });

  it("addDays attraversa mesi e anni", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
});

describe("filterTransactions", () => {
  const ctx = {
    categories: [
      { id: "food", parentId: null },
      { id: "bar", parentId: "food" },
      { id: "salary", parentId: null },
    ],
    payeeNames: new Map([["p1", "Coop Lombardia"]]),
  };
  const ids = (filter: Parameters<typeof filterTransactions>[1]) =>
    filterTransactions(sample, filter, ctx).map((t) => t.id);

  it("senza filtri restituisce tutto nello stesso ordine", () => {
    expect(ids({})).toEqual(sample.map((t) => t.id));
  });

  it("periodo inclusivo, anche aperto da un lato", () => {
    expect(ids({ range: { from: "2026-11-01", to: "2026-11-03" } })).toHaveLength(5);
    expect(ids({ range: { from: null, to: "2026-10-31" } })).toEqual([sample[1]!.id, sample[6]!.id]);
  });

  it("tipo, conto (anche come arrivo di un giroconto), persona e cassa comune", () => {
    expect(ids({ type: "income" })).toEqual([sample[3]!.id, sample[4]!.id]);
    expect(ids({ accountId: "a2" })).toEqual([sample[3]!.id, sample[5]!.id]);
    expect(ids({ accountId: "a1" })).toContain(sample[5]!.id);
    expect(ids({ memberId: "bruno" })).toEqual([sample[1]!.id, sample[3]!.id]);
    expect(ids({ memberId: NONE })).toEqual([sample[4]!.id, sample[6]!.id]);
  });

  it("categoria con le sue sottocategorie, da categorizzare, destinatario e nessun destinatario", () => {
    expect(ids({ categoryId: "food" })).toEqual([sample[0]!.id, sample[1]!.id, sample[2]!.id]);
    expect(ids({ categoryId: "bar" })).toEqual([sample[1]!.id]);
    expect(ids({ categoryId: NONE })).toEqual([sample[5]!.id, sample[6]!.id]);
    expect(ids({ payeeId: "p1" })).toEqual([sample[0]!.id, sample[2]!.id]);
    expect(ids({ payeeId: NONE })).toHaveLength(5);
  });

  it("testo senza accenti né maiuscole in descrizione, note e destinatario", () => {
    expect(ids({ text: "  SUPERMERCATO " })).toEqual([sample[0]!.id]);
    expect(ids({ text: "resò" })).toEqual([sample[2]!.id]);
    expect(ids({ text: "lombardia" })).toEqual([sample[0]!.id, sample[2]!.id]);
    expect(ids({ text: "niente" })).toEqual([]);
  });

  it("i filtri si combinano in AND", () => {
    expect(ids({ type: "expense", memberId: "anna", payeeId: "p1", text: "reso" })).toEqual([sample[2]!.id]);
  });
});

describe("totali e tabelle riassuntive", () => {
  it("entrate e spese al netto dei rimborsi, giroconti contati ma a zero", () => {
    expect(totalsOf(sample)).toEqual({
      count: 7,
      incomeCents: 250000 - 999,
      expenseCents: 4250 + 333 - 1000 + 1,
      netCents: 250000 - 999 - (4250 + 333 - 1000 + 1),
    });
    expect(totalsOf([])).toEqual({ count: 0, incomeCents: 0, expenseCents: 0, netCents: 0 });
  });

  it("ogni dimensione torna con il totale generale, anche su un sottoinsieme filtrato", () => {
    for (const subset of [sample, filterTransactions(sample, { type: "expense" }), []]) {
      for (const dimension of SUMMARY_DIMENSIONS) {
        expect(sumRows(summarize(subset, dimension)), dimension).toEqual(totalsOf(subset));
      }
    }
  });

  it("righe dalla voce più pesante, la voce vuota in fondo", () => {
    const byCategory = summarize(sample, "category");
    expect(byCategory.map((r) => r.key)).toEqual(["salary", "food", "bar", null]);
    expect(byCategory.find((r) => r.key === "food")).toMatchObject({ count: 2, expenseCents: 3250 });
    expect(summarize(sample, "member").at(-1)).toMatchObject({ key: null, count: 2 });
    expect(summarize(sample, "type").map((r) => r.key)).toEqual(["income", "expense", "transfer"]);
  });
});

describe("pageOf", () => {
  it("pagine da 50, numero fermato tra la prima e l'ultima", () => {
    const items = Array.from({ length: 120 }, (_, i) => i);
    expect(pageOf(items, 1)).toMatchObject({ page: 1, pages: 3 });
    expect(pageOf(items, 3).items).toEqual(items.slice(100));
    expect(pageOf(items, 99).page).toBe(3);
    expect(pageOf(items, Number.NaN).page).toBe(1);
    expect(pageOf([], 2)).toEqual({ items: [], page: 1, pages: 1 });
  });
});
