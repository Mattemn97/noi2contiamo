// Dalle celle alle righe di movimento (spec 0006, AC-5, AC-6, AC-9): data, importo con segno, testo.
import type { IsoDate } from "../ids";
import { err, ok, type Result } from "../result";
import { normalize } from "../normalize";
import { parseCsvRecords } from "./csv";
import { parseDate } from "./dates";
import { parseAmount } from "./numbers";
import { columnIndex, headersOf, type ColRef, type ImportSettings } from "./profile";

export interface ValidRow {
  readonly line: number;
  readonly ok: true;
  readonly date: IsoDate;
  /** Negativo = spesa. Mai zero. */
  readonly signedCents: number;
  readonly description: string;
  readonly payee: string | null;
}

export type RowErrorCode = "date" | "amount" | "decimals" | "zero" | "both" | "none" | "type";

export interface InvalidRow {
  readonly line: number;
  readonly ok: false;
  readonly error: RowErrorCode;
  /** Il testo che non si è riuscito a leggere. */
  readonly value: string;
}

export type ParsedRow = ValidRow | InvalidRow;

export interface ReadResult {
  readonly headers: string[];
  readonly rows: ParsedRow[];
}

/** Il campo della mappatura che punta a una colonna inesistente. */
export type ReadError = { readonly code: "missing_column"; readonly field: string };

const MAX_DESCRIPTION = 500;
const MAX_PAYEE = 100;

/** Legge il testo decodificato con le impostazioni scelte. */
export function readRows(text: string, settings: ImportSettings): Result<ReadResult, ReadError> {
  const records = parseCsvRecords(text, settings);
  const cells = records.map((r) => r.cells);
  const headers = headersOf(cells, settings);
  const resolve = (field: string, ref: ColRef | undefined): Result<number, ReadError> => {
    if (ref === undefined) return ok(-1);
    const i = columnIndex(ref, headers);
    return i < 0 ? err({ code: "missing_column", field }) : ok(i);
  };
  const { columns, sign } = settings;
  const fields = {
    date: resolve("date", columns.date),
    amount: resolve("amount", sign.mode === "debitCreditColumns" ? undefined : columns.amount),
    debit: resolve("debit", sign.mode === "debitCreditColumns" ? columns.debit : undefined),
    credit: resolve("credit", sign.mode === "debitCreditColumns" ? columns.credit : undefined),
    payee: resolve("payee", columns.payee),
    type: resolve("type", sign.mode === "typeColumn" ? columns.type : undefined),
  };
  for (const [field, r] of Object.entries(fields)) if (!r.ok) return err({ code: "missing_column", field });
  const at = (key: keyof typeof fields) => (fields[key].ok ? fields[key].value : -1);
  if (sign.mode === "debitCreditColumns" ? at("debit") < 0 || at("credit") < 0 : at("amount") < 0)
    return err({ code: "missing_column", field: sign.mode === "debitCreditColumns" ? "debit" : "amount" });
  if (sign.mode === "typeColumn" && at("type") < 0) return err({ code: "missing_column", field: "type" });
  const descriptions: number[] = [];
  for (const ref of columns.description) {
    const i = resolve("description", ref);
    if (!i.ok) return i;
    descriptions.push(i.value);
  }
  const expense = new Set((sign.expenseValues ?? []).map(normalize));
  const income = new Set((sign.incomeValues ?? []).map(normalize));
  const fmt = settings;

  const data = records.slice(settings.skipRows + (settings.hasHeader ? 1 : 0));
  const rows = data.map((record): ParsedRow => {
    const cell = (i: number) => (i >= 0 ? (record.cells[i] ?? "").trim() : "");
    const fail = (error: RowErrorCode, value: string): InvalidRow => ({
      line: record.line,
      ok: false,
      error,
      value,
    });
    const rawDate = cell(at("date"));
    const date = parseDate(rawDate, settings.dateFormat);
    if (!date.ok) return fail("date", rawDate);

    let signed: number;
    if (sign.mode === "debitCreditColumns") {
      const rawDebit = cell(at("debit"));
      const rawCredit = cell(at("credit"));
      const debit = parseAmount(rawDebit, fmt);
      const credit = parseAmount(rawCredit, fmt);
      const debitZero = !debit.ok || debit.value === 0;
      const creditZero = !credit.ok || credit.value === 0;
      if (!debit.ok && debit.error !== "empty")
        return fail(debit.error === "decimals" ? "decimals" : "amount", rawDebit);
      if (!credit.ok && credit.error !== "empty")
        return fail(credit.error === "decimals" ? "decimals" : "amount", rawCredit);
      if (!debitZero && !creditZero) return fail("both", `${rawDebit} / ${rawCredit}`);
      if (debitZero && creditZero) return fail("none", "");
      signed =
        debit.ok && debit.value !== 0 ? -Math.abs(debit.value) : Math.abs(credit.ok ? credit.value : 0);
    } else {
      const raw = cell(at("amount"));
      const amount = parseAmount(raw, fmt);
      if (!amount.ok) return fail(amount.error === "decimals" ? "decimals" : "amount", raw);
      if (sign.mode === "negativeIsExpense") signed = amount.value;
      else if (sign.mode === "positiveIsExpense") signed = -amount.value;
      else {
        const rawType = cell(at("type"));
        const kind = normalize(rawType);
        if (expense.has(kind)) signed = -Math.abs(amount.value);
        else if (income.has(kind)) signed = Math.abs(amount.value);
        else return fail("type", rawType);
      }
    }
    if (signed === 0) return fail("zero", cell(at("amount")));
    const description = descriptions
      .map(cell)
      .filter((s) => s !== "")
      .filter((s, i, all) => all.indexOf(s) === i)
      .join(" · ")
      .replace(/\s+/g, " ")
      .slice(0, MAX_DESCRIPTION);
    const payee = cell(at("payee")).replace(/\s+/g, " ").slice(0, MAX_PAYEE);
    return {
      line: record.line,
      ok: true,
      date: date.value,
      signedCents: signed,
      description,
      payee: payee || null,
    };
  });
  return ok({ headers, rows });
}
