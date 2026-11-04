import { describe, expect, it } from "vitest";
import { fingerprintRows, importFingerprint, normalize } from "./index";

const row = { accountId: "acc", date: "2026-11-03", signedAmountCents: -1250, description: "  Caffè   BAR " };

describe("importFingerprint (AC-6)", () => {
  it("è stabile tra due import dello stesso file", () => {
    expect(fingerprintRows([row, { ...row, date: "2026-11-04" }])).toEqual(
      fingerprintRows([row, { ...row, date: "2026-11-04" }]),
    );
    expect(importFingerprint(row, 0)).toMatch(/^[0-9a-f]{32}$/);
  });

  it("due righe identiche nello stesso file hanno impronte diverse", () => {
    const [first, second] = fingerprintRows([row, { ...row }]);
    expect(first).not.toBe(second);
    expect(first).toBe(importFingerprint(row, 0));
    expect(second).toBe(importFingerprint(row, 1));
  });

  it("usa la descrizione normalizzata, il segno e il conto", () => {
    expect(importFingerprint({ ...row, description: "caffe bar" }, 0)).toBe(importFingerprint(row, 0));
    expect(importFingerprint({ ...row, signedAmountCents: 1250 }, 0)).not.toBe(importFingerprint(row, 0));
    expect(importFingerprint({ ...row, accountId: "altro" }, 0)).not.toBe(importFingerprint(row, 0));
  });
});

describe("normalize", () => {
  it("minuscolo, senza accenti, spazi compressi", () => {
    expect(normalize("  Perché   Così\tÈ ")).toBe("perche cosi e");
  });
});
