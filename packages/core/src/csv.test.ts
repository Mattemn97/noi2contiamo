import { describe, expect, it } from "vitest";
import {
  CSV_BOM,
  csvAmount,
  csvDate,
  csvText,
  movementsCsv,
  summarize,
  summaryCsv,
  totalsOf,
  type CsvNames,
  type RegisterTx,
} from "./index";

const names: CsvNames = {
  type: (t) => ({ expense: "Spesa", income: "Entrata", transfer: "Giroconto" })[t],
  account: (id) => (id === null ? "" : "Conto"),
  category: (id) => (id === null ? "" : "Caffè"),
  payee: (id) => (id === null ? "" : "Bar"),
  member: (id) => (id === null ? "Cassa comune" : "Anna"),
  yes: "sì",
};
const tx = (over: Partial<RegisterTx>): RegisterTx => ({
  id: "1",
  type: "expense",
  date: "2026-11-05",
  amountCents: 123456,
  isRefund: false,
  accountId: "a",
  toAccountId: null,
  categoryId: "c",
  payeeId: null,
  payerMemberId: "m",
  description: "Pranzo",
  notes: null,
  ...over,
});
const H = ["D", "T", "De", "C", "P", "A", "AA", "Pa", "I", "R", "N"] as const;

describe("csv", () => {
  it("formatta date e importi all'italiana", () => {
    expect(csvDate("2026-11-05")).toBe("05/11/2026");
    expect(csvAmount(123456)).toBe("1234,56");
    expect(csvAmount(-5)).toBe("-0,05");
    expect(csvAmount(0)).toBe("0,00");
  });

  it("quota solo dove serve e raddoppia le virgolette", () => {
    expect(csvText("semplice")).toBe("semplice");
    expect(csvText('dice "ciao"; poi')).toBe('"dice ""ciao""; poi"');
    expect(csvText("a\nb")).toBe('"a\nb"');
  });

  it("neutralizza le formule nei testi", () => {
    for (const bad of ["=SOMMA(A1)", "+1", "-1", "@cmd"]) expect(csvText(bad)).toBe(`'${bad}`);
    expect(csvText("5 = 5")).toBe("5 = 5");
  });

  it("esporta i movimenti con BOM, CRLF e segni", () => {
    const out = movementsCsv(
      [
        tx({ description: "=1+1" }),
        tx({ type: "income", amountCents: 100, isRefund: false }),
        tx({ isRefund: true, amountCents: 50 }),
        tx({ type: "transfer", toAccountId: "b", payerMemberId: null }),
      ],
      H,
      names,
    );
    expect(out.startsWith(CSV_BOM + "D;T;De;")).toBe(true);
    const lines = out.split("\r\n");
    expect(lines[1]).toBe("05/11/2026;Spesa;'=1+1;Caffè;;Conto;;Anna;-1234,56;;");
    expect(lines[2]).toContain(";1,00;");
    expect(lines[3]).toContain(";0,50;sì;");
    expect(lines[4]).toContain("Giroconto");
    expect(lines[4]).toContain(";1234,56;");
    expect(lines).toHaveLength(6);
  });

  it("la tabella riassuntiva torna con i totali", () => {
    const txs = [tx({}), tx({ type: "income", amountCents: 1000, categoryId: null })];
    const out = summaryCsv(
      summarize(txs, "category"),
      totalsOf(txs),
      ["V", "N", "E", "S", "Ne"],
      (k) => k ?? "Senza",
      "Totale",
    );
    const lines = out.split("\r\n");
    expect(lines.at(-2)).toBe("Totale;2;10,00;1234,56;-1224,56");
  });
});
