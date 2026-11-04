import { describe, expect, it } from "vitest";
import { allocateShares, equalShares, memberAmounts, resolveSplit } from "./index";

const sum = (r: Record<string, number>) => Object.values(r).reduce((a, b) => a + b, 0);

describe("allocateShares (AC-3)", () => {
  it("100 centesimi su 3333/3333/3334 danno 33/33/34", () => {
    expect(allocateShares(100, { a: 3333, b: 3333, c: 3334 })).toEqual({ a: 33, b: 33, c: 34 });
  });

  it("10001 centesimi su 60/40 danno 6001/4000", () => {
    expect(allocateShares(10001, { m1: 6000, m2: 4000 })).toEqual({ m1: 6001, m2: 4000 });
  });

  it("10 centesimi su 3333/3333/3334: il resto più grande vince", () => {
    expect(allocateShares(10, { a: 3333, b: 3333, c: 3334 })).toEqual({ a: 3, b: 3, c: 4 });
  });

  it("pareggi sui resti al memberId più piccolo, qualunque sia l'ordine delle chiavi", () => {
    const shares = equalShares(["b", "a", "c"]);
    expect(allocateShares(1, shares)).toEqual({ a: 1, b: 0, c: 0 });
    expect(allocateShares(2, { c: 5000, a: 5000 })).toEqual({ a: 1, c: 1 });
    expect(allocateShares(1, { c: 5000, a: 5000 })).toEqual(allocateShares(1, { a: 5000, c: 5000 }));
    expect(allocateShares(1, { c: 5000, a: 5000 })).toEqual({ a: 1, c: 0 });
  });

  it("la somma è sempre esattamente l'importo", () => {
    const shares = { x: 1234, y: 4321, z: 4445 };
    for (const amount of [0, 1, 2, 3, 7, 99, 100, 101, 12345, 987654321, 2 ** 52]) {
      expect(sum(allocateShares(amount, shares))).toBe(amount);
    }
  });

  it("una quota a zero riceve zero", () => {
    expect(allocateShares(999, { a: 10000, b: 0 })).toEqual({ a: 999, b: 0 });
  });

  it("rifiuta quote che non sommano a 10000 o importi non interi (bug, non input utente)", () => {
    expect(() => allocateShares(100, { a: 5000, b: 4999 })).toThrow(RangeError);
    expect(() => allocateShares(1.5, { a: 10000 })).toThrow(RangeError);
    expect(() => allocateShares(100, {})).toThrow(RangeError);
    expect(() => allocateShares(100, { a: 10001, b: -1 })).toThrow(RangeError);
  });
});

describe("equalShares", () => {
  it("divide 10000 in parti esatte", () => {
    expect(equalShares(["c", "a", "b"])).toEqual({ a: 3334, b: 3333, c: 3333 });
    expect(equalShares(["a", "b"])).toEqual({ a: 5000, b: 5000 });
    expect(() => equalShares([])).toThrow(RangeError);
  });
});

describe("memberAmounts e resolveSplit", () => {
  it("cents restituisce le quote così come sono", () => {
    expect(memberAmounts(500, { kind: "cents", source: "manual", shares: { a: 200, b: 300 } })).toEqual({
      a: 200,
      b: 300,
    });
    expect(memberAmounts(3, { kind: "bp", source: "default", shares: { a: 5000, b: 5000 } })).toEqual({
      a: 2,
      b: 1,
    });
  });

  it("regola, poi categoria, poi famiglia", () => {
    const family = { kind: "bp", shares: { a: 5000, b: 5000 } } as const;
    const category = { kind: "bp", shares: { a: 6000, b: 4000 } } as const;
    const rule = { kind: "bp", shares: { a: 10000 } } as const;
    expect(resolveSplit({ rule, category, family })).toEqual({
      kind: "bp",
      source: "rule",
      shares: { a: 10000 },
    });
    expect(resolveSplit({ rule: null, category, family }).source).toBe("category");
    expect(resolveSplit({ family })).toEqual({ kind: "bp", source: "default", shares: { a: 5000, b: 5000 } });
  });
});
