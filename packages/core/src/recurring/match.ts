// Abbinamento tra scadenze e movimenti reali, stato delle scadenze e pagamento (spec 0008, AC-3..AC-6).
// L'abbinamento automatico è solo calcolato: si scrive (`recurrenceId`, `recurrenceDueDate`) solo su conferma.
import { autoSplit, type AutoSplitContext } from "../division";
import type { Id, IsoDate } from "../ids";
import { accountDefaults } from "../model/invariants";
import type { WriteDocOf } from "../model/registry";
import { transactionShapeIssues, type Account, type Recurrence, type Transaction } from "../model/schemas";
import { err, ok, type Result } from "../result";
import { descriptionMatches } from "../rules/match";
import { daysBetween, occurrences, shiftDays } from "./schedule";

export type RecurrenceLike = Pick<
  Recurrence,
  | "id"
  | "name"
  | "type"
  | "accountId"
  | "toAccountId"
  | "categoryId"
  | "payeeId"
  | "expectedAmountCents"
  | "amountToleranceBp"
  | "split"
  | "frequency"
  | "startDate"
  | "endDate"
  | "matchWindowDays"
  | "descriptionMatch"
  | "skippedDates"
  | "archivedAtMs"
>;

export type MatchTx = Pick<
  Transaction,
  | "id"
  | "type"
  | "date"
  | "amountCents"
  | "isRefund"
  | "accountId"
  | "toAccountId"
  | "categoryId"
  | "payeeId"
  | "description"
  | "recurrenceId"
  | "recurrenceDueDate"
>;

export type OccurrenceStatus = "paid" | "skipped" | "missed" | "upcoming";

export interface Occurrence {
  readonly recurrenceId: Id;
  readonly date: IsoDate;
  readonly status: OccurrenceStatus;
  /** Come è stata chiusa: collegata (salvata) o abbinata in automatico (calcolata). */
  readonly match: "linked" | "auto" | null;
  readonly transactionId: Id | null;
  /** Importo del movimento se pagata, altrimenti quello atteso. */
  readonly amountCents: number;
}

/** Vero se l'importo sta nella tolleranza: `|importo − atteso| × 10000 ≤ atteso × tolleranza`. */
export function amountFits(
  rec: Pick<Recurrence, "expectedAmountCents" | "amountToleranceBp">,
  amount: number,
) {
  return (
    Math.abs(amount - rec.expectedAmountCents) * 10_000 <= rec.expectedAmountCents * rec.amountToleranceBp
  );
}

/** Destinatario, descrizione, poi categoria: l'identità di un pagamento (AC-3). */
export function identityFits(rec: RecurrenceLike, tx: MatchTx): boolean {
  if (rec.payeeId === null && rec.descriptionMatch === null)
    return rec.categoryId === null || tx.categoryId === rec.categoryId;
  if (rec.payeeId !== null && tx.payeeId !== rec.payeeId) return false;
  return rec.descriptionMatch === null || descriptionMatches(tx.description, rec.descriptionMatch);
}

/** Un movimento senza collegamento che potrebbe pagare la scadenza `due`. */
export function candidateFits(rec: RecurrenceLike, tx: MatchTx, due: IsoDate): boolean {
  return (
    tx.recurrenceId === null &&
    !tx.isRefund &&
    tx.type === rec.type &&
    tx.accountId === rec.accountId &&
    (rec.type !== "transfer" || tx.toAccountId === rec.toAccountId) &&
    Math.abs(daysBetween(due, tx.date)) <= rec.matchWindowDays &&
    amountFits(rec, tx.amountCents) &&
    identityFits(rec, tx)
  );
}

export interface OccurrenceMatch {
  readonly date: IsoDate;
  readonly match: "linked" | "auto" | null;
  readonly tx: MatchTx | null;
}

/**
 * Per ogni scadenza (in ordine di data) il movimento che la chiude: prima quello collegato, poi il
 * candidato libero più vicino per data, poi per importo, poi per `id`. Ogni movimento chiude al massimo una scadenza.
 */
export function matchOccurrences(
  rec: RecurrenceLike,
  dates: readonly IsoDate[],
  txs: readonly MatchTx[],
): OccurrenceMatch[] {
  const linked = new Map<IsoDate, MatchTx>();
  for (const tx of [...txs].sort((a, b) => a.id.localeCompare(b.id)))
    if (tx.recurrenceId === rec.id && tx.recurrenceDueDate !== null && !linked.has(tx.recurrenceDueDate))
      linked.set(tx.recurrenceDueDate, tx);
  const used = new Set<Id>();
  return [...dates].sort().map((date) => {
    const own = linked.get(date);
    if (own) return { date, match: "linked", tx: own };
    const best = txs
      .filter((tx) => !used.has(tx.id) && candidateFits(rec, tx, date))
      .sort(
        (a, b) =>
          Math.abs(daysBetween(date, a.date)) - Math.abs(daysBetween(date, b.date)) ||
          Math.abs(a.amountCents - rec.expectedAmountCents) -
            Math.abs(b.amountCents - rec.expectedAmountCents) ||
          a.id.localeCompare(b.id),
      )[0];
    if (!best) return { date, match: null, tx: null };
    used.add(best.id);
    return { date, match: "auto", tx: best };
  });
}

/** Scadenze tra `from` e `to` con il loro stato rispetto a `today` (AC-4). */
export function occurrenceStatuses(
  rec: RecurrenceLike,
  txs: readonly MatchTx[],
  from: IsoDate,
  to: IsoDate,
  today: IsoDate,
): Occurrence[] {
  const skipped = new Set(rec.skippedDates);
  return matchOccurrences(rec, occurrences(rec, from, to), txs).map(({ date, match, tx }) => {
    const status: OccurrenceStatus = tx
      ? "paid"
      : skipped.has(date)
        ? "skipped"
        : today > shiftDays(date, rec.matchWindowDays)
          ? "missed"
          : "upcoming";
    return {
      recurrenceId: rec.id,
      date,
      status,
      match: tx ? match : null,
      transactionId: tx?.id ?? null,
      amountCents: tx?.amountCents ?? rec.expectedAmountCents,
    };
  });
}

/** La prossima scadenza ancora da pagare (da `today` meno la finestra), o `null` se la serie è finita. */
export function nextDue(rec: RecurrenceLike, txs: readonly MatchTx[], today: IsoDate): Occurrence | null {
  const from = shiftDays(today, -rec.matchWindowDays);
  return (
    occurrenceStatuses(rec, txs, from, shiftDays(today, 3660), today).find((o) => o.status === "upcoming") ??
    null
  );
}

/** Movimenti chiusi (collegati o abbinati) da una delle ricorrenze attive tra `from` e `to`. */
export function closedTransactionIds(
  recs: readonly RecurrenceLike[],
  txs: readonly MatchTx[],
  from: IsoDate,
  to: IsoDate,
): Set<Id> {
  const ids = new Set<Id>(txs.filter((tx) => tx.recurrenceId !== null).map((tx) => tx.id));
  for (const rec of recs) {
    if (rec.archivedAtMs !== null) continue;
    for (const m of matchOccurrences(rec, occurrences(rec, from, to), txs)) if (m.tx) ids.add(m.tx.id);
  }
  return ids;
}

/** Importo atteso per la previsione (AC-6): fisso, oppure la media degli ultimi 3 pagamenti. */
export function expectedAmountFor(rec: RecurrenceLike, txs: readonly MatchTx[], today: IsoDate): number {
  if (rec.amountToleranceBp === 0) return rec.expectedAmountCents;
  const paid = matchOccurrences(rec, occurrences(rec, rec.startDate, today), txs)
    .flatMap((m) => (m.tx ? [m.tx.amountCents] : []))
    .slice(-3);
  if (paid.length === 0) return rec.expectedAmountCents;
  return Math.round(paid.reduce((a, b) => a + b, 0) / paid.length);
}

/** Collega un movimento alla scadenza (Collega, Conferma, AC-5). */
export function linkTransaction<T extends Pick<Transaction, "recurrenceId" | "recurrenceDueDate">>(
  tx: T,
  recurrenceId: Id,
  date: IsoDate,
): T {
  return { ...tx, recurrenceId, recurrenceDueDate: date };
}

export function unlinkTransaction<T extends Pick<Transaction, "recurrenceId" | "recurrenceDueDate">>(
  tx: T,
): T {
  return { ...tx, recurrenceId: null, recurrenceDueDate: null };
}

/** Movimenti che "Collega" può proporre per una scadenza: stesso conto e tipo, entro 31 giorni, liberi. */
export function linkCandidates<T extends MatchTx>(
  rec: RecurrenceLike,
  date: IsoDate,
  txs: readonly T[],
): T[] {
  return txs
    .filter(
      (tx) =>
        tx.recurrenceId === null &&
        tx.type === rec.type &&
        tx.accountId === rec.accountId &&
        Math.abs(daysBetween(date, tx.date)) <= 31,
    )
    .sort((a, b) => Math.abs(daysBetween(date, a.date)) - Math.abs(daysBetween(date, b.date)));
}

/** Gli abbinamenti automatici delle scadenze fino a `today`, da salvare come collegamenti (Accetta, AC-8). */
export function autoLinks<T extends MatchTx>(rec: RecurrenceLike, txs: readonly T[], today: IsoDate): T[] {
  const byId = new Map(txs.map((tx) => [tx.id, tx]));
  return matchOccurrences(rec, occurrences(rec, rec.startDate, today), txs).flatMap((m) => {
    const tx = m.match === "auto" && m.tx ? byId.get(m.tx.id) : undefined;
    return tx ? [linkTransaction(tx, rec.id, m.date)] : [];
  });
}

export type PaymentError = "account" | "toAccount" | "shape";

/** "Registra pagamento" (AC-5): il movimento della scadenza, già collegato. */
export function paymentFromOccurrence(
  rec: RecurrenceLike,
  date: IsoDate,
  id: Id,
  ctx: Omit<AutoSplitContext, "accounts"> & { readonly accounts: readonly Account[] },
): Result<WriteDocOf<"transactions">, PaymentError> {
  const account = ctx.accounts.find((a) => a.id === rec.accountId);
  if (!account) return err("account");
  const toAccount =
    rec.toAccountId === null ? null : (ctx.accounts.find((a) => a.id === rec.toAccountId) ?? null);
  if (rec.type === "transfer" && !toAccount) return err("toAccount");
  const transfer = rec.type === "transfer";
  const defaults = accountDefaults(account, transfer ? toAccount : null);
  const base = {
    id,
    type: rec.type,
    date,
    amountCents: rec.expectedAmountCents,
    isRefund: false,
    accountId: rec.accountId,
    toAccountId: transfer ? rec.toAccountId : null,
    categoryId: transfer ? null : rec.categoryId,
    payeeId: rec.payeeId,
    description: rec.name,
    notes: null,
    ...defaults,
    settlement: null,
    provenance: { category: "default", payee: "default", split: "default" },
    ruleIds: [],
    importBatchId: null,
    importFingerprints: [],
    recurrenceId: rec.id,
    recurrenceDueDate: date,
  } satisfies Omit<WriteDocOf<"transactions">, "split">;
  const ownSplit =
    rec.split &&
    defaults.visibility === "shared" &&
    (rec.split.kind === "bp" ||
      Object.values(rec.split.shares).reduce((a, b) => a + b, 0) === rec.expectedAmountCents)
      ? rec.split
      : null;
  const split = transfer ? null : (ownSplit ?? autoSplit(base, ctx));
  const tx = { ...base, split };
  return transactionShapeIssues(tx).length === 0 ? ok(tx) : err("shape");
}
