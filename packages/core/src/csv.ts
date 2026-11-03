// Export CSV (feature 17). Puro: produce il testo; il download sta nel browser. Formato per l'Excel
// italiano: separatore `;`, BOM UTF-8, virgola decimale, date gg/mm/aaaa, righe CRLF.
import type { IsoDate } from "./ids";
import { signedCents, type RegisterTx, type SummaryRow } from "./register";

export const CSV_BOM = "﻿";

/** "2026-11-05" -> "05/11/2026". */
export function csvDate(date: IsoDate): string {
  const [y = "", m = "", d = ""] = date.split("-");
  return `${d}/${m}/${y}`;
}

/** Centesimi -> "-12,30" (virgola decimale, nessun separatore delle migliaia, niente decimali float). */
export function csvAmount(valueCents: number): string {
  const abs = Math.abs(valueCents);
  const text = `${Math.floor(abs / 100)},${String(abs % 100).padStart(2, "0")}`;
  return valueCents < 0 ? `-${text}` : text;
}

/** Un testo che inizia con = + - @ (o tab/CR) verrebbe eseguito come formula: lo si prefissa con `'`. */
export function neutralizeFormula(text: string): string {
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
}

/** Cella di testo: neutralizza le formule e mette tra virgolette se serve. */
export function csvText(text: string): string {
  return quote(neutralizeFormula(text));
}

function quote(cell: string): string {
  return /[";\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;
}

/** Righe di celle già pronte (testi con `csvText`, numeri con `csvAmount`) -> file con BOM. */
export function toCsv(rows: readonly (readonly string[])[]): string {
  return CSV_BOM + rows.map((row) => row.join(";")).join("\r\n") + "\r\n";
}

export interface CsvHeaders {
  readonly movements: readonly [
    date: string,
    type: string,
    description: string,
    category: string,
    payee: string,
    account: string,
    toAccount: string,
    payer: string,
    amount: string,
    refund: string,
    notes: string,
  ];
  readonly summary: readonly [item: string, count: string, income: string, expense: string, net: string];
}

export interface CsvNames {
  readonly type: (type: RegisterTx["type"]) => string;
  readonly account: (id: string | null) => string;
  readonly category: (id: string | null) => string;
  readonly payee: (id: string | null) => string;
  readonly member: (id: string | null) => string;
  readonly yes: string;
}

/** I movimenti (già filtrati) come CSV. Importo con segno: entrate +, spese −; i giroconti restano positivi. */
export function movementsCsv(
  txs: readonly RegisterTx[],
  headers: CsvHeaders["movements"],
  names: CsvNames,
): string {
  const body = txs.map((tx) => [
    csvDate(tx.date),
    csvText(names.type(tx.type)),
    csvText(tx.description),
    csvText(names.category(tx.categoryId)),
    csvText(names.payee(tx.payeeId)),
    csvText(names.account(tx.accountId)),
    csvText(names.account(tx.toAccountId)),
    csvText(names.member(tx.payerMemberId)),
    csvAmount(tx.type === "transfer" ? tx.amountCents : signedCents(tx)),
    tx.isRefund ? csvText(names.yes) : "",
    csvText(tx.notes ?? ""),
  ]);
  return toCsv([headers.map(csvText), ...body]);
}

/** Una tabella riassuntiva con la riga dei totali in fondo. */
export function summaryCsv(
  rows: readonly SummaryRow[],
  total: Omit<SummaryRow, "key">,
  headers: CsvHeaders["summary"],
  labelOf: (key: string | null) => string,
  totalLabel: string,
): string {
  const line = (label: string, r: Omit<SummaryRow, "key">) => [
    csvText(label),
    String(r.count),
    csvAmount(r.incomeCents),
    csvAmount(r.expenseCents),
    csvAmount(r.netCents),
  ];
  return toCsv([headers.map(csvText), ...rows.map((r) => line(labelOf(r.key), r)), line(totalLabel, total)]);
}
