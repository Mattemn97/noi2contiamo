import type { MemberId } from "./ids";
import { err, ok, type Result } from "./result";

/** 10000 punti base = 100%. */
export const FULL_BP = 10000;

/** Quote per membro: punti base (`kind: "bp"`) o centesimi (`kind: "cents"`). */
export type Shares = Readonly<Record<MemberId, number>>;

const byMemberId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Divide `total` in parti intere proporzionali ai pesi, con il metodo del resto più grande.
 * I pareggi sui resti vanno al `memberId` più piccolo, così l'ordine delle chiavi non conta.
 * La somma del risultato è sempre esattamente `total`.
 */
function largestRemainder(total: number, weights: Shares, weightSum: number): Record<MemberId, number> {
  const ids = Object.keys(weights).sort(byMemberId);
  const bigTotal = BigInt(total);
  const bigSum = BigInt(weightSum);
  const parts = ids.map((id) => {
    const exact = bigTotal * BigInt(weights[id] ?? 0);
    return { id, floor: exact / bigSum, remainder: exact % bigSum };
  });
  let leftover = bigTotal - parts.reduce((sum, part) => sum + part.floor, 0n);
  const order = [...parts].sort((a, b) =>
    a.remainder === b.remainder ? byMemberId(a.id, b.id) : a.remainder > b.remainder ? -1 : 1,
  );
  const extra = new Set<string>();
  for (const part of order) {
    if (leftover === 0n) break;
    extra.add(part.id);
    leftover -= 1n;
  }
  return Object.fromEntries(
    parts.map((part) => [part.id, Number(part.floor + (extra.has(part.id) ? 1n : 0n))]),
  );
}

function assertShares(shares: Shares): number {
  const values = Object.values(shares);
  if (values.length === 0) throw new RangeError("Servono quote per almeno un membro");
  for (const value of values) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Quota non valida: ${value}`);
  }
  return values.reduce((sum, value) => sum + value, 0);
}

/**
 * Importo in centesimi di ogni membro a partire da quote in punti base (somma 10000).
 * Lancia solo su input impossibile (già escluso dagli schemi): è un bug, non un caso atteso.
 */
export function allocateShares(amountCents: number, sharesBp: Shares): Record<MemberId, number> {
  if (!Number.isSafeInteger(amountCents)) throw new RangeError(`Importo non valido: ${amountCents}`);
  const sum = assertShares(sharesBp);
  if (sum !== FULL_BP) throw new RangeError(`Le quote sommano a ${sum}, non a ${FULL_BP}`);
  return largestRemainder(amountCents, sharesBp, FULL_BP);
}

/** Divisione in parti uguali in punti base, esatta (per esempio 3334/3333/3333). */
export function equalShares(memberIds: readonly MemberId[]): Record<MemberId, number> {
  if (memberIds.length === 0) throw new RangeError("Servono membri per dividere");
  const weights = Object.fromEntries(memberIds.map((id) => [id, 1]));
  return largestRemainder(FULL_BP, weights, memberIds.length);
}

export interface SplitSpec {
  readonly kind: "bp";
  readonly shares: Shares;
}

export interface TransactionSplit {
  readonly kind: "bp" | "cents";
  readonly source: "default" | "category" | "rule" | "manual";
  readonly shares: Shares;
}

/** Centesimi di ogni membro per un movimento: `bp` passa da `allocateShares`, `cents` è già il valore. */
export function memberAmounts(amountCents: number, split: TransactionSplit): Record<MemberId, number> {
  return split.kind === "bp" ? allocateShares(amountCents, split.shares) : { ...split.shares };
}

/** Una divisione al 100% su un solo membro (scorciatoia "Tutto a ...", movimenti privati). */
export function soloSplit(memberId: MemberId): SplitSpec {
  return { kind: "bp", shares: { [memberId]: FULL_BP } };
}

/** Parti uguali tra i membri dati, esatte in punti base (scorciatoia "50/50"). */
export function equalSplit(memberIds: readonly MemberId[]): SplitSpec {
  return { kind: "bp", shares: equalShares(memberIds) };
}

/**
 * Da cui viene la divisione di un movimento (spec 0004, AC-1 e AC-2), in ordine di precedenza:
 * privato (sempre 100% al proprietario) > manuale > regola > categoria > proprietario del conto
 * (solo entrate su conto personale) > famiglia.
 */
export interface SplitSources {
  readonly privateOwner?: MemberId | null | undefined;
  readonly manual?: { readonly kind: "bp" | "cents"; readonly shares: Shares } | null | undefined;
  readonly rule?: SplitSpec | null | undefined;
  readonly category?: SplitSpec | null | undefined;
  readonly incomeOwner?: MemberId | null | undefined;
  readonly family: SplitSpec;
}

export function resolveSplit(sources: SplitSources): TransactionSplit {
  if (sources.privateOwner) return { ...soloSplit(sources.privateOwner), source: "default" };
  if (sources.manual)
    return { kind: sources.manual.kind, source: "manual", shares: { ...sources.manual.shares } };
  if (sources.rule) return { kind: "bp", source: "rule", shares: { ...sources.rule.shares } };
  if (sources.category) return { kind: "bp", source: "category", shares: { ...sources.category.shares } };
  if (sources.incomeOwner) return { ...soloSplit(sources.incomeOwner), source: "default" };
  return { kind: "bp", source: "default", shares: { ...sources.family.shares } };
}

export type SplitIssue =
  | { readonly code: "empty" }
  /** `diff` = somma meno atteso (negativo: manca, positivo: avanza), in punti base o centesimi. */
  | { readonly code: "sum"; readonly diff: number };

/**
 * Controlla una divisione scritta a mano: almeno una quota > 0 e somma esatta (10000 o `amountCents`).
 * Restituisce la divisione senza le quote a zero.
 */
export function checkSplit(
  split: { readonly kind: "bp" | "cents"; readonly shares: Readonly<Record<MemberId, number | null>> },
  amountCents: number,
): Result<{ kind: "bp" | "cents"; shares: Record<MemberId, number> }, SplitIssue> {
  const entries = Object.entries(split.shares).filter(
    (entry): entry is [string, number] => entry[1] !== null && entry[1] > 0,
  );
  if (entries.some(([, v]) => !Number.isSafeInteger(v))) return err({ code: "sum", diff: Number.NaN });
  if (entries.length === 0) return err({ code: "empty" });
  const total = entries.reduce((sum, [, v]) => sum + v, 0);
  const expected = split.kind === "bp" ? FULL_BP : amountCents;
  if (total !== expected) return err({ code: "sum", diff: total - expected });
  return ok({ kind: split.kind, shares: Object.fromEntries(entries) });
}

const positiveSum = (shares: Readonly<Record<MemberId, number | null>>) =>
  Object.values(shares).reduce<number>((sum, v) => sum + (v !== null && v > 0 ? v : 0), 0);

const cleanWeights = (shares: Readonly<Record<MemberId, number | null>>): Record<MemberId, number> =>
  Object.fromEntries(Object.entries(shares).map(([id, v]) => [id, v !== null && v > 0 ? v : 0]));

/** Centesimi → punti base (cambio di modalità dell'editor): proporzionale, somma 10000. Tutto zero = tutto zero. */
export function centsToBp(shares: Readonly<Record<MemberId, number | null>>): Record<MemberId, number> {
  const sum = positiveSum(shares);
  const weights = cleanWeights(shares);
  if (sum === 0) return weights;
  return largestRemainder(FULL_BP, weights, sum);
}

/** Punti base → centesimi su `amountCents`, anche se le quote non fanno ancora 100% (in proporzione). */
export function bpToCents(
  amountCents: number,
  shares: Readonly<Record<MemberId, number | null>>,
): Record<MemberId, number> {
  const sum = positiveSum(shares);
  const weights = cleanWeights(shares);
  if (sum === 0 || amountCents <= 0) return Object.fromEntries(Object.keys(weights).map((id) => [id, 0]));
  return largestRemainder(amountCents, weights, sum);
}

/** Stessa divisione (tipo e quote, ignorando le quote a zero e l'ordine delle chiavi). */
export function sameShares(
  a: { readonly kind: string; readonly shares: Shares },
  b: { readonly kind: string; readonly shares: Shares },
): boolean {
  if (a.kind !== b.kind) return false;
  const pos = (s: Shares) => Object.entries(s).filter(([, v]) => v > 0);
  const left = pos(a.shares);
  const right = new Map(pos(b.shares));
  return left.length === right.size && left.every(([id, v]) => right.get(id) === v);
}
