// Saldo tra i membri e pareggio (feature 10, spec 0005). Tutto puro: il saldo si ricava dai movimenti,
// non si salva mai. Positivo = gli altri devono soldi a quel membro.
import type { IsoDate, MemberId } from "./ids";
import { accountDefaults } from "./model/invariants";
import type { WriteDocOf } from "./model/registry";
import type { Account, Family, Transaction } from "./model/schemas";
import type { DateRange } from "./register";
import { err, ok, type Result } from "./result";
import { allocateShares, memberAmounts } from "./split";

export type BalanceTx = Pick<
  Transaction,
  | "type"
  | "date"
  | "amountCents"
  | "isRefund"
  | "accountId"
  | "toAccountId"
  | "payerMemberId"
  | "split"
  | "settlement"
  | "visibility"
>;

export interface BalanceContext {
  readonly accounts: readonly Pick<Account, "id" | "ownerMemberId">[];
  /** La cassa comune (conto senza proprietario) appartiene ai membri secondo questa divisione (AC-3). */
  readonly family: Pick<Family, "defaultSplit">;
  /** I membri da mostrare sempre, anche a zero, in quest'ordine. */
  readonly memberIds?: readonly MemberId[];
  /** Solo i movimenti con la data nell'intervallo (AC-6); assente = tutti. */
  readonly range?: DateRange;
}

export interface BalanceRow {
  readonly memberId: MemberId;
  /** Spese pagate, meno i rimborsi ricevuti su quelle spese. */
  readonly paidCents: number;
  /** Quota delle spese (meno la quota dei rimborsi). */
  readonly expenseShareCents: number;
  /** Entrate incassate (meno i rimborsi di entrate restituiti). */
  readonly receivedCents: number;
  /** Quota delle entrate. */
  readonly incomeShareCents: number;
  /** Giroconti dati meno giroconti ricevuti (pareggi compresi). */
  readonly transfersCents: number;
  /** `paid − expenseShare − received + incomeShare + transfers`. */
  readonly netCents: number;
}

export interface Balances {
  readonly rows: readonly BalanceRow[];
  /** Somma dei saldi: è sempre zero (controllo di coerenza). */
  readonly totalCents: number;
}

type Field = Exclude<keyof BalanceRow, "memberId" | "netCents">;

/** Il membro di un conto; `null` = cassa comune (conto senza proprietario o sconosciuto). */
export function partyOf(
  accountId: string | null,
  accounts: readonly Pick<Account, "id" | "ownerMemberId">[],
): MemberId | null {
  return accounts.find((a) => a.id === accountId)?.ownerMemberId ?? null;
}

const SIGN: Readonly<Record<Field, 1 | -1>> = {
  paidCents: 1,
  expenseShareCents: -1,
  receivedCents: -1,
  incomeShareCents: 1,
  transfersCents: 1,
};

export function memberBalances(txs: readonly BalanceTx[], ctx: BalanceContext): Balances {
  const acc = new Map<MemberId, Record<Field, number>>();
  const order: MemberId[] = [...(ctx.memberIds ?? [])];
  const row = (id: MemberId) => {
    let current = acc.get(id);
    if (!current) {
      current = {
        paidCents: 0,
        expenseShareCents: 0,
        receivedCents: 0,
        incomeShareCents: 0,
        transfersCents: 0,
      };
      acc.set(id, current);
      if (!order.includes(id)) order.push(id);
    }
    return current;
  };
  for (const id of order) row(id);
  const credit = (field: Field, amounts: Readonly<Record<MemberId, number>>, sign: 1 | -1) => {
    for (const [id, value] of Object.entries(amounts)) row(id)[field] += sign * value;
  };
  /** Importo di una parte: a un membro, oppure diviso tra i membri se è la cassa comune. */
  const ofParty = (party: MemberId | null, amount: number): Record<MemberId, number> =>
    party === null ? allocateShares(amount, ctx.family.defaultSplit.shares) : { [party]: amount };

  const from = ctx.range?.from ?? null;
  const to = ctx.range?.to ?? null;
  for (const tx of txs) {
    if (tx.visibility === "private") continue;
    if (from !== null && tx.date < from) continue;
    if (to !== null && tx.date > to) continue;
    const sign = tx.isRefund ? -1 : 1;
    if (tx.type === "transfer") {
      const giver = tx.settlement ? tx.settlement.fromMemberId : partyOf(tx.accountId, ctx.accounts);
      const taker = tx.settlement ? tx.settlement.toMemberId : partyOf(tx.toAccountId, ctx.accounts);
      if (giver !== null && giver === taker) continue;
      credit("transfersCents", ofParty(giver, tx.amountCents), 1);
      credit("transfersCents", ofParty(taker, tx.amountCents), -1);
      continue;
    }
    if (!tx.split) continue;
    const shares = memberAmounts(tx.amountCents, tx.split);
    const payer = ofParty(tx.payerMemberId, tx.amountCents);
    if (tx.type === "expense") {
      credit("paidCents", payer, sign);
      credit("expenseShareCents", shares, sign);
    } else {
      credit("receivedCents", payer, sign);
      credit("incomeShareCents", shares, sign);
    }
  }
  const rows = order.map((memberId): BalanceRow => {
    const r = row(memberId);
    const netCents = (Object.keys(SIGN) as Field[]).reduce((sum, f) => sum + SIGN[f] * r[f], 0);
    return { memberId, ...r, netCents };
  });
  return { rows, totalCents: rows.reduce((sum, r) => sum + r.netCents, 0) };
}

// ---- Pagamenti per pareggiare ---------------------------------------------------------------

export interface SettlementPayment {
  readonly fromMemberId: MemberId;
  readonly toMemberId: MemberId;
  readonly amountCents: number;
}

/** Oltre questo numero di membri con saldo non zero il piano è greedy (al più n − 1 pagamenti). */
export const EXACT_PLAN_LIMIT = 12;

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** Greedy: il debitore più grande paga il creditore più grande, finché tutto è zero. */
function greedy(entries: readonly (readonly [MemberId, number])[]): SettlementPayment[] {
  const left = new Map(entries);
  const payments: SettlementPayment[] = [];
  const pick = (wantPositive: boolean) =>
    [...left.entries()]
      .filter(([, v]) => (wantPositive ? v > 0 : v < 0))
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]) || byId(a[0], b[0]))[0];
  for (;;) {
    const creditor = pick(true);
    const debtor = pick(false);
    if (!creditor || !debtor) return payments;
    const amount = Math.min(creditor[1], -debtor[1]);
    payments.push({ fromMemberId: debtor[0], toMemberId: creditor[0], amountCents: amount });
    left.set(creditor[0], creditor[1] - amount);
    left.set(debtor[0], debtor[1] + amount);
  }
}

/**
 * I pagamenti che portano tutti i saldi a zero, nel numero minimo (AC-7): si divide in più gruppi
 * a somma zero possibile (ogni gruppo di g membri si chiude con g − 1 pagamenti). I saldi devono sommare a zero.
 */
export function settlementPlan(nets: Readonly<Record<MemberId, number>>): SettlementPayment[] {
  const entries = Object.entries(nets)
    .filter(([, v]) => v !== 0)
    .sort((a, b) => byId(a[0], b[0]));
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  if (total !== 0) throw new RangeError(`I saldi sommano a ${total}, non a zero`);
  const n = entries.length;
  const groups: (readonly [MemberId, number])[][] = [];
  if (n > EXACT_PLAN_LIMIT) groups.push(entries);
  else {
    const size = 1 << n;
    const sum = new Array<number>(size).fill(0);
    const best = new Array<number>(size).fill(0);
    for (let mask = 1; mask < size; mask++) {
      const low = mask & -mask;
      sum[mask] = (sum[mask ^ low] ?? 0) + (entries[31 - Math.clz32(low)]?.[1] ?? 0);
      let top = 0;
      for (let i = 0; i < n; i++) if (mask & (1 << i)) top = Math.max(top, best[mask ^ (1 << i)] ?? 0);
      best[mask] = top + (sum[mask] === 0 ? 1 : 0);
    }
    // Si ripercorre il cammino migliore: ogni volta che la somma torna zero si chiude un gruppo.
    const removed: number[] = [];
    let mask = size - 1;
    while (mask !== 0) {
      const need = (best[mask] ?? 0) - (sum[mask] === 0 ? 1 : 0);
      let next = 0;
      for (let i = 0; i < n; i++) {
        if (mask & (1 << i) && best[mask ^ (1 << i)] === need) {
          next = i;
          break;
        }
      }
      removed.push(next);
      mask ^= 1 << next;
    }
    let current: (readonly [MemberId, number])[] = [];
    let running = 0;
    for (const index of removed.reverse()) {
      const entry = entries[index];
      if (!entry) continue;
      current.push(entry);
      running += entry[1];
      if (running === 0) {
        groups.push(current);
        current = [];
      }
    }
  }
  return groups
    .flatMap(greedy)
    .sort(
      (a, b) =>
        b.amountCents - a.amountCents ||
        byId(a.fromMemberId, b.fromMemberId) ||
        byId(a.toMemberId, b.toMemberId),
    );
}

// ---- Registrare il pareggio -----------------------------------------------------------------

export type SettlementAccounts = readonly Pick<
  Account,
  "id" | "ownerMemberId" | "visibility" | "archivedAtMs" | "order" | "name"
>[];

/** Il conto predefinito di un membro per il pareggio: suo condiviso, suo, cassa comune, qualsiasi. */
export function settlementAccount(
  memberId: MemberId,
  accounts: SettlementAccounts,
  exclude: string | null = null,
): string | null {
  const active = accounts
    .filter((a) => a.archivedAtMs === null && a.id !== exclude)
    .sort((a, b) => a.order - b.order || byId(a.id, b.id));
  const rank = (a: SettlementAccounts[number]) =>
    a.ownerMemberId === memberId ? (a.visibility === "shared" ? 0 : 1) : a.ownerMemberId === null ? 2 : 3;
  return [...active].sort((a, b) => rank(a) - rank(b))[0]?.id ?? null;
}

export type SettlementError = "no_accounts" | "amount" | "same_member";

/**
 * Il giroconto che registra un pareggio (AC-8): dal debitore al creditore, con `settlement`.
 * I conti si possono scegliere; altrimenti `settlementAccount` per ognuno.
 */
export function settlementTransfer(
  payment: SettlementPayment,
  ctx: {
    readonly id: string;
    readonly date: IsoDate;
    readonly accounts: readonly Account[];
    readonly fromAccountId?: string | null;
    readonly toAccountId?: string | null;
    readonly description?: string;
  },
): Result<WriteDocOf<"transactions">, SettlementError> {
  if (!Number.isSafeInteger(payment.amountCents) || payment.amountCents <= 0) return err("amount");
  if (payment.fromMemberId === payment.toMemberId) return err("same_member");
  const fromId = ctx.fromAccountId ?? settlementAccount(payment.fromMemberId, ctx.accounts);
  const toId = ctx.toAccountId ?? settlementAccount(payment.toMemberId, ctx.accounts, fromId);
  const from = ctx.accounts.find((a) => a.id === fromId);
  const to = ctx.accounts.find((a) => a.id === toId);
  if (!from || !to || from.id === to.id) return err("no_accounts");
  return ok({
    id: ctx.id,
    type: "transfer",
    date: ctx.date,
    amountCents: payment.amountCents,
    accountId: from.id,
    toAccountId: to.id,
    categoryId: null,
    payeeId: null,
    description: ctx.description ?? "",
    split: null,
    settlement: { fromMemberId: payment.fromMemberId, toMemberId: payment.toMemberId },
    ...accountDefaults(from, to),
    payerMemberId: payment.fromMemberId,
  });
}
