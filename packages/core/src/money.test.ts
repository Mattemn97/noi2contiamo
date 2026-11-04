import { describe, expect, it } from "vitest";
import { cents, sumCents } from "./index";

describe("money", () => {
  it("somma centesimi interi in modo esatto", () => {
    expect(sumCents([cents(10), cents(20)])).toBe(30);
  });

  it("rifiuta importi con decimali", () => {
    expect(() => cents(0.1)).toThrow(RangeError);
  });
});
