// Dashboard, vista personale e confronto tra periodi (feature 14-16). Tutto puro: si parte dai movimenti
// visibili e si ricavano indicatori, andamento, categorie, contributi e confronti. I giroconti non sono
// né entrate né spese. Gli importi sono centesimi interi, le percentuali punti base.
import type { IsoDate, MemberId } from "./ids";
import type { Account, Transaction } from "./model/schemas";
import { addDays, type DateRange } from "./register";
import { FULL_BP, memberAmounts } from "./split";

export type DashboardTx = Pick<
  Transaction,
  | "type"
  | "date"
  | "amountCents"
  | "isRefund"
  | "accountId"
  | "categoryId"
  | "payerMemberId"
  | "split"
  | "visibility"
  | "ownerMemberId"
>;

/** `family`: i movimenti condivisi per intero. `personal`: la quota di `memberId` e i suoi movimenti privati. */
export type DashboardView =
  { readonly kind: "family" } | { readonly kind: "personal"; readonly memberId: MemberId };

export interface DashboardContext {
  readonly view: DashboardView;
  readonly accounts: readonly Pick<Account, "id" | "ownerMemberId">[];
}

/** Una entrata o una spesa già ridotta alla parte che conta nella vista; i rimborsi hanno importo negativo. */
export interface Entry {
  readonly date: IsoDate;
  readonly kind: "income" | "expense";
  readonly categoryId: string | null;
  readonly payerMemberId: MemberId | null;
  readonly cents: number;
}

/**
 * I movimenti che contano nella vista. I movimenti privati compaiono solo nella vista personale del loro
 * proprietario: quelli di un altro membro non entrano mai.
 */
export function dashboardEntries(txs: readonly DashboardTx[], ctx: DashboardContext): Entry[] {
  const me = ctx.view.kind === "personal" ? ctx.view.memberId : null;
  const out: Entry[] = [];
  for (const tx of txs) {
    if (tx.type === "transfer") continue;
    if (tx.visibility === "private" && (me === null || tx.ownerMemberId !== me)) continue;
    let amount = tx.amountCents;
    if (me !== null) {
      if (tx.split) amount = memberAmounts(tx.amountCents, tx.split)[me] ?? 0;
      else {
        const owner = ctx.accounts.find((a) => a.id === tx.accountId)?.ownerMemberId ?? null;
        if (tx.ownerMemberId !== me && owner !== me) amount = 0;
      }
    }
    if (amount === 0) continue;
    out.push({
      date: tx.date,
      kind: tx.type,
      categoryId: tx.categoryId,
      payerMemberId: tx.payerMemberId,
      cents: tx.isRefund ? -amount : amount,
    });
  }
  return out;
}

export function entriesInRange(entries: readonly Entry[], range: DateRange): Entry[] {
  return entries.filter(
    (e) => (range.from === null || e.date >= range.from) && (range.to === null || e.date <= range.to),
  );
}

const sumOf = (entries: readonly Entry[], kind: Entry["kind"]) =>
  entries.reduce((total, e) => (e.kind === kind ? total + e.cents : total), 0);

// ---- Indicatori -----------------------------------------------------------------------------

export interface Kpis {
  readonly incomeCents: number;
  readonly expenseCents: number;
  readonly savingsCents: number;
  /** Risparmio sulle entrate in punti base; `null` se non ci sono entrate. */
  readonly savingsRateBp: number | null;
}

export function kpis(entries: readonly Entry[]): Kpis {
  const incomeCents = sumOf(entries, "income");
  const expenseCents = sumOf(entries, "expense");
  const savingsCents = incomeCents - expenseCents;
  return {
    incomeCents,
    expenseCents,
    savingsCents,
    savingsRateBp: incomeCents > 0 ? Math.round((savingsCents * FULL_BP) / incomeCents) : null,
  };
}

// ---- Andamento ------------------------------------------------------------------------------

export type TrendGranularity = "week" | "month";

export interface TrendPoint {
  /** Primo giorno del gruppo (lunedì o primo del mese). */
  readonly start: IsoDate;
  readonly incomeCents: number;
  readonly expenseCents: number;
}

const toUtc = (date: IsoDate): Date => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};
const fromUtc = (d: Date): IsoDate => d.toISOString().slice(0, 10);

/** Il lunedì della settimana che contiene la data. */
export function weekStart(date: IsoDate): IsoDate {
  const dow = (toUtc(date).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

const monthStart = (date: IsoDate): IsoDate => `${date.slice(0, 7)}-01`;

function nextStart(start: IsoDate, g: TrendGranularity): IsoDate {
  if (g === "week") return addDays(start, 7);
  const d = toUtc(start);
  return fromUtc(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
}

/** Un punto per ogni settimana o mese dell'intervallo, anche vuoto; senza limiti si usano le date dei movimenti. */
export function trend(
  entries: readonly Entry[],
  granularity: TrendGranularity,
  range: DateRange,
): TrendPoint[] {
  const dates = entries.map((e) => e.date).sort();
  const from = range.from ?? dates[0];
  const to = range.to ?? dates[dates.length - 1];
  if (from === undefined || to === undefined || from > to) return [];
  const startOf = granularity === "week" ? weekStart : monthStart;
  const points = new Map<IsoDate, { income: number; expense: number }>();
  for (let s = startOf(from); s <= to; s = nextStart(s, granularity))
    points.set(s, { income: 0, expense: 0 });
  for (const e of entriesInRange(entries, { from, to })) {
    const bucket = points.get(startOf(e.date));
    if (bucket) bucket[e.kind] += e.cents;
  }
  return [...points.entries()].map(([start, v]) => ({
    start,
    incomeCents: v.income,
    expenseCents: v.expense,
  }));
}

// ---- Categorie e contributi -----------------------------------------------------------------

export interface CategoryTotal {
  readonly categoryId: string | null;
  readonly cents: number;
}

/** Totale per categoria (`null` = senza categoria), dal più grande; la somma è il totale del tipo. */
export function byCategory(entries: readonly Entry[], kind: Entry["kind"] = "expense"): CategoryTotal[] {
  const totals = new Map<string | null, number>();
  for (const e of entries)
    if (e.kind === kind) totals.set(e.categoryId, (totals.get(e.categoryId) ?? 0) + e.cents);
  return [...totals.entries()]
    .map(([categoryId, cents]) => ({ categoryId, cents }))
    .sort((a, b) => b.cents - a.cents || String(a.categoryId).localeCompare(String(b.categoryId)));
}

export interface MemberContribution {
  /** `null` = cassa comune. */
  readonly memberId: MemberId | null;
  readonly cents: number;
}

/** Quanto ha pagato ciascun membro (spese al netto dei rimborsi); la somma è il totale delle spese. */
export function contributions(entries: readonly Entry[]): MemberContribution[] {
  const totals = new Map<MemberId | null, number>();
  for (const e of entries)
    if (e.kind === "expense") totals.set(e.payerMemberId, (totals.get(e.payerMemberId) ?? 0) + e.cents);
  return [...totals.entries()]
    .map(([memberId, cents]) => ({ memberId, cents }))
    .sort((a, b) => b.cents - a.cents || String(a.memberId).localeCompare(String(b.memberId)));
}

// ---- Periodi e confronto --------------------------------------------------------------------

export type CompareGranularity = "week" | "month" | "year";
export type CompareMode = "previous" | "lastYear";
export interface ClosedRange {
  readonly from: IsoDate;
  readonly to: IsoDate;
}

/** Settimana (lunedì-domenica), mese o anno che contiene la data. */
export function periodAround(g: CompareGranularity, date: IsoDate): ClosedRange {
  if (g === "week") {
    const from = weekStart(date);
    return { from, to: addDays(from, 6) };
  }
  const y = date.slice(0, 4);
  if (g === "year") return { from: `${y}-01-01`, to: `${y}-12-31` };
  const from = monthStart(date);
  return { from, to: addDays(nextStart(from, "month"), -1) };
}

/** Il periodo con cui confrontare: il precedente, oppure lo stesso di un anno prima (settimana: 52 settimane prima). */
export function comparisonPeriod(
  g: CompareGranularity,
  current: ClosedRange,
  mode: CompareMode,
): ClosedRange {
  const from = current.from;
  const yearBack = (): IsoDate => `${String(Number(from.slice(0, 4)) - 1).padStart(4, "0")}${from.slice(4)}`;
  if (g === "week") return periodAround(g, addDays(from, mode === "previous" ? -7 : -364));
  if (g === "year" || mode === "lastYear") return periodAround(g, yearBack());
  return periodAround(g, addDays(from, -1));
}

export interface Delta {
  readonly currentCents: number;
  readonly previousCents: number;
  readonly diffCents: number;
  /** Variazione in punti base sul valore assoluto di partenza; `null` se la base è zero. */
  readonly pctBp: number | null;
}

export function delta(currentCents: number, previousCents: number): Delta {
  const diffCents = currentCents - previousCents;
  return {
    currentCents,
    previousCents,
    diffCents,
    pctBp: previousCents === 0 ? null : Math.round((diffCents * FULL_BP) / Math.abs(previousCents)),
  };
}

export interface CategoryDelta extends Delta {
  readonly categoryId: string | null;
}

export interface PeriodComparison {
  readonly income: Delta;
  readonly expense: Delta;
  readonly savings: Delta;
  /** Spese per categoria, anche quelle presenti in un solo periodo; dalla variazione assoluta maggiore. */
  readonly categories: CategoryDelta[];
}

export function comparePeriods(
  entries: readonly Entry[],
  current: DateRange,
  previous: DateRange,
): PeriodComparison {
  const cur = entriesInRange(entries, current);
  const prev = entriesInRange(entries, previous);
  const a = kpis(cur);
  const b = kpis(prev);
  const curCat = new Map(byCategory(cur).map((c) => [c.categoryId, c.cents]));
  const prevCat = new Map(byCategory(prev).map((c) => [c.categoryId, c.cents]));
  const ids = new Set([...curCat.keys(), ...prevCat.keys()]);
  const categories = [...ids]
    .map((categoryId): CategoryDelta => ({
      categoryId,
      ...delta(curCat.get(categoryId) ?? 0, prevCat.get(categoryId) ?? 0),
    }))
    .sort(
      (x, y) =>
        Math.abs(y.diffCents) - Math.abs(x.diffCents) ||
        String(x.categoryId).localeCompare(String(y.categoryId)),
    );
  return {
    income: delta(a.incomeCents, b.incomeCents),
    expense: delta(a.expenseCents, b.expenseCents),
    savings: delta(a.savingsCents, b.savingsCents),
    categories,
  };
}
