import type { MemberId } from "./ids";

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

/** Divisione di un movimento nuovo: regola vincente, poi categoria, poi famiglia (spec 0002, Value sourcing). */
export function resolveSplit(sources: {
  readonly rule?: SplitSpec | null | undefined;
  readonly category?: SplitSpec | null | undefined;
  readonly family: SplitSpec;
}): TransactionSplit {
  if (sources.rule) return { kind: "bp", source: "rule", shares: { ...sources.rule.shares } };
  if (sources.category) return { kind: "bp", source: "category", shares: { ...sources.category.shares } };
  return { kind: "bp", source: "default", shares: { ...sources.family.shares } };
}
