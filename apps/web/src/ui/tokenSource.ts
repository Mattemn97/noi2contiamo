// Lettura dei token da docs/design.md e da tokens.css, per i test (AC-1, AC-3). Funzioni pure su stringhe.

export interface ThemeValues {
  readonly light: string;
  readonly dark: string;
}

const TOKEN = /`(--[a-z0-9-]+)`/g;
const HEX = /^#[0-9a-f]{6}$/i;

/**
 * Colori dichiarati in design.md. Dopo ogni nome di token tra backtick si leggono i valori esadecimali
 * tra backtick che lo seguono (uno: uguale nei due temi; due: chiaro e scuro). Vince la prima definizione.
 */
export function colorsFromDesign(markdown: string): ReadonlyMap<string, ThemeValues> {
  const result = new Map<string, ThemeValues>();
  for (const line of markdown.split("\n")) {
    const items = [...line.matchAll(/`([^`]+)`/g)].map((match) => match[1] ?? "");
    items.forEach((item, index) => {
      if (!item.startsWith("--") || result.has(item)) return;
      const hexes: string[] = [];
      for (const next of items.slice(index + 1)) {
        if (!HEX.test(next) || hexes.length === 2) break;
        hexes.push(next.toLowerCase());
      }
      const [light, dark] = hexes;
      if (light !== undefined) result.set(item, { light, dark: dark ?? light });
    });
  }
  return result;
}

/** Tutti i nomi di token citati in design.md (esclusi i caratteri jolly come `--color-on-*`). */
export function tokenNamesFromDesign(markdown: string): ReadonlySet<string> {
  return new Set([...markdown.matchAll(TOKEN)].map((match) => match[1] ?? ""));
}

/** Dimensioni scritte in chiaro dopo il nome, es. "`--space-1` 0.25rem" o "| `--text-xs` | 0.75rem / 1rem |". */
export function dimensionsFromDesign(markdown: string): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  for (const match of markdown.matchAll(
    /`(--[a-z0-9-]+)`\s*\|?\s*(\d+(?:\.\d+)?(?:rem|px|ms)?)(?=[\s,|.;)]|$)/g,
  )) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined && !result.has(name)) result.set(name, value);
  }
  return result;
}

/** Dichiarazioni di tokens.css raggruppate per selettore (i blocchi con lo stesso selettore si uniscono). */
export function blocksFromCss(css: string): ReadonlyMap<string, ReadonlyMap<string, string>> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const blocks = new Map<string, Map<string, string>>();
  for (const match of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = (match[1] ?? "").trim();
    const declarations = blocks.get(selector) ?? new Map<string, string>();
    for (const declaration of (match[2] ?? "").split(";")) {
      const colon = declaration.indexOf(":");
      if (colon < 0) continue;
      declarations.set(
        declaration.slice(0, colon).trim(),
        declaration
          .slice(colon + 1)
          .trim()
          .toLowerCase(),
      );
    }
    blocks.set(selector, declarations);
  }
  return blocks;
}

export const LIGHT_SELECTOR = ":root";
export const DARK_MEDIA_SELECTOR = ':root:not([data-theme="light"])';
export const DARK_SELECTOR = ':root[data-theme="dark"]';

/** Valori risolti di un token nei due temi (il tema scuro eredita dal chiaro ciò che non ridefinisce). */
export function themeValuesFromCss(css: string): ReadonlyMap<string, ThemeValues> {
  const blocks = blocksFromCss(css);
  const light = blocks.get(LIGHT_SELECTOR) ?? new Map<string, string>();
  const dark = blocks.get(DARK_SELECTOR) ?? new Map<string, string>();
  const result = new Map<string, ThemeValues>();
  for (const [name, value] of light) {
    if (name.startsWith("--")) result.set(name, { light: value, dark: dark.get(name) ?? value });
  }
  return result;
}

/** Luminanza relativa e rapporto di contrasto WCAG 2.x. */
export function contrastRatio(foreground: string, background: string): number {
  const luminance = (hex: string): number => {
    const channels = [1, 3, 5].map((start) => parseInt(hex.slice(start, start + 2), 16) / 255);
    const [r = 0, g = 0, b = 0] = channels.map((c) =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
    );
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [high, low] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
}
