// Suggerimenti di ricorrenza dallo storico (spec 0008, AC-7, AC-8). Si salvano solo quelli scartati.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Id, IsoDate } from "../ids";
import type { WriteDocOf } from "../model/registry";
import type { Payee, Rule, Transaction } from "../model/schemas";
import { normalize } from "../normalize";
import { payeeNameFromDescription } from "../rules/authoring";
import { closedTransactionIds, type MatchTx, type RecurrenceLike } from "./match";
import { dateParts, daysBetween, shiftDays } from "./schedule";

export type DetectTx = MatchTx & Pick<Transaction, "ruleIds">;

export interface FrequencyBand {
  readonly unit: "week" | "month" | "year";
  readonly interval: number;
  readonly days: number;
  readonly tolerance: number;
}

/** Frequenze riconosciute: intervallo tipico in giorni e scarto ammesso. */
export const FREQUENCY_BANDS: readonly FrequencyBand[] = [
  { unit: "week", interval: 1, days: 7, tolerance: 2 },
  { unit: "week", interval: 2, days: 14, tolerance: 3 },
  { unit: "month", interval: 1, days: 30, tolerance: 5 },
  { unit: "month", interval: 2, days: 61, tolerance: 7 },
  { unit: "month", interval: 3, days: 91, tolerance: 10 },
  { unit: "month", interval: 6, days: 182, tolerance: 15 },
  { unit: "year", interval: 1, days: 365, tolerance: 20 },
];

export const DETECT_LOOKBACK_DAYS = 395;

export interface RecurringSuggestion {
  readonly key: string;
  readonly name: string;
  readonly type: "income" | "expense";
  readonly accountId: Id;
  readonly payeeId: Id | null;
  readonly categoryId: Id | null;
  readonly descriptionMatch: { readonly op: "contains"; readonly value: string } | null;
  readonly frequency: { readonly unit: FrequencyBand["unit"]; readonly interval: number };
  readonly dayOfMonth: number | null;
  readonly startDate: IsoDate;
  readonly expectedAmountCents: number;
  readonly amountToleranceBp: number;
  readonly transactionIds: readonly Id[];
  readonly dates: readonly IsoDate[];
  readonly fromRule: boolean;
}

export interface DetectInput {
  readonly txs: readonly DetectTx[];
  readonly recurrences: readonly RecurrenceLike[];
  readonly dismissedKeys: ReadonlySet<string>;
  readonly rules: readonly Pick<Rule, "id" | "actions">[];
  readonly payees: readonly Pick<Payee, "id" | "name">[];
  readonly today: IsoDate;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? 0)
    : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
};

const titleCase = (text: string) =>
  text.replace(/(^|\s)(\p{L})/gu, (_, s: string, c: string) => s + c.toUpperCase());

/** Il più frequente; a pari merito il primo in ordine. */
function mostFrequent<T extends string | number>(values: readonly T[]): T | null {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const ranked = [...counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return ranked[0]?.[0] ?? null;
}

/** Fasce di importo: si spezza dove il successivo supera il precedente di più del 25%. */
function amountClusters<T extends { amountCents: number }>(txs: readonly T[]): T[][] {
  const sorted = [...txs].sort((a, b) => a.amountCents - b.amountCents);
  const clusters: T[][] = [];
  for (const tx of sorted) {
    const current = clusters[clusters.length - 1];
    const prev = current?.[current.length - 1];
    if (current && prev && tx.amountCents * 100 <= prev.amountCents * 125) current.push(tx);
    else clusters.push([tx]);
  }
  return clusters;
}

export function suggestionKey(type: string, accountId: Id, identity: string, medianCents: number): string {
  const band = Math.round(Math.log(Math.max(1, medianCents)) / Math.log(1.25));
  return bytesToHex(sha256(utf8ToBytes([type, accountId, identity, String(band)].join("|")))).slice(0, 32);
}

/** La frequenza della serie di date, se regolare (AC-7). */
export function detectFrequency(dates: readonly IsoDate[], fromRule = false): FrequencyBand | null {
  const sorted = [...dates].sort();
  const gaps = sorted.slice(1).map((d, i) => daysBetween(sorted[i] ?? d, d));
  if (gaps.length === 0) return null;
  const typical = median(gaps);
  const band = FREQUENCY_BANDS.find((b) => Math.abs(typical - b.days) <= b.tolerance);
  if (!band) return null;
  const minCount = band.unit === "year" || fromRule ? 2 : 3;
  if (sorted.length < minCount) return null;
  const regular = gaps.filter((g) => Math.abs(g - band.days) <= band.tolerance).length;
  return regular * 4 >= gaps.length * 3 ? band : null;
}

/** I pagamenti che si ripetono nello storico e non sono già coperti da una ricorrenza. */
export function detectRecurring(input: DetectInput): RecurringSuggestion[] {
  const from = shiftDays(input.today, -DETECT_LOOKBACK_DAYS);
  const recurringRules = new Set(input.rules.filter((r) => r.actions.recurring).map((r) => r.id));
  const closed = closedTransactionIds(input.recurrences, input.txs, from, shiftDays(input.today, 31));
  const payeeName = new Map(input.payees.map((p) => [p.id, p.name]));
  const groups = new Map<string, DetectTx[]>();
  const stems = new Map<string, string>();
  for (const tx of input.txs) {
    if (tx.type === "transfer" || tx.isRefund || tx.date < from || tx.date > input.today) continue;
    if (closed.has(tx.id)) continue;
    let identity: string;
    if (tx.payeeId !== null) identity = `p:${tx.payeeId}`;
    else {
      const name = payeeNameFromDescription(tx.description);
      if (name === null) continue;
      identity = `d:${normalize(name)}`;
      stems.set(identity, name);
    }
    const key = `${tx.type}|${tx.accountId}|${identity}`;
    groups.set(key, [...(groups.get(key) ?? []), tx]);
  }
  const out: RecurringSuggestion[] = [];
  for (const [groupKey, txs] of groups) {
    const [type = "expense", accountId = "", identity = ""] = groupKey.split("|");
    for (const cluster of amountClusters(txs)) {
      const ordered = [...cluster].sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
      const fromRule = ordered.some((tx) => tx.ruleIds.some((id) => recurringRules.has(id)));
      const band = detectFrequency(
        ordered.map((tx) => tx.date),
        fromRule,
      );
      const first = ordered[0];
      const last = ordered[ordered.length - 1];
      if (!band || !first || !last) continue;
      if (daysBetween(last.date, input.today) > 2 * band.days + 10) continue;
      const amounts = ordered.map((tx) => tx.amountCents);
      const expected = median(amounts);
      const key = suggestionKey(type, accountId, identity, expected);
      if (input.dismissedKeys.has(key)) continue;
      const deviation = Math.max(
        ...amounts.map((a) => Math.ceil((Math.abs(a - expected) * 10_000) / expected)),
      );
      const tolerance = deviation === 0 ? 0 : Math.min(5000, Math.max(500, Math.ceil(deviation / 500) * 500));
      const payeeId = identity.startsWith("p:") ? identity.slice(2) : null;
      const stem = stems.get(identity) ?? null;
      const name = payeeId ? (payeeName.get(payeeId) ?? "") : titleCase(normalize(stem ?? ""));
      out.push({
        key,
        name: name.slice(0, 60) || "Ricorrenza",
        type: type === "income" ? "income" : "expense",
        accountId,
        payeeId,
        categoryId: mostFrequent(ordered.flatMap((tx) => (tx.categoryId ? [tx.categoryId] : []))),
        descriptionMatch: payeeId === null && stem ? { op: "contains", value: normalize(stem) } : null,
        frequency: { unit: band.unit, interval: band.interval },
        dayOfMonth: band.unit === "week" ? null : mostFrequent(ordered.map((tx) => dateParts(tx.date)[2])),
        startDate: first.date,
        expectedAmountCents: expected,
        amountToleranceBp: tolerance,
        transactionIds: ordered.map((tx) => tx.id),
        dates: ordered.map((tx) => tx.date),
        fromRule,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, "it") || a.key.localeCompare(b.key));
}

export type RecurrenceDraft = Omit<WriteDocOf<"recurrences">, "id">;

/** La bozza dell'editor da un suggerimento accettato (AC-8). */
export function recurrenceFromSuggestion(s: RecurringSuggestion): RecurrenceDraft {
  return {
    name: s.name,
    type: s.type,
    accountId: s.accountId,
    toAccountId: null,
    categoryId: s.categoryId,
    payeeId: s.payeeId,
    expectedAmountCents: s.expectedAmountCents,
    amountToleranceBp: s.amountToleranceBp,
    split: null,
    frequency: {
      unit: s.frequency.unit,
      interval: s.frequency.interval,
      ...(s.dayOfMonth === null ? {} : { dayOfMonth: s.dayOfMonth }),
    },
    startDate: s.startDate,
    endDate: null,
    matchWindowDays: 5,
    descriptionMatch: s.descriptionMatch,
    skippedDates: [],
    archivedAtMs: null,
  };
}
