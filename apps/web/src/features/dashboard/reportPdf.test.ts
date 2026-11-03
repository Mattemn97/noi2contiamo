import { buildReport, type ReportTx } from "@noi2contiamo/core";
import { describe, expect, it } from "vitest";
import { buildReportPdf, pdfSafe, type ReportLabels, type ReportText } from "./reportPdf";

const half = { kind: "bp", source: "manual", shares: { a: 5000, b: 5000 } } as const;
const tx = (over: Partial<ReportTx>): ReportTx => ({
  type: "expense",
  date: "2026-11-05",
  amountCents: 12345,
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
const labels = Object.fromEntries(
  [
    "title",
    "subtitle",
    "period",
    "generated",
    "kpis",
    "income",
    "expense",
    "savings",
    "rate",
    "noRate",
    "categories",
    "noData",
    "others",
    "paid",
    "balance",
    "balanceNote",
    "colMember",
    "colPaid",
    "colShare",
    "colNet",
  ].map((k) => [k, `Etichetta ${k} àèì`]),
) as unknown as ReportLabels;
const money = (c: number) => `${(c / 100).toFixed(2).replace(".", ",")} €`;
const text: ReportText = {
  money,
  signed: money,
  percent: (bp) => `${bp / 100}%`,
  categoryName: (id) => id ?? "Senza",
  memberName: (id) => id ?? "Cassa",
};

describe("buildReportPdf", () => {
  it("produce un PDF valido e non vuoto", async () => {
    const data = buildReport(
      [tx({}), tx({ type: "income", amountCents: 500000, categoryId: null })],
      {
        view: { kind: "family" },
        accounts: [{ id: "cassa", ownerMemberId: null }],
        family: { defaultSplit: half },
        memberIds: ["a", "b"],
      },
      "month",
      "2026-11-10",
    );
    const bytes = new Uint8Array(await buildReportPdf(data, labels, text));
    expect(bytes.length).toBeGreaterThan(1000);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
  });

  it("normalizza spazi e segno meno", () => {
    expect(pdfSafe("− 1 234,00 €")).toBe("- 1 234,00 €");
  });
});
