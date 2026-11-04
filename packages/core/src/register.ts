// Registro movimenti (feature 8): periodi, filtri e tabelle riassuntive. Tutto puro: il periodo si legge
// dal backend con un intervallo di date, gli altri filtri e i totali si calcolano qui (spec 0002, strategia letture).
import { cents, type Cents } from "./money";
import { normalize } from "./normalize";
import type { IsoDate } from "./ids";
import type { Transaction } from "./model/schemas";

export type RegisterTx = Pick<
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
  | "payerMemberId"
  | "description"
  | "notes"
>;

/** Importo con il verso: entrate +, spese −, rimborsi al contrario, giroconti a zero (non sono né entrate né spese). */
export function signedCents(tx: Pick<Transaction, "type" | "amountCents" | "isRefund">): Cents {
  if (tx.type === "transfer") return cents(0);
  const sign = (tx.type === "income") !== tx.isRefund ? 1 : -1;
  return cents(sign * tx.amountCents);
}

// ---- Periodi --------------------------------------------------------------------------------

export type PeriodPreset = "thisMonth" | "lastMonth" | "last30" | "thisYear" | "lastYear" | "all" | "custom";

export const PERIOD_PRESETS: readonly PeriodPreset[] = [
  "thisMonth",
  "lastMonth",
  "last30",
  "thisYear",
  "lastYear",
  "all",
  "custom",
];

/** Intervallo inclusivo; `null` = senza limite da quel lato. */
export interface DateRange {
  readonly from: IsoDate | null;
  readonly to: IsoDate | null;
}

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
const iso = (y: number, m: number, d: number) => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();

function parts(date: IsoDate): readonly [number, number, number] {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return [y, m, d];
}

/** Sposta una data di `days` giorni (calendario puro, nessun fuso). */
export function addDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = parts(date);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return iso(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/**
 * L'intervallo di una scorciatoia rispetto a `today` (il giorno del dispositivo, passato da fuori).
 * `custom` usa `custom`; da e a invertiti si scambiano.
 */
export function periodRange(
  preset: PeriodPreset,
  today: IsoDate,
  custom: DateRange = { from: null, to: null },
): DateRange {
  const [y, m] = parts(today);
  switch (preset) {
    case "thisMonth":
      return { from: iso(y, m, 1), to: iso(y, m, lastDay(y, m)) };
    case "lastMonth": {
      const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
      return { from: iso(py, pm, 1), to: iso(py, pm, lastDay(py, pm)) };
    }
    case "last30":
      return { from: addDays(today, -29), to: today };
    case "thisYear":
      return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
    case "lastYear":
      return { from: iso(y - 1, 1, 1), to: iso(y - 1, 12, 31) };
    case "all":
      return { from: null, to: null };
    case "custom":
      if (custom.from !== null && custom.to !== null && custom.from > custom.to)
        return { from: custom.to, to: custom.from };
      return custom;
  }
}

// ---- Filtri ---------------------------------------------------------------------------------

/** Valore dei filtri che significa "nessuno": senza categoria, senza destinatario, pagato dalla cassa comune. */
export const NONE = "none";

export interface RegisterFilter {
  readonly range?: DateRange;
  readonly type?: Transaction["type"] | null;
  /** Conto di origine o di arrivo (un giroconto conta per entrambi). */
  readonly accountId?: string | null;
  /** Chi ha pagato (`payerMemberId`); `NONE` = cassa comune. */
  readonly memberId?: string | null;
  /** Una categoria principale comprende le sue sottocategorie; `NONE` = da categorizzare. */
  readonly categoryId?: string | null;
  /** `NONE` = senza destinatario. */
  readonly payeeId?: string | null;
  /** Cerca (senza accenti né maiuscole) in descrizione, note e nome del destinatario. */
  readonly text?: string;
}

export interface FilterContext {
  readonly categories?: readonly { readonly id: string; readonly parentId: string | null }[];
  readonly payeeNames?: ReadonlyMap<string, string>;
}

const matchesKey = (wanted: string | null | undefined, actual: string | null): boolean =>
  wanted === undefined ||
  wanted === null ||
  wanted === "" ||
  (wanted === NONE ? actual === null : actual === wanted);

/** I movimenti che passano tutti i filtri, nello stesso ordine. */
export function filterTransactions<T extends RegisterTx>(
  txs: readonly T[],
  filter: RegisterFilter,
  ctx: FilterContext = {},
): T[] {
  const from = filter.range?.from ?? null;
  const to = filter.range?.to ?? null;
  const needle = normalize(filter.text ?? "");
  const wantedCategories =
    filter.categoryId && filter.categoryId !== NONE
      ? new Set([
          filter.categoryId,
          ...(ctx.categories ?? []).filter((c) => c.parentId === filter.categoryId).map((c) => c.id),
        ])
      : null;
  return txs.filter((tx) => {
    if (from !== null && tx.date < from) return false;
    if (to !== null && tx.date > to) return false;
    if (filter.type && tx.type !== filter.type) return false;
    if (filter.accountId && tx.accountId !== filter.accountId && tx.toAccountId !== filter.accountId)
      return false;
    if (!matchesKey(filter.memberId, tx.payerMemberId)) return false;
    if (
      wantedCategories
        ? !(tx.categoryId !== null && wantedCategories.has(tx.categoryId))
        : !matchesKey(filter.categoryId, tx.categoryId)
    )
      return false;
    if (!matchesKey(filter.payeeId, tx.payeeId)) return false;
    if (needle !== "") {
      const payee = tx.payeeId ? (ctx.payeeNames?.get(tx.payeeId) ?? "") : "";
      const haystack = normalize(`${tx.description} ${tx.notes ?? ""} ${payee}`);
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

// ---- Totali e tabelle riassuntive ----------------------------------------------------------

export interface Totals {
  readonly count: number;
  /** Entrate meno i rimborsi di entrate. */
  readonly incomeCents: Cents;
  /** Spese meno i rimborsi di spese (positivo = si è speso). */
  readonly expenseCents: Cents;
  /** `incomeCents − expenseCents`, uguale alla somma di `signedCents`. */
  readonly netCents: Cents;
}

export const ZERO_TOTALS: Totals = {
  count: 0,
  incomeCents: cents(0),
  expenseCents: cents(0),
  netCents: cents(0),
};

function add(total: Totals, tx: Pick<Transaction, "type" | "amountCents" | "isRefund">): Totals {
  const signed = signedCents(tx);
  const income = tx.type === "income" ? signed : 0;
  const expense = tx.type === "expense" ? 0 - signed : 0;
  return {
    count: total.count + 1,
    incomeCents: cents(total.incomeCents + income),
    expenseCents: cents(total.expenseCents + expense),
    netCents: cents(total.netCents + signed),
  };
}

export function totalsOf(txs: readonly Pick<Transaction, "type" | "amountCents" | "isRefund">[]): Totals {
  return txs.reduce(add, ZERO_TOTALS);
}

export type SummaryDimension = "type" | "account" | "member" | "category" | "payee";

export const SUMMARY_DIMENSIONS: readonly SummaryDimension[] = [
  "type",
  "account",
  "member",
  "category",
  "payee",
];

export interface SummaryRow extends Totals {
  /** Id della voce (tipo, conto, membro, categoria, destinatario); `null` = nessuno / cassa comune. */
  readonly key: string | null;
}

/** La voce di un movimento per la dimensione: ognuno sta in una sola riga, così le righe tornano col totale. */
export function dimensionKey(tx: RegisterTx, dimension: SummaryDimension): string | null {
  switch (dimension) {
    case "type":
      return tx.type;
    case "account":
      return tx.accountId;
    case "member":
      return tx.payerMemberId;
    case "category":
      return tx.categoryId;
    case "payee":
      return tx.payeeId;
  }
}

/**
 * Una riga per voce, dalla più pesante (entrate + spese) alla più leggera, poi per chiave; `null` in fondo.
 * La somma delle righe è sempre `totalsOf(txs)`.
 */
export function summarize(txs: readonly RegisterTx[], dimension: SummaryDimension): SummaryRow[] {
  const groups = new Map<string | null, Totals>();
  for (const tx of txs) {
    const key = dimensionKey(tx, dimension);
    groups.set(key, add(groups.get(key) ?? ZERO_TOTALS, tx));
  }
  const weight = (row: Totals) => Math.abs(row.incomeCents) + Math.abs(row.expenseCents);
  return [...groups.entries()]
    .map(([key, totals]): SummaryRow => ({ key, ...totals }))
    .sort((a, b) => {
      if (a.key === null || b.key === null) return a.key === null ? (b.key === null ? 0 : 1) : -1;
      return weight(b) - weight(a) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
    });
}

/** Le righe sommate: serve a controllare che una tabella riassuntiva torni con il totale generale. */
export function sumRows(rows: readonly Totals[]): Totals {
  return rows.reduce<Totals>(
    (total, row) => ({
      count: total.count + row.count,
      incomeCents: cents(total.incomeCents + row.incomeCents),
      expenseCents: cents(total.expenseCents + row.expenseCents),
      netCents: cents(total.netCents + row.netCents),
    }),
    ZERO_TOTALS,
  );
}

// ---- Pagine ---------------------------------------------------------------------------------

export const REGISTER_PAGE_SIZE = 50;

/** La pagina `page` (da 1), fermata tra la prima e l'ultima. */
export function pageOf<T>(
  items: readonly T[],
  page: number,
  size: number = REGISTER_PAGE_SIZE,
): { readonly items: T[]; readonly page: number; readonly pages: number } {
  const pages = Math.max(1, Math.ceil(items.length / size));
  const current = Math.min(Math.max(1, Math.trunc(Number.isFinite(page) ? page : 1)), pages);
  return { items: items.slice((current - 1) * size, current * size), page: current, pages };
}
