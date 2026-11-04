// AC-1 (design.md e tokens.css coincidono), AC-3 (contrasto), AC-4 (nessun colore scritto a mano).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  blocksFromCss,
  colorsFromDesign,
  contrastRatio,
  DARK_MEDIA_SELECTOR,
  DARK_SELECTOR,
  dimensionsFromDesign,
  themeValuesFromCss,
  tokenNamesFromDesign,
} from "./tokenSource";

const SRC = resolve(import.meta.dirname, "..");
const design = readFileSync(resolve(SRC, "../../../docs/design.md"), "utf8");
const css = readFileSync(resolve(SRC, "ui/tokens.css"), "utf8");
const cssValues = themeValuesFromCss(css);

// Token tecnici che design.md descrive a parole ma non nomina: interlinea della tabella tipografica,
// stack del font, larghezza massima del contenuto, altezza della barra in basso.
const DERIVED = /^--(leading-[a-z0-9]+|font-sans|content-max|nav-height)$/;

describe("AC-1: tokens.css rispecchia docs/design.md", () => {
  it("ogni token citato in design.md esiste in tokens.css", () => {
    const missing = [...tokenNamesFromDesign(design)].filter((name) => !cssValues.has(name));
    expect(missing).toEqual([]);
  });

  it("tokens.css non ha token che design.md non conosce", () => {
    const names = tokenNamesFromDesign(design);
    const extra = [...cssValues.keys()].filter((name) => !names.has(name) && !DERIVED.test(name));
    expect(extra).toEqual([]);
  });

  it("i colori hanno gli stessi valori chiaro e scuro", () => {
    const colors = colorsFromDesign(design);
    expect(colors.size).toBeGreaterThan(45);
    const diff = [...colors].flatMap(([name, expected]) => {
      const actual = cssValues.get(name);
      return actual?.light === expected.light && actual.dark === expected.dark
        ? []
        : [{ name, expected, actual }];
    });
    expect(diff).toEqual([]);
  });

  it("le misure (spazi, raggi, testo, durate, livelli, punti di rottura) coincidono", () => {
    const dimensions = dimensionsFromDesign(design);
    expect(dimensions.size).toBeGreaterThan(30);
    const diff = [...dimensions].filter(([name, value]) => cssValues.get(name)?.light !== value);
    expect(diff).toEqual([]);
  });

  it("i due blocchi scuri (media query e scelta esplicita) sono identici", () => {
    const blocks = blocksFromCss(css);
    const media = Object.fromEntries(blocks.get(DARK_MEDIA_SELECTOR) ?? []);
    const forced = Object.fromEntries(
      [...(blocks.get(DARK_SELECTOR) ?? [])].filter(([name]) => name.startsWith("--")),
    );
    expect(Object.keys(media).length).toBeGreaterThan(20);
    expect(forced).toEqual(media);
  });
});

describe("AC-3: contrasto calcolato dai token, nei due temi", () => {
  const value = (name: string, theme: "light" | "dark"): string => {
    const found = cssValues.get(name);
    if (!found) throw new Error(`token mancante: ${name}`);
    return found[theme];
  };
  const TEXT = [
    "--color-text",
    "--color-text-secondary",
    "--color-text-tertiary",
    "--color-accent",
    "--color-danger-text",
    "--color-success-text",
    "--color-warning-text",
  ];
  const SURFACES = ["--color-page", "--color-surface", "--color-surface-raised"];
  const pairs: readonly (readonly [string, string, number])[] = [
    ...TEXT.flatMap((text) => SURFACES.map((surface) => [text, surface, 4.5] as const)),
    ["--color-text", "--color-surface-sunken", 4.5],
    ["--color-text-secondary", "--color-surface-sunken", 4.5],
    ["--color-on-accent", "--color-accent", 4.5],
    ["--color-on-accent", "--color-accent-hover", 4.5],
    ["--color-on-danger", "--color-danger", 4.5],
    ["--color-text", "--color-accent-subtle", 4.5],
    ["--chart-label", "--chart-surface", 4.5],
    ["--color-border-strong", "--color-surface", 3],
    ["--color-border-strong", "--color-page", 3],
    ["--color-focus", "--color-page", 3],
    ["--color-focus", "--color-surface", 3],
  ];

  for (const theme of ["light", "dark"] as const) {
    it.each(pairs)(`${theme}: %s su %s arriva a %s:1`, (foreground, background, minimum) => {
      expect(contrastRatio(value(foreground, theme), value(background, theme))).toBeGreaterThanOrEqual(
        minimum,
      );
    });
  }

  it("calcola il contrasto WCAG noto tra nero e bianco", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
  });
});

describe("AC-4: nessun colore scritto a mano fuori da tokens.css", () => {
  const COLOR = /#[0-9a-f]{3,8}\b(?![-\w])|\b(?:rgba?|hsla?|oklch|oklab|lab|lch)\(/i;
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      return statSync(path).isDirectory() ? files(path) : [path];
    });
  const sources = files(SRC).filter(
    (path) => /\.(css|tsx)$/.test(path) && !path.endsWith(join("ui", "tokens.css")),
  );

  it("scansiona davvero i sorgenti", () => {
    expect(sources.length).toBeGreaterThan(10);
  });

  it.each(sources.map((path) => [relative(SRC, path), path]))("%s", (_name, path) => {
    const lines = readFileSync(path, "utf8").split("\n");
    const violations = lines.flatMap((line, index) =>
      COLOR.test(line) ? [`${index + 1}: ${line.trim()}`] : [],
    );
    expect(violations).toEqual([]);
  });
});
