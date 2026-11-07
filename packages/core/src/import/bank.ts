// Movimenti letti dalla banca (open banking, feature 24): dalle transazioni di Enable Banking alle
// stesse righe del CSV, così anteprima, doppioni e giroconti sono quelli dell'import da file.
// Gli importi arrivano come stringhe decimali ("12.50"): si convertono in centesimi senza decimali.
import { utf8ToBytes } from "@noble/hashes/utils.js";
import { z } from "zod";
import { fileHash } from "./decode";
import { parseDate } from "./dates";
import { parseAmount } from "./numbers";
import type { InvalidRow, ParsedRow, ValidRow } from "./rows";

const text = z.string().nullish();
const party = z.object({ name: text }).loose().nullish();

/** Una transazione come la restituisce l'API (campi non elencati ignorati; quasi tutto facoltativo). */
export const BankTransaction = z
  .object({
    entry_reference: text,
    transaction_amount: z.object({ currency: text, amount: z.string() }),
    credit_debit_indicator: z.enum(["CRDT", "DBIT"]),
    status: text,
    booking_date: text,
    value_date: text,
    transaction_date: text,
    remittance_information: z.array(z.string()).nullish(),
    creditor: party,
    debtor: party,
  })
  .loose();
export type BankTransaction = z.infer<typeof BankTransaction>;

export interface BankRowsOptions {
  /** Includere anche i movimenti non ancora contabilizzati (default: no). */
  readonly includePending?: boolean;
}

const MAX_DESCRIPTION = 500;
const MAX_PAYEE = 100;
const clean = (value: string | null | undefined, max: number) =>
  (value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/**
 * Righe compatibili con `planImport`. Solo i movimenti contabilizzati ("BOOK" o senza stato).
 * Le impronte le calcola `planImport` da conto, data, importo e descrizione normalizzata, come per il
 * CSV: lo stesso movimento si riconosce solo se la descrizione coincide con quella dell'estratto
 * (la banca spesso la scrive diversa), altrimenti il giroconto o il confronto manuale restano utili.
 */
export function bankTransactionsToRows(
  txs: readonly BankTransaction[],
  options: BankRowsOptions = {},
): ParsedRow[] {
  const kept = txs.filter(
    (tx) => options.includePending || tx.status === undefined || tx.status === null || tx.status === "BOOK",
  );
  return kept.map((tx, i): ParsedRow => {
    const line = i + 1;
    const fail = (error: InvalidRow["error"], value: string): InvalidRow => ({
      line,
      ok: false,
      error,
      value,
    });
    const rawDate = tx.booking_date || tx.value_date || tx.transaction_date || "";
    const date = parseDate(rawDate, "yyyy-MM-dd");
    if (!date.ok) return fail("date", rawDate);
    const raw = tx.transaction_amount.amount;
    const amount = parseAmount(raw, { decimalSeparator: ".", thousandsSeparator: "" });
    if (!amount.ok) return fail(amount.error === "decimals" ? "decimals" : "amount", raw);
    const magnitude = Math.abs(amount.value);
    if (magnitude === 0) return fail("zero", raw);
    const debit = tx.credit_debit_indicator === "DBIT";
    const payee = clean(debit ? tx.creditor?.name : tx.debtor?.name, MAX_PAYEE);
    const remittance = (tx.remittance_information ?? [])
      .map((s) => clean(s, MAX_DESCRIPTION))
      .filter((s, k, all) => s !== "" && all.indexOf(s) === k);
    const description = (remittance.length > 0 ? remittance.join(" · ") : payee).slice(0, MAX_DESCRIPTION);
    const row: ValidRow = {
      line,
      ok: true,
      date: date.value,
      signedCents: debit ? -magnitude : magnitude,
      description,
      payee: payee || null,
    };
    return row;
  });
}

export interface BankBatchKey {
  readonly connectionId: string;
  readonly accountUid: string;
  readonly dateFrom: string;
  readonly dateTo: string;
}

/** Stringa deterministica per `importBatches.fileHash`: stessa banca, conto e periodo, stesso valore. */
export function bankBatchHash(key: BankBatchKey): string {
  return fileHash(utf8ToBytes([key.connectionId, key.accountUid, key.dateFrom, key.dateTo].join("|")));
}

const italianDate = (iso: string) => iso.split("-").reverse().join("/");

/** Nome del lotto: "Banca · Intesa · 1234 · 01/08/2026–30/10/2026". */
export function bankBatchName(input: {
  readonly bankName: string;
  readonly iban?: string | null | undefined;
  readonly dateFrom: string;
  readonly dateTo: string;
}): string {
  const last4 = input.iban ? input.iban.replace(/\s+/g, "").slice(-4) : "";
  return [
    "Banca",
    input.bankName,
    ...(last4 ? [last4] : []),
    `${italianDate(input.dateFrom)}–${italianDate(input.dateTo)}`,
  ].join(" · ");
}

const BANK_NAME_PREFIX = "Banca · ";
export const DEFAULT_BANK_DAYS = 90;

const shiftIso = (iso: string, days: number): string => {
  const [y = 1970, m = 1, d = 1] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/**
 * Periodo proposto per scaricare i movimenti di un conto dell'app: dall'ultimo giorno già importato dalla
 * banca (un giorno di sovrapposizione, i doppioni si saltano da soli), altrimenti gli ultimi 90 giorni.
 */
export function suggestBankRange(
  batches: readonly { readonly accountId: string; readonly fileName: string; readonly dateTo: string }[],
  accountId: string,
  today: string,
): { readonly dateFrom: string; readonly dateTo: string } {
  const last = batches
    .filter((b) => b.accountId === accountId && b.fileName.startsWith(BANK_NAME_PREFIX))
    .map((b) => b.dateTo)
    .sort()
    .at(-1);
  const from = last !== undefined && last <= today ? last : shiftIso(today, -DEFAULT_BANK_DAYS);
  return { dateFrom: from, dateTo: today };
}
