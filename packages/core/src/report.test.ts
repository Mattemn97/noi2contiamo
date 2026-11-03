import { describe, expect, it } from "vitest";
import { buildReport, dashboardEntries, kpis, byCategory, type ReportTx } from "./index";

const accounts = [
  { id: "cassa", ownerMemberId: null },
  { id: "pb", ownerMemberId: "b" },
];
const half = { kind: "bp", source: "manual", shares: { a: 5000, b: 5000 } } as const;
const tx = (over: Partial<ReportTx>): ReportTx => ({
  type: "expense",
  date: "2026-11-05",
  amountCents: 1000,
  isRefund: false,
  accountId: "cassa",
  toAccountId: null,
  categoryId: "spesa",
  payerMemberId: "a",
  split: half,
  settlement: null,
  visibility: "shared",
  ownerMemberId: null,
  ...over,
});
const family = { defaultSplit: half } as never;
const txs = [
  tx({}),
  tx({ date: "2026-10-31", amountCents: 9999 }),
  tx({ amountCents: 777, visibility: "private", ownerMemberId: "b", accountId: "pb" }),
];
const ctx = (view: "family" | "personal") =>
  ({
    view: view === "family" ? { kind: "family" } : { kind: "personal", memberId: "a" },
    accounts,
    family,
    memberIds: ["a", "b"],
  }) as never;

describe("buildReport", () => {
  it("coincide con la dashboard e limita il periodo", () => {
    const r = buildReport(txs, ctx("family"), "month", "2026-11-20");
    expect(r.range).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    const entries = dashboardEntries(txs, ctx("family")).filter((e) => e.date >= "2026-11-01");
    expect(r.kpis).toEqual(kpis(entries));
    expect(r.categories).toEqual(byCategory(entries));
    expect(r.kpis.expenseCents).toBe(1000);
    expect(r.balances?.map((b) => b.memberId)).toEqual(["a", "b"]);
    expect(r.balances?.reduce((s, b) => s + b.netCents, 0)).toBe(0);
  });

  it("la settimana e l'anno cambiano l'intervallo", () => {
    expect(buildReport(txs, ctx("family"), "week", "2026-11-05").range.from).toBe("2026-11-02");
    expect(buildReport(txs, ctx("family"), "year", "2026-11-05").kpis.expenseCents).toBe(10999);
  });

  it("nella vista personale niente saldo né dati privati altrui", () => {
    const r = buildReport(txs, ctx("personal"), "month", "2026-11-05");
    expect(r.balances).toBeNull();
    expect(r.kpis.expenseCents).toBe(500);
  });
});
