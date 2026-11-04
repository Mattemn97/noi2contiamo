// AC-7: colori dagli slot in ordine, confronto in grigio, "Altro" oltre l'ottava voce, colore stabile per membro.
import { describe, expect, it } from "vitest";
import { assignSeriesColors, foldIntoOther, memberColors, seriesColor } from "./seriesColor";

describe("seriesColor", () => {
  it("assegna gli slot 1..8 in ordine e poi il grigio di Altro", () => {
    expect(seriesColor(0)).toBe("var(--series-1)");
    expect(seriesColor(7)).toBe("var(--series-8)");
    expect(seriesColor(8)).toBe("var(--chart-other)");
  });

  it("confronto e Altro non consumano slot", () => {
    expect(
      assignSeriesColors([
        { key: "nov", label: "Novembre 2026" },
        { key: "ott", label: "Ottobre 2026", kind: "compare" },
        { key: "altro", label: "Altro", kind: "other" },
        { key: "extra", label: "Extra" },
      ]),
    ).toEqual({
      nov: "var(--series-1)",
      ott: "var(--chart-compare)",
      altro: "var(--chart-other)",
      extra: "var(--series-2)",
    });
  });

  it("il colore di un membro dipende dall'ordine di ingresso, non dall'ordine della lista", () => {
    const anna = { id: "anna", joinedAt: "2026-01-01T00:00:00Z" };
    const luca = { id: "luca", joinedAt: "2026-02-01T00:00:00Z" };
    expect(memberColors([luca, anna])).toEqual(memberColors([anna, luca]));
    expect(memberColors([luca, anna])).toEqual({ anna: "var(--series-1)", luca: "var(--series-2)" });
  });
});

describe("foldIntoOther", () => {
  const parts = Array.from({ length: 10 }, (_, index) => ({
    key: `c${String(index)}`,
    label: `Voce ${String(index)}`,
    value: (index + 1) * 10,
  }));

  it("lascia intatte fino a 8 voci, ordinate dalla più grande", () => {
    const result = foldIntoOther(parts.slice(0, 3), "Altro");
    expect(result.map((part) => part.value)).toEqual([30, 20, 10]);
  });

  it("oltre 8 voci unisce le più piccole in Altro e conserva il totale", () => {
    const result = foldIntoOther(parts, "Altro");
    expect(result).toHaveLength(8);
    expect(result.at(-1)).toEqual({ key: "altro", label: "Altro", value: 10 + 20 + 30 });
    const total = (list: readonly { readonly value: number }[]): number =>
      list.reduce((sum, part) => sum + part.value, 0);
    expect(total(result)).toBe(total(parts));
  });
});
