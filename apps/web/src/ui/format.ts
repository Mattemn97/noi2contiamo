// Formattazione e lettura di importi, percentuali e date in it-IT. Funzioni pure, niente virgola mobile sul denaro.
import { cents, err, ok, type BasisPoints, type Cents, type Result } from "@noi2contiamo/core";

export const LOCALE = "it-IT";
const MINUS = "−";

/** Intero scalato di 10^digits → stringa decimale esatta (123456, 2 → "1234.56"), senza dividere. */
function scaledToDecimalString(value: number, digits: number): Intl.StringNumericLiteral {
  const text = Math.abs(value)
    .toString()
    .padStart(digits + 1, "0");
  return `${value < 0 ? "-" : ""}${text.slice(0, -digits)}.${text.slice(-digits)}` as Intl.StringNumericLiteral;
}

function withMinusSign(parts: readonly Intl.NumberFormatPart[]): string {
  return parts.map((part) => (part.type === "minusSign" ? MINUS : part.value)).join("");
}

const euroAuto = new Intl.NumberFormat(LOCALE, { style: "currency", currency: "EUR", useGrouping: "always" });
const euroSigned = new Intl.NumberFormat(LOCALE, {
  style: "currency",
  currency: "EUR",
  useGrouping: "always",
  signDisplay: "exceptZero",
});
const percent = new Intl.NumberFormat(LOCALE, { style: "percent", maximumFractionDigits: 2 });
const decimal = new Intl.NumberFormat(LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: "always",
});

export type SignMode = "auto" | "always";

/** `Cents` → euro it-IT ("1.234,56 €"). Il negativo usa "−"; con `"always"` anche il "+" delle entrate. */
export function formatCents(value: Cents, sign: SignMode = "auto"): string {
  const formatter = sign === "always" ? euroSigned : euroAuto;
  return withMinusSign(formatter.formatToParts(scaledToDecimalString(value, 2)));
}

/** Punti base → percentuale it-IT (1250 → "12,5%"). */
export function formatBasisPoints(value: BasisPoints): string {
  return withMinusSign(percent.formatToParts(scaledToDecimalString(value, 4)));
}

/** Intero scalato di 100 → testo per un campo in modifica (123456 → "1.234,56"). */
export function formatScaledInput(value: number): string {
  return withMinusSign(decimal.formatToParts(scaledToDecimalString(value, 2)));
}

export type DecimalInputError = "empty" | "invalid" | "precision";

/**
 * Testo scritto in formato it-IT → intero scalato di 100 (euro → centesimi, percento → punti base).
 * Virgola decimale e punto delle migliaia ("1.234,56"). Un punto solo seguito da 1 o 2 cifre vale come
 * decimale ("12.5"), perché molte tastiere numeriche hanno solo il punto. Al massimo 2 decimali.
 */
export function parseScaledDecimal(text: string): Result<number, DecimalInputError> {
  // `\s` copre già gli spazi unificatori che Intl mette tra numero e simbolo.
  const compact = text.replace(/[\s€%]/g, "");
  if (compact === "") return err("empty");
  const signMatch = /^[+\-−]/.exec(compact);
  const negative = signMatch !== null && signMatch[0] !== "+";
  const unsigned = signMatch ? compact.slice(1) : compact;
  const body =
    !unsigned.includes(",") && /^\d+\.\d{1,2}$/.test(unsigned) ? unsigned.replace(".", ",") : unsigned;
  const parts = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d*))?$/.exec(body);
  if (!parts) return err("invalid");
  const fraction = parts[2] ?? "";
  if (fraction.length > 2) return err("precision");
  const scaled = Number(`${(parts[1] ?? "").replaceAll(".", "")}${fraction.padEnd(2, "0")}`);
  if (!Number.isSafeInteger(scaled)) return err("invalid");
  return ok(negative && scaled !== 0 ? -scaled : scaled);
}

export function parseEuroInput(text: string): Result<Cents, DecimalInputError> {
  const parsed = parseScaledDecimal(text);
  return parsed.ok ? ok(cents(parsed.value)) : parsed;
}

export function parsePercentInput(text: string): Result<BasisPoints, DecimalInputError> {
  const parsed = parseScaledDecimal(text);
  return parsed.ok ? ok(parsed.value as BasisPoints) : parsed;
}

const dateFormat = new Intl.DateTimeFormat(LOCALE, { day: "numeric", month: "long", year: "numeric" });
const monthFormat = new Intl.DateTimeFormat(LOCALE, { month: "long", year: "numeric" });

export function formatDate(date: Date): string {
  return dateFormat.format(date);
}

/** Mese in italiano con l'iniziale maiuscola, per titoli e legende ("Novembre 2026"). */
export function formatMonth(date: Date): string {
  const text = monthFormat.format(date);
  return text.charAt(0).toUpperCase() + text.slice(1);
}
