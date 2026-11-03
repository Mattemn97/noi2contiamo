// Date del CSV (spec 0006, AC-4): un piccolo lettore a token, i formati italiani per primi.
import { isIsoDate, type IsoDate } from "../ids";
import { err, ok, type Result } from "../result";

/** In ordine di preferenza: il primo che legge tutti i campioni viene proposto. */
export const DATE_FORMATS = [
  "dd/MM/yyyy",
  "d/M/yyyy",
  "dd-MM-yyyy",
  "dd.MM.yyyy",
  "yyyy-MM-dd",
  "dd/MM/yy",
  "MM/dd/yyyy",
] as const;

const TOKEN = /yyyy|yy|MM|M|dd|d/g;

/** Legge la data all'inizio della cella; un orario dopo (`08:12:33`, `T08:12`) si ignora. */
export function parseDate(raw: string, pattern: string): Result<IsoDate, "invalid"> {
  const tokens: string[] = [];
  const source = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(TOKEN, (token) => {
    tokens.push(token);
    return token.length === 1 ? "(\\d{1,2})" : token === "yy" ? "(\\d{2})" : `(\\d{${token.length}})`;
  });
  const match = new RegExp(`^${source}(?:$|[\\sT])`).exec(raw.trim());
  if (!match) return err("invalid");
  let year = 0;
  let month = 0;
  let day = 0;
  tokens.forEach((token, i) => {
    const value = Number(match[i + 1]);
    if (token.startsWith("y")) year = token === "yy" ? 2000 + value : value;
    else if (token.startsWith("M")) month = value;
    else day = value;
  });
  const iso = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return isIsoDate(iso) ? ok(iso) : err("invalid");
}

/** Il primo formato di `DATE_FORMATS` che legge tutti i campioni non vuoti; null se nessuno. */
export function detectDateFormat(samples: readonly string[]): string | null {
  const filled = samples.map((s) => s.trim()).filter((s) => s !== "");
  if (filled.length === 0) return null;
  return DATE_FORMATS.find((fmt) => filled.every((s) => parseDate(s, fmt).ok)) ?? null;
}
