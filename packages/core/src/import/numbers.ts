// Importi del CSV in centesimi interi (spec 0006, AC-5): mai decimali, si lavora sulla stringa.
import { err, ok, type Result } from "../result";

export type DecimalSeparator = "," | ".";
export type ThousandsSeparator = "." | "," | " " | "";

export interface NumberFormat {
  readonly decimalSeparator: DecimalSeparator;
  readonly thousandsSeparator: ThousandsSeparator;
}

/** Centesimi con segno; `empty` se la cella è vuota (utile per le colonne Dare e Avere). */
export function parseAmount(
  raw: string,
  fmt: NumberFormat,
): Result<number, "empty" | "invalid" | "decimals"> {
  let text = raw
    .replace(/[\s\u00a0\u202f]+/g, " ")
    .replace(/€|eur/gi, "")
    .trim();
  if (fmt.thousandsSeparator !== " ") text = text.replace(/ /g, "");
  if (text === "") return err("empty");
  let negative = false;
  if (/^\(.*\)$/.test(text)) {
    negative = true;
    text = text.slice(1, -1).trim();
  }
  text = text.replace(/\u2212/g, "-");
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.endsWith("-")) {
    negative = true;
    text = text.slice(0, -1);
  } else if (text.startsWith("+")) text = text.slice(1);
  text = text.trim();
  if (fmt.thousandsSeparator !== "") text = text.split(fmt.thousandsSeparator).join("");
  const parts = text.split(fmt.decimalSeparator);
  if (parts.length > 2) return err("invalid");
  const whole = parts[0] ?? "";
  let fraction = parts[1] ?? "";
  if (!/^\d*$/.test(whole) || !/^\d*$/.test(fraction) || (whole === "" && fraction === ""))
    return err("invalid");
  if (fraction.length > 2) {
    if (!/^0*$/.test(fraction.slice(2))) return err("decimals");
    fraction = fraction.slice(0, 2);
  }
  const cents = Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents)) return err("invalid");
  return ok(negative ? -cents : cents);
}

/**
 * Il formato degli importi dai campioni: se l'ultimo separatore di un campione è seguito da 1 o 2 cifre
 * è il decimale. Con soli interi (o nessun campione) vale il formato italiano.
 */
export function detectNumberFormat(samples: readonly string[]): NumberFormat {
  let comma = 0;
  let dot = 0;
  for (const sample of samples) {
    const m = /([.,])(\d{1,2})\D*$/.exec(sample.trim());
    if (m?.[1] === ",") comma += 1;
    else if (m?.[1] === ".") dot += 1;
  }
  if (dot > comma)
    return { decimalSeparator: ".", thousandsSeparator: samples.some((s) => /\d,\d{3}/.test(s)) ? "," : "" };
  return { decimalSeparator: ",", thousandsSeparator: samples.some((s) => /\d\.\d{3}/.test(s)) ? "." : "" };
}
