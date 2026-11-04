// Ogni colore principale deve avere lo stesso contrasto minimo del verde di base, nei due temi.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT_PREFERENCES, parseAccentPreference } from "./theme";
import { blocksFromCss, contrastRatio, themeValuesFromCss } from "./tokenSource";

const blocks = blocksFromCss(readFileSync(resolve(import.meta.dirname, "accents.css"), "utf8"));
const base = themeValuesFromCss(readFileSync(resolve(import.meta.dirname, "tokens.css"), "utf8"));
const SURFACES = ["--color-page", "--color-surface", "--color-surface-raised"];
const accents = ACCENT_PREFERENCES.filter((accent) => accent !== "green");

function tokens(selector: string): ReadonlyMap<string, string> {
  const found = blocks.get(selector);
  if (!found) throw new Error(`blocco mancante: ${selector}`);
  return found;
}

function need(values: ReadonlyMap<string, string>, name: string): string {
  const value = values.get(name);
  if (value === undefined) throw new Error(`token mancante: ${name}`);
  return value;
}

describe("colori principali", () => {
  describe.each(accents)("%s", (accent) => {
    const light = tokens(`:root[data-accent="${accent}"]`);
    const dark = tokens(`:root[data-theme="dark"][data-accent="${accent}"]`);

    it("i due blocchi scuri coincidono", () => {
      const media = tokens(`:root:not([data-theme="light"])[data-accent="${accent}"]`);
      expect(Object.fromEntries(media)).toEqual(Object.fromEntries(dark));
    });

    it.each([
      ["light", light],
      ["dark", dark],
    ] as const)("%s: contrasto AA", (theme, values) => {
      const color = need(values, "--color-accent");
      const on = need(values, "--color-on-accent");
      expect(contrastRatio(on, color)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(on, need(values, "--color-accent-hover"))).toBeGreaterThanOrEqual(4.5);
      const text = base.get("--color-text")?.[theme] ?? "";
      expect(contrastRatio(text, need(values, "--color-accent-subtle"))).toBeGreaterThanOrEqual(4.5);
      for (const surface of SURFACES) {
        expect(contrastRatio(color, base.get(surface)?.[theme] ?? "")).toBeGreaterThanOrEqual(4.5);
      }
    });
  });

  it("un valore sconosciuto torna al verde", () => {
    expect(parseAccentPreference("fucsia")).toBe("green");
    expect(parseAccentPreference("blue")).toBe("blue");
  });
});
