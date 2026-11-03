// Aiuti della procedura guidata di import (spec 0006): tutto il dominio sta in `core`, qui solo
// la forma del profilo da salvare e i testi degli errori.
import {
  columnsByHeader,
  decodeBytes,
  parseCsv,
  signatureOf,
  type ImportSettings,
  type InvalidRow,
  type PlanItem,
  type WriteDocOf,
} from "@noi2contiamo/core";
import { t, type MessageKey } from "../../i18n/it";

export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_ROWS = 5000;

export type WizardStep = "file" | "columns" | "preview" | "result";
export const STEP_NAMES = ["file", "columns", "preview", "confirm", "result"] as const;

/** Righe del file con le impostazioni scelte (senza leggere date e importi). */
export function rawRows(bytes: Uint8Array, settings: ImportSettings): string[][] {
  return parseCsv(decodeBytes(bytes, settings.encoding), settings);
}

/** Il profilo da salvare: le scelte di adesso, le colonne per nome se c'è un'intestazione. */
export function profileDoc(input: {
  readonly id: string;
  readonly name: string;
  readonly accountId: string;
  readonly bytes: Uint8Array;
  readonly settings: ImportSettings;
}): WriteDocOf<"importProfiles"> {
  const { settings } = input;
  const headers = settings.hasHeader ? (rawRows(input.bytes, settings)[settings.skipRows] ?? []) : [];
  const columns = columnsByHeader(settings.columns, headers, settings.hasHeader);
  return {
    id: input.id,
    name: input.name.trim().slice(0, 60) || "Profilo",
    defaultAccountId: input.accountId,
    encoding: settings.encoding,
    delimiter: settings.delimiter,
    quote: settings.quote,
    skipRows: settings.skipRows,
    hasHeader: settings.hasHeader,
    headerSignature: signatureOf(input.bytes, settings),
    columns: {
      date: columns.date,
      description: [...columns.description],
      ...(columns.amount ? { amount: columns.amount } : {}),
      ...(columns.debit ? { debit: columns.debit } : {}),
      ...(columns.credit ? { credit: columns.credit } : {}),
      ...(columns.payee ? { payee: columns.payee } : {}),
      ...(columns.type ? { type: columns.type } : {}),
    },
    dateFormat: settings.dateFormat,
    decimalSeparator: settings.decimalSeparator,
    thousandsSeparator: settings.thousandsSeparator,
    sign: {
      mode: settings.sign.mode,
      ...(settings.sign.expenseValues ? { expenseValues: [...settings.sign.expenseValues] } : {}),
      ...(settings.sign.incomeValues ? { incomeValues: [...settings.sign.incomeValues] } : {}),
    },
  };
}

/** Nome proposto per un profilo nuovo: il nome del file senza estensione né date. */
export function suggestedName(fileName: string): string {
  const base = fileName
    .replace(/\.[^.]+$/, "")
    .replace(/[_-]?\d[\d_-]*$/, "")
    .replace(/[_-]+/g, " ")
    .trim();
  return (base || "Profilo").slice(0, 60);
}

export function rowErrorText(row: InvalidRow): string {
  return t(`import.rowError.${row.error}` as MessageKey, { value: row.value });
}

export function statusLabel(item: PlanItem): string {
  return t(`import.status.${item.status}`);
}

/** "a, b , c" → ["a", "b", "c"]. */
export const splitValues = (text: string): string[] =>
  text
    .split(",")
    .map((v) => v.trim())
    .filter((v) => v !== "");

/** Stessa forma di impostazioni (per sapere se il profilo usato è cambiato). */
export const sameSettings = (a: ImportSettings, b: ImportSettings): boolean =>
  JSON.stringify(a) === JSON.stringify(b);
