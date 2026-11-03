// Riconoscere un giroconto da due movimenti separati (feature 10, spec 0005, AC-9): una spesa su un conto
// e un'entrata dello stesso importo su un altro conto della famiglia, a pochi giorni di distanza.
// Serve soprattutto all'import (feature 11), quando le due banche danno due righe distinte.
import { accountDefaults } from "./model/invariants";
import type { WriteDocOf } from "./model/registry";
import type { Account, Transaction } from "./model/schemas";

export type PairCandidate = Pick<
  Transaction,
  | "id"
  | "type"
  | "date"
  | "amountCents"
  | "isRefund"
  | "accountId"
  | "visibility"
  | "description"
  | "importBatchId"
  | "importFingerprints"
>;

export interface TransferPair<T extends PairCandidate = PairCandidate> {
  /** La spesa: il conto da cui escono i soldi. */
  readonly out: T;
  /** L'entrata: il conto in cui arrivano. */
  readonly in: T;
  /** Giorni tra le due date (0 = stesso giorno). */
  readonly days: number;
}

export const TRANSFER_MATCH_DAYS = 3;

const dayNumber = (date: string) => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/**
 * Le coppie spesa ↔ entrata che sembrano un giroconto: stesso importo, conti diversi della famiglia,
 * date entro `maxDays`; né rimborsi né privati. Ogni movimento sta in una sola coppia: prima le date
 * più vicine, poi la spesa più vecchia, poi gli id (risultato stabile).
 */
export function findTransferPairs<T extends PairCandidate>(
  txs: readonly T[],
  ctx: { readonly accounts: readonly Pick<Account, "id">[]; readonly maxDays?: number },
): TransferPair<T>[] {
  const maxDays = ctx.maxDays ?? TRANSFER_MATCH_DAYS;
  const known = new Set(ctx.accounts.map((a) => a.id));
  const usable = (tx: T) => !tx.isRefund && tx.visibility === "shared" && known.has(tx.accountId);
  const outs = txs.filter((tx) => tx.type === "expense" && usable(tx));
  const ins = txs.filter((tx) => tx.type === "income" && usable(tx));
  const candidates = outs.flatMap((out) =>
    ins
      .filter((inc) => inc.amountCents === out.amountCents && inc.accountId !== out.accountId)
      .map((inc) => ({ out, in: inc, days: Math.abs(dayNumber(inc.date) - dayNumber(out.date)) }))
      .filter((pair) => pair.days <= maxDays),
  );
  const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
  candidates.sort(
    (a, b) =>
      a.days - b.days || cmp(a.out.date, b.out.date) || cmp(a.out.id, b.out.id) || cmp(a.in.id, b.in.id),
  );
  const taken = new Set<string>();
  return candidates.filter((pair) => {
    if (taken.has(pair.out.id) || taken.has(pair.in.id)) return false;
    taken.add(pair.out.id);
    taken.add(pair.in.id);
    return true;
  });
}

/**
 * Il giroconto che sostituisce una coppia: dal conto della spesa a quello dell'entrata, con data e
 * descrizione della spesa e le impronte di import di tutte e due (al massimo 2).
 */
export function mergeTransferPair(
  pair: TransferPair,
  id: string,
  accounts: readonly Account[],
): WriteDocOf<"transactions"> | null {
  const from = accounts.find((a) => a.id === pair.out.accountId);
  const to = accounts.find((a) => a.id === pair.in.accountId);
  if (!from || !to || from.id === to.id) return null;
  const fingerprints = [...new Set([...pair.out.importFingerprints, ...pair.in.importFingerprints])].slice(
    0,
    2,
  );
  return {
    id,
    type: "transfer",
    date: pair.out.date,
    amountCents: pair.out.amountCents,
    accountId: from.id,
    toAccountId: to.id,
    categoryId: null,
    payeeId: null,
    description: pair.out.description || pair.in.description,
    split: null,
    importBatchId: pair.out.importBatchId ?? pair.in.importBatchId,
    importFingerprints: fingerprints,
    ...accountDefaults(from, to),
  };
}
