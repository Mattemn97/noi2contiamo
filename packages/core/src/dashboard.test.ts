import { describe, expect, it } from "vitest";
import {
  byCategory,
  comparePeriods,
  comparisonPeriod,
  contributions,
  dashboardEntries,
  delta,
  kpis,
  periodAround,
  trend,
  type DashboardTx,
} from "./dashboard";
import { totalsOf } from "./register";

const half: DashboardTx["split"] = { kind: "bp", source: "manual", shares: { a: 5000, b: 5000 } };
const tx = (over: Partial<DashboardTx>): DashboardTx => ({
  type: "expense",
  date: "2026-11-05",
  amountCents: 1000,
  isRefund: false,
  accountId: "cassa",
  categoryId: "spesa",
  payerMemberId: "a",
  split: half,
  visibility: "shared",
  ownerMemberId: null,
  ...over,
});
const accounts = [
  { id: "cassa", ownerMemberId: null },
  { id: "pa", ownerMemberId: "a" },
];
const family = { view: { kind: "family" }, accounts } as const;
const mine = { view: { kind: "personal", memberId: "a" }, accounts } as const;

describe("dashboard", () => {
  const txs = [
    tx({}),
    tx({ amountCents: 300, isRefund: true }),
    tx({ type: "income", amountCents: 5000, categoryId: "stipendio", payerMemberId: "b" }),
    tx({ type: "transfer", amountCents: 9999, categoryId: null }),
    tx({ amountCents: 777, visibility: "private", ownerMemberId: "b", accountId: "pb" }),
  ];

  it("i totali tornano col registro e i giroconti sono esclusi", () => {
    const entries = dashboardEntries(txs, family);
    const k = kpis(entries);
    const reg = totalsOf(txs.filter((t) => t.visibility === "shared"));
    expect(k.incomeCents).toBe(reg.incomeCents);
    expect(k.expenseCents).toBe(reg.expenseCents);
    expect(k).toMatchObject({ expenseCents: 700, savingsCents: 4300, savingsRateBp: 8600 });
    expect(byCategory(entries).reduce((s, c) => s + c.cents, 0)).toBe(k.expenseCents);
    expect(contributions(entries).reduce((s, c) => s + c.cents, 0)).toBe(k.expenseCents);
  });

  it("il tasso di risparmio è nullo senza entrate", () => {
    expect(kpis(dashboardEntries([tx({})], family)).savingsRateBp).toBeNull();
  });

  it("la vista personale conta la quota e non mostra mai i dati privati altrui", () => {
    expect(kpis(dashboardEntries(txs, mine))).toMatchObject({ expenseCents: 350, incomeCents: 2500 });
    const own = tx({
      amountCents: 400,
      visibility: "private",
      ownerMemberId: "a",
      accountId: "pa",
      split: null,
    });
    expect(kpis(dashboardEntries([own], mine)).expenseCents).toBe(400);
    expect(dashboardEntries([own], family)).toEqual([]);
    expect(dashboardEntries([own], { view: { kind: "personal", memberId: "b" }, accounts })).toEqual([]);
  });

  it("l'andamento riempie le settimane vuote", () => {
    const points = trend(dashboardEntries(txs, family), "week", { from: "2026-10-26", to: "2026-11-15" });
    expect(points.map((p) => p.start)).toEqual(["2026-10-26", "2026-11-02", "2026-11-09"]);
    expect(points[1]?.expenseCents).toBe(700);
  });
});

describe("confronto tra periodi", () => {
  it("trova il periodo precedente e quello dell'anno prima", () => {
    const month = periodAround("month", "2026-03-15");
    expect(month).toEqual({ from: "2026-03-01", to: "2026-03-31" });
    expect(comparisonPeriod("month", month, "previous")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(comparisonPeriod("month", month, "lastYear")).toEqual({ from: "2025-03-01", to: "2025-03-31" });
    expect(comparisonPeriod("year", periodAround("year", "2026-06-01"), "previous").from).toBe("2025-01-01");
    expect(comparisonPeriod("week", periodAround("week", "2026-11-04"), "previous")).toEqual({
      from: "2026-10-26",
      to: "2026-11-01",
    });
  });

  it("con base zero la percentuale è nulla", () => {
    expect(delta(500, 0)).toEqual({ currentCents: 500, previousCents: 0, diffCents: 500, pctBp: null });
    expect(delta(150, 100).pctBp).toBe(5000);
  });

  it("confronta totali e categorie, anche quelle presenti in un solo periodo", () => {
    const e = dashboardEntries(
      [
        tx({ date: "2026-11-02", amountCents: 3000 }),
        tx({ date: "2026-10-02", amountCents: 2000 }),
        tx({ date: "2026-10-03", amountCents: 500, categoryId: "svago" }),
      ],
      family,
    );
    const c = comparePeriods(e, periodAround("month", "2026-11-10"), periodAround("month", "2026-10-10"));
    expect(c.expense).toMatchObject({ currentCents: 3000, previousCents: 2500, diffCents: 500, pctBp: 2000 });
    expect(c.categories.find((x) => x.categoryId === "svago")).toMatchObject({
      currentCents: 0,
      pctBp: -10000,
    });
    expect(c.income.pctBp).toBeNull();
  });
});
