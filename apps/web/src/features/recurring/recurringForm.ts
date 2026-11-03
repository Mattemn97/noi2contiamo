// Dal modulo al documento della ricorrenza e le etichette di frequenza (spec 0008, AC-1, AC-11).
import {
  recurrenceIssues,
  cents,
  type BasisPoints,
  type Cents,
  type Recurrence,
  type RecurrenceContext,
  type RecurrenceDraft,
} from "@noi2contiamo/core";
import { t } from "../../i18n/it";

export type FullRecurrence = Omit<
  Recurrence,
  "createdAtMs" | "createdByMemberId" | "updatedAtMs" | "updatedByMemberId"
>;

export type Frequency = Recurrence["frequency"];
export type Preset = "week" | "month" | "bimonth" | "quarter" | "semester" | "year" | "custom";

export const PRESETS: readonly Preset[] = [
  "week",
  "month",
  "bimonth",
  "quarter",
  "semester",
  "year",
  "custom",
];
const PRESET_FREQ: Record<Exclude<Preset, "custom">, Pick<Frequency, "unit" | "interval">> = {
  week: { unit: "week", interval: 1 },
  month: { unit: "month", interval: 1 },
  bimonth: { unit: "month", interval: 2 },
  quarter: { unit: "month", interval: 3 },
  semester: { unit: "month", interval: 6 },
  year: { unit: "year", interval: 1 },
};

export function presetOf(f: Pick<Frequency, "unit" | "interval">): Preset {
  const found = (
    Object.entries(PRESET_FREQ) as [Exclude<Preset, "custom">, Pick<Frequency, "unit" | "interval">][]
  ).find(([, p]) => p.unit === f.unit && p.interval === f.interval);
  return found?.[0] ?? "custom";
}

export function frequencyLabel(f: Pick<Frequency, "unit" | "interval">): string {
  return f.interval === 1 ? t(`rec.freq.${f.unit}1`) : t(`rec.freq.${f.unit}`, { n: String(f.interval) });
}

export interface RecurrenceForm {
  readonly name: string;
  readonly type: "expense" | "income" | "transfer";
  readonly amountCents: Cents | null;
  readonly fixed: boolean;
  readonly toleranceBp: BasisPoints | null;
  readonly accountId: string | null;
  readonly toAccountId: string | null;
  readonly categoryId: string | null;
  readonly payeeId: string | null;
  readonly preset: Preset;
  readonly unit: Frequency["unit"];
  readonly interval: string;
  readonly dayOfMonth: string;
  readonly startDate: string;
  readonly endDate: string | null;
  readonly count: string;
  readonly windowDays: string;
}

export function emptyForm(today: string, accountId: string | null): RecurrenceForm {
  return {
    name: "",
    type: "expense",
    amountCents: null,
    fixed: true,
    toleranceBp: 1000 as BasisPoints,
    accountId,
    toAccountId: null,
    categoryId: null,
    payeeId: null,
    preset: "month",
    unit: "month",
    interval: "1",
    dayOfMonth: "",
    startDate: today,
    endDate: null,
    count: "",
    windowDays: "5",
  };
}

export function formOf(rec: RecurrenceDraft): RecurrenceForm {
  return {
    name: rec.name,
    type: rec.type,
    amountCents: cents(rec.expectedAmountCents),
    fixed: (rec.amountToleranceBp ?? 1000) === 0,
    toleranceBp: (!rec.amountToleranceBp ? 1000 : rec.amountToleranceBp) as BasisPoints,
    accountId: rec.accountId,
    toAccountId: rec.toAccountId ?? null,
    categoryId: rec.categoryId ?? null,
    payeeId: rec.payeeId ?? null,
    preset: presetOf(rec.frequency),
    unit: rec.frequency.unit,
    interval: String(rec.frequency.interval),
    dayOfMonth: rec.frequency.dayOfMonth === undefined ? "" : String(rec.frequency.dayOfMonth),
    startDate: rec.startDate,
    endDate: rec.endDate ?? null,
    count: rec.frequency.count === undefined ? "" : String(rec.frequency.count),
    windowDays: String(rec.matchWindowDays ?? 5),
  };
}

const intOrNull = (text: string): number | null => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null);

/** Il documento dal modulo; divisione, testo di abbinamento e salti restano quelli della ricorrenza esistente. */
export function recurrenceOf(form: RecurrenceForm, id: string, base: RecurrenceDraft | null): FullRecurrence {
  const transfer = form.type === "transfer";
  const preset = form.preset === "custom" ? null : PRESET_FREQ[form.preset];
  const unit = preset?.unit ?? form.unit;
  const interval = preset?.interval ?? intOrNull(form.interval) ?? 0;
  const day = unit === "month" || unit === "year" ? intOrNull(form.dayOfMonth) : null;
  const count = intOrNull(form.count);
  return {
    id,
    name: form.name.trim(),
    type: form.type,
    accountId: form.accountId ?? "",
    toAccountId: transfer ? form.toAccountId : null,
    categoryId: transfer ? null : form.categoryId,
    payeeId: form.payeeId,
    expectedAmountCents: form.amountCents ?? 0,
    amountToleranceBp: form.fixed ? 0 : (form.toleranceBp ?? 1000),
    split: transfer ? null : (base?.split ?? null),
    frequency: {
      unit,
      interval,
      ...(day === null ? {} : { dayOfMonth: day }),
      ...(count === null ? {} : { count }),
    },
    startDate: form.startDate,
    endDate: form.endDate,
    matchWindowDays: intOrNull(form.windowDays) ?? 5,
    descriptionMatch: base?.descriptionMatch ?? null,
    skippedDates: base?.skippedDates ?? [],
    archivedAtMs: base?.archivedAtMs ?? null,
  };
}

/** Messaggi in italiano; vuoto = si può salvare. */
export function formIssues(form: RecurrenceForm, id: string, ctx: RecurrenceContext): string[] {
  const issues: string[] = [];
  if (form.name.trim() === "") issues.push(t("rec.error.name"));
  if (form.amountCents === null || form.amountCents <= 0) issues.push(t("rec.error.amount"));
  if (form.accountId === null) issues.push(t("rec.error.account"));
  if (issues.length > 0) return issues;
  return recurrenceIssues(recurrenceOf(form, id, null), ctx);
}
