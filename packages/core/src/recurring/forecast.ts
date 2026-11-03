// Saldo di oggi per conto e previsione mese per mese (spec 0008, AC-9, AC-10).
import type { Id, IsoDate } from "../ids";
import type { Account, Transaction } from "../model/schemas";
import { signedCents } from "../register";
import {
  closedTransactionIds,
  expectedAmountFor,
  occurrenceStatuses,
  type MatchTx,
  type RecurrenceLike,
} from "./match";
import { dateParts, endOfMonth, isoOf, monthKey, shiftDays, shiftMonth } from "./schedule";

export type BalanceAccount = Pick<
  Account,
  "id" | "initialBalanceCents" | "initialBalanceDate" | "visibility"
>;
export type ForecastTx = MatchTx;

/** Saldo per conto alla fine di `today`: iniziale più i movimenti da `initialBalanceDate` a oggi. */
export function accountBalances(
  accounts: readonly BalanceAccount[],
  txs: readonly Pick<
    Transaction,
    "type" | "date" | "amountCents" | "isRefund" | "accountId" | "toAccountId"
  >[],
  today: IsoDate,
): Record<Id, number> {
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const balances: Record<Id, number> = Object.fromEntries(accounts.map((a) => [a.id, a.initialBalanceCents]));
  const add = (id: Id | null, delta: number, date: IsoDate) => {
    const account = id === null ? undefined : byId.get(id);
    if (!account || id === null || date < account.initialBalanceDate || date > today) return;
    balances[id] = (balances[id] ?? 0) + delta;
  };
  for (const tx of txs) {
    if (tx.type === "transfer") {
      add(tx.accountId, -tx.amountCents, tx.date);
      add(tx.toAccountId, tx.amountCents, tx.date);
    } else add(tx.accountId, signedCents(tx), tx.date);
  }
  return balances;
}

export interface ForecastCell {
  readonly balanceCents: number;
  readonly recurringInCents: number;
  readonly recurringOutCents: number;
  readonly variableInCents: number;
  readonly variableOutCents: number;
}

export interface ForecastMonth {
  /** `YYYY-MM`. */
  readonly month: string;
  readonly endDate: IsoDate;
  readonly byAccount: Readonly<Record<Id, ForecastCell>>;
  /** Somma dei conti condivisi; i giroconti tra due conti condivisi non contano come entrate o uscite. */
  readonly family: ForecastCell;
}

export interface ForecastInput {
  readonly accounts: readonly BalanceAccount[];
  readonly txs: readonly ForecastTx[];
  readonly recurrences: readonly RecurrenceLike[];
  readonly today: IsoDate;
  /** 1..12. */
  readonly months: number;
}

export const VARIABLE_MONTHS = 3;

interface Flow {
  readonly in: number;
  readonly out: number;
}

/** Media mensile delle entrate e uscite non ricorrenti per conto, sugli ultimi 3 mesi interi. */
export function variableAverages(
  accounts: readonly BalanceAccount[],
  txs: readonly ForecastTx[],
  closed: ReadonlySet<Id>,
  today: IsoDate,
): Record<Id, Flow> {
  const [fy, fm] = shiftMonth(today, -VARIABLE_MONTHS);
  const from = isoOf(fy, fm, 1);
  const [ly, lm] = shiftMonth(today, -1);
  const to = endOfMonth(ly, lm);
  const sums = variableFlows(accounts, txs, closed, from, to);
  return Object.fromEntries(
    Object.entries(sums).map(([id, f]) => [
      id,
      { in: Math.round(f.in / VARIABLE_MONTHS), out: Math.round(f.out / VARIABLE_MONTHS) },
    ]),
  );
}

function variableFlows(
  accounts: readonly BalanceAccount[],
  txs: readonly ForecastTx[],
  closed: ReadonlySet<Id>,
  from: IsoDate,
  to: IsoDate,
): Record<Id, Flow> {
  const sums: Record<Id, { in: number; out: number }> = Object.fromEntries(
    accounts.map((a) => [a.id, { in: 0, out: 0 }]),
  );
  for (const tx of txs) {
    const sum = sums[tx.accountId];
    if (!sum || tx.type === "transfer" || closed.has(tx.id) || tx.date < from || tx.date > to) continue;
    const signed = signedCents(tx);
    if (tx.type === "income") sum.in += signed;
    else sum.out -= signed;
  }
  return Object.fromEntries(
    Object.entries(sums).map(([id, f]) => [id, { in: Math.max(0, f.in), out: Math.max(0, f.out) }]),
  );
}

interface Event {
  readonly month: string;
  readonly accountId: Id;
  readonly delta: number;
  readonly kind: "recurring" | "variable";
  /** Gamba di un giroconto tra due conti condivisi: cambia i saldi, non le entrate e uscite di famiglia. */
  readonly internal: boolean;
}

const emptyCell = (balance: number): ForecastCell => ({
  balanceCents: balance,
  recurringInCents: 0,
  recurringOutCents: 0,
  variableInCents: 0,
  variableOutCents: 0,
});

function addEvent(cell: ForecastCell, e: Event, countFlow: boolean): ForecastCell {
  const flow = countFlow
    ? e.kind === "recurring"
      ? e.delta >= 0
        ? { recurringInCents: cell.recurringInCents + e.delta }
        : { recurringOutCents: cell.recurringOutCents - e.delta }
      : e.delta >= 0
        ? { variableInCents: cell.variableInCents + e.delta }
        : { variableOutCents: cell.variableOutCents - e.delta }
    : {};
  return { ...cell, ...flow, balanceCents: cell.balanceCents + e.delta };
}

/** Previsione per conto e per famiglia, dalla fine del mese corrente a `months` mesi dopo (AC-10). */
export function forecast(input: ForecastInput): ForecastMonth[] {
  const months = Math.min(12, Math.max(1, Math.trunc(input.months)));
  const { accounts, txs, today } = input;
  const active = input.recurrences.filter((r) => r.archivedAtMs === null);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const shared = (id: Id | null) => id !== null && byId.get(id)?.visibility === "shared";
  const [ey, em] = shiftMonth(today, months);
  const horizon = endOfMonth(ey, em);
  const [ty, tm] = dateParts(today);
  const closed = closedTransactionIds(
    active,
    txs,
    isoOf(...shiftMonth(today, -VARIABLE_MONTHS - 1), 1),
    horizon,
  );
  const events: Event[] = [];

  for (const rec of active) {
    const amount = expectedAmountFor(rec, txs, today);
    const due = occurrenceStatuses(rec, txs, shiftDays(today, -rec.matchWindowDays), horizon, today);
    for (const o of due) {
      if (o.status !== "upcoming") continue;
      const month = o.date < today ? monthKey(today) : monthKey(o.date);
      const internal = rec.type === "transfer" && shared(rec.accountId) && shared(rec.toAccountId);
      const legs: [Id | null, number][] =
        rec.type === "transfer"
          ? [
              [rec.accountId, -amount],
              [rec.toAccountId, amount],
            ]
          : [[rec.accountId, rec.type === "income" ? amount : -amount]];
      for (const [accountId, delta] of legs)
        if (accountId !== null && byId.has(accountId))
          events.push({ month, accountId, delta, kind: "recurring", internal });
    }
  }

  const averages = variableAverages(accounts, txs, closed, today);
  const done = variableFlows(accounts, txs, closed, isoOf(ty, tm, 1), today);
  for (let i = 0; i <= months; i += 1) {
    const [y, m] = shiftMonth(today, i);
    const month = isoOf(y, m, 1).slice(0, 7);
    for (const a of accounts) {
      const avg = averages[a.id] ?? { in: 0, out: 0 };
      const already = done[a.id] ?? { in: 0, out: 0 };
      const inc = i === 0 ? Math.max(0, avg.in - already.in) : avg.in;
      const out = i === 0 ? Math.max(0, avg.out - already.out) : avg.out;
      if (inc > 0) events.push({ month, accountId: a.id, delta: inc, kind: "variable", internal: false });
      if (out > 0) events.push({ month, accountId: a.id, delta: -out, kind: "variable", internal: false });
    }
  }

  const start = accountBalances(accounts, txs, today);
  let balances: Record<Id, number> = start;
  const result: ForecastMonth[] = [];
  for (let i = 0; i <= months; i += 1) {
    const [y, m] = shiftMonth(today, i);
    const month = isoOf(y, m, 1).slice(0, 7);
    const cells: Record<Id, ForecastCell> = Object.fromEntries(
      accounts.map((a) => [a.id, emptyCell(balances[a.id] ?? 0)]),
    );
    let family = emptyCell(
      accounts.filter((a) => a.visibility === "shared").reduce((s, a) => s + (balances[a.id] ?? 0), 0),
    );
    for (const e of events) {
      if (e.month !== month) continue;
      const cell = cells[e.accountId];
      if (cell) cells[e.accountId] = addEvent(cell, e, true);
      if (shared(e.accountId)) family = addEvent(family, e, !e.internal);
    }
    balances = Object.fromEntries(Object.entries(cells).map(([id, c]) => [id, c.balanceCents]));
    result.push({ month, endDate: endOfMonth(y, m), byAccount: cells, family });
  }
  return result;
}
