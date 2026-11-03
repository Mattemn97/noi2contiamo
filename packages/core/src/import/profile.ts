// Impostazioni di lettura e profili salvati (spec 0006, AC-3, AC-7, AC-8).
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import { normalize } from "../normalize";
import type { ImportProfile } from "../model/schemas";
import { detectDelimiter, parseCsv, type Delimiter } from "./csv";
import { detectDateFormat } from "./dates";
import { decodeBytes, detectEncoding, type FileEncoding } from "./decode";
import { detectNumberFormat, type DecimalSeparator, type ThousandsSeparator } from "./numbers";

export type ColRef = { readonly header: string } | { readonly index: number };
export type SignMode = ImportProfile["sign"]["mode"];

export interface ImportColumns {
  readonly date: ColRef;
  readonly description: readonly ColRef[];
  readonly amount?: ColRef | undefined;
  readonly debit?: ColRef | undefined;
  readonly credit?: ColRef | undefined;
  readonly payee?: ColRef | undefined;
  readonly type?: ColRef | undefined;
}

/** Tutto quello che serve per leggere un file: il profilo senza id, nome, conto, firma e audit. */
export interface ImportSettings {
  readonly encoding: FileEncoding;
  readonly delimiter: Delimiter;
  readonly quote: string;
  readonly skipRows: number;
  readonly hasHeader: boolean;
  readonly columns: ImportColumns;
  readonly dateFormat: string;
  readonly decimalSeparator: DecimalSeparator;
  readonly thousandsSeparator: ThousandsSeparator;
  readonly sign: {
    readonly mode: SignMode;
    readonly expenseValues?: readonly string[] | undefined;
    readonly incomeValues?: readonly string[] | undefined;
  };
}

/** Firma dell'intestazione: hash delle celle normalizzate, per riconoscere la banca da sola. */
export function headerSignature(headers: readonly string[]): string {
  return bytesToHex(sha256(utf8ToBytes(headers.map(normalize).join("|")))).slice(0, 32);
}

const looksLikeDate = (cell: string) => detectDateFormat([cell]) !== null;

/**
 * Indice della riga di intestazione: la prima (entro le prime 20) con almeno 3 celle piene, nessuna
 * data, seguita da una riga che contiene una data. Se la prima riga ha già una data, non c'è
 * intestazione: `{ skipRows: 0, hasHeader: false }`.
 */
export function detectHeaderRow(rows: readonly (readonly string[])[]): {
  skipRows: number;
  hasHeader: boolean;
} {
  if (rows[0]?.some(looksLikeDate)) return { skipRows: 0, hasHeader: false };
  // Le righe del conto prima della tabella hanno di solito 2 celle: l'intestazione ne ha almeno 3.
  const minFilled = Math.min(3, Math.max(2, ...rows.map((r) => r.length)));
  for (let i = 0; i < Math.min(20, rows.length - 1); i++) {
    const row = rows[i] ?? [];
    const filled = row.filter((c) => c.trim() !== "").length;
    if (filled >= minFilled && !row.some(looksLikeDate) && (rows[i + 1] ?? []).some(looksLikeDate))
      return { skipRows: i, hasHeader: true };
  }
  return { skipRows: 0, hasHeader: true };
}

/** I nomi delle colonne: l'intestazione o "Colonna N" (il testo lo mette l'interfaccia). */
export function headersOf(
  rows: readonly (readonly string[])[],
  settings: Pick<ImportSettings, "skipRows" | "hasHeader">,
): string[] {
  const width = Math.max(0, ...rows.slice(settings.skipRows).map((r) => r.length));
  const header = settings.hasHeader ? (rows[settings.skipRows] ?? []) : [];
  return Array.from({ length: width }, (_, i) => header[i]?.trim() ?? "");
}

/** Indice della colonna di un riferimento; -1 se l'intestazione non c'è. */
export function columnIndex(ref: ColRef, headers: readonly string[]): number {
  if ("index" in ref) return ref.index < headers.length ? ref.index : -1;
  const key = normalize(ref.header);
  return headers.findIndex((h) => normalize(h) === key);
}

const SYNONYMS = {
  date: [
    "data operazione",
    "data contabile",
    "data",
    "date",
    "started date",
    "completed date",
    "data valuta",
  ],
  description: ["descrizione", "description", "causale", "descrizione operazione", "dettagli", "operazione"],
  amount: ["importo", "amount", "netto", "importo (eur)", "importo eur", "lordo", "valore"],
  debit: ["addebiti", "addebito", "dare", "uscite", "importo dare"],
  credit: ["accrediti", "accredito", "avere", "entrate", "importo avere"],
  payee: ["nome", "destinatario", "beneficiario", "esercente", "merchant", "controparte", "name"],
  type: ["tipo", "type", "segno", "tipologia"],
} as const;

function findColumn(
  headers: readonly string[],
  names: readonly string[],
  taken: ReadonlySet<number>,
): number {
  const normalized = headers.map(normalize);
  for (const name of names) {
    const i = normalized.findIndex((h, idx) => h === name && !taken.has(idx));
    if (i >= 0) return i;
  }
  return -1;
}

const NUMBER_LIKE = /^[(+\-−]?\s*\d[\d.,\s]*[)-]?\s*(€|eur)?$/i;
const EXPENSE_WORDS = /pagament|addebit|uscit|spes|acquist|prelievo|payment|debit|card/i;

/** Una proposta di impostazioni dai byte del file: codifica, separatore, intestazione, colonne, formati. */
export function guessSettings(bytes: Uint8Array): ImportSettings {
  const encoding = detectEncoding(bytes);
  const text = decodeBytes(bytes, encoding);
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, { delimiter });
  const { skipRows, hasHeader } = detectHeaderRow(rows);
  const headers = headersOf(rows, { skipRows, hasHeader });
  const data = rows.slice(skipRows + (hasHeader ? 1 : 0), skipRows + (hasHeader ? 1 : 0) + 50);
  const taken = new Set<number>();
  const pick = (names: readonly string[]) => {
    const i = findColumn(headers, names, taken);
    if (i >= 0) taken.add(i);
    return i;
  };
  let date = pick(SYNONYMS.date);
  if (date < 0)
    date = Math.max(
      0,
      headers.findIndex((_, i) => data.some((r) => looksLikeDate(r[i] ?? ""))),
    );
  taken.add(date);
  const debit = pick(SYNONYMS.debit);
  const credit = pick(SYNONYMS.credit);
  let amount = debit >= 0 && credit >= 0 ? -1 : pick(SYNONYMS.amount);
  if (amount < 0 && !(debit >= 0 && credit >= 0)) {
    // Senza un nome riconosciuto: la prima colonna libera che sembra un importo in tutte le righe.
    amount = headers.findIndex(
      (_, i) => !taken.has(i) && data.length > 0 && data.every((r) => NUMBER_LIKE.test((r[i] ?? "").trim())),
    );
    if (amount >= 0) taken.add(amount);
  }
  const payee = pick(SYNONYMS.payee);
  const typeCol = pick(SYNONYMS.type);
  let description = pick(SYNONYMS.description);
  if (description < 0) description = payee >= 0 ? payee : headers.findIndex((_, i) => !taken.has(i));
  const samples = (i: number) => data.map((r) => r[i] ?? "").filter((s) => s.trim() !== "");
  const amountCols = amount >= 0 ? [amount] : [debit, credit].filter((i) => i >= 0);
  const numberFormat = detectNumberFormat(amountCols.flatMap(samples));
  const hasNegative = amount >= 0 && samples(amount).some((s) => /^\s*[-−(]|-\s*$/.test(s));
  let sign: ImportSettings["sign"] = { mode: "negativeIsExpense" };
  if (debit >= 0 && credit >= 0) sign = { mode: "debitCreditColumns" };
  else if (!hasNegative && typeCol >= 0) {
    const values = [...new Set(samples(typeCol).map((s) => s.trim()))];
    sign = {
      mode: "typeColumn",
      expenseValues: values.filter((v) => EXPENSE_WORDS.test(v)),
      incomeValues: values.filter((v) => !EXPENSE_WORDS.test(v)),
    };
  }
  const ref = (i: number): ColRef => ({ index: i });
  return {
    encoding,
    delimiter,
    quote: '"',
    skipRows,
    hasHeader,
    columns: {
      date: ref(date),
      description: [ref(Math.max(0, description))],
      ...(amount >= 0 ? { amount: ref(amount) } : {}),
      ...(debit >= 0 && credit >= 0 ? { debit: ref(debit), credit: ref(credit) } : {}),
      ...(payee >= 0 ? { payee: ref(payee) } : {}),
      ...(sign.mode === "typeColumn" ? { type: ref(typeCol) } : {}),
    },
    dateFormat: detectDateFormat(samples(date)) ?? "dd/MM/yyyy",
    ...numberFormat,
    sign,
  };
}

/** Le impostazioni di un profilo salvato. */
export function settingsOf(profile: ImportProfile): ImportSettings {
  return {
    encoding: profile.encoding,
    delimiter: profile.delimiter,
    quote: profile.quote,
    skipRows: profile.skipRows,
    hasHeader: profile.hasHeader,
    columns: profile.columns,
    dateFormat: profile.dateFormat,
    decimalSeparator: profile.decimalSeparator,
    thousandsSeparator: profile.thousandsSeparator,
    sign: profile.sign,
  };
}

/** Le colonne con i nomi dell'intestazione (resistono a un cambio d'ordine), se c'è un'intestazione. */
export function columnsByHeader(
  columns: ImportColumns,
  headers: readonly string[],
  hasHeader: boolean,
): ImportColumns {
  const byName = (ref: ColRef): ColRef => {
    if (!hasHeader || !("index" in ref)) return ref;
    const name = headers[ref.index];
    const unique = name && headers.filter((h) => normalize(h) === normalize(name)).length === 1;
    return unique ? { header: name } : ref;
  };
  return {
    date: byName(columns.date),
    description: columns.description.map(byName),
    ...(columns.amount ? { amount: byName(columns.amount) } : {}),
    ...(columns.debit ? { debit: byName(columns.debit) } : {}),
    ...(columns.credit ? { credit: byName(columns.credit) } : {}),
    ...(columns.payee ? { payee: byName(columns.payee) } : {}),
    ...(columns.type ? { type: byName(columns.type) } : {}),
  };
}

/** Firma del file letto con quelle impostazioni (null senza intestazione). */
export function signatureOf(
  bytes: Uint8Array,
  settings: Pick<ImportSettings, "encoding" | "delimiter" | "quote" | "skipRows" | "hasHeader">,
): string | null {
  if (!settings.hasHeader) return null;
  const rows = parseCsv(decodeBytes(bytes, settings.encoding), settings);
  const header = rows[settings.skipRows];
  return header ? headerSignature(header) : null;
}

/**
 * Il profilo salvato che riconosce il file: stessa firma dell'intestazione letta con i parametri del
 * profilo. A parità vince quello del conto scelto, poi il più recente.
 */
export function matchProfile<P extends ImportProfile>(
  bytes: Uint8Array,
  profiles: readonly P[],
  accountId: string | null,
): P | null {
  const matching = profiles.filter(
    (p) => p.headerSignature !== null && signatureOf(bytes, p) === p.headerSignature,
  );
  const sorted = [...matching].sort(
    (a, b) =>
      Number(b.defaultAccountId === accountId) - Number(a.defaultAccountId === accountId) ||
      b.updatedAtMs - a.updatedAtMs,
  );
  return sorted[0] ?? null;
}
