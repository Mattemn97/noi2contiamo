// Dal modulo della regola al documento e ritorno, più il riassunto in italiano (spec 0007, AC-11, AC-14).
import { formatBasisPoints, formatCents } from "../../ui/format";
import type { BasisPoints, Cents, Payee, Rule, WriteDocOf } from "@noi2contiamo/core";
import { t, type MessageKey } from "../../i18n/it";
import type { SplitDraft } from "../transactions/newTransaction";
import { resolvePayee } from "../transactions/newTransaction";

export type DescOp = "none" | "contains" | "startsWith" | "equals" | "pattern";
export type EntryKind = "expense" | "income";

export interface RuleFormState {
  readonly name: string;
  readonly enabled: boolean;
  readonly match: "all" | "any";
  readonly types: readonly EntryKind[];
  readonly accountIds: readonly string[];
  readonly memberIds: readonly string[];
  readonly payeeIds: readonly string[];
  readonly descOp: DescOp;
  readonly descValue: string;
  readonly amountMin: Cents | null;
  readonly amountMax: Cents | null;
  readonly categoryId: string | null;
  readonly payeeText: string;
  readonly splitOn: boolean;
  readonly split: SplitDraft;
  readonly transferAccountId: string | null;
  readonly recurring: boolean;
}

type RuleBody = Pick<WriteDocOf<"rules">, "name" | "enabled" | "conditions" | "actions">;

export function emptyForm(memberIds: readonly string[]): RuleFormState {
  return {
    name: "",
    enabled: true,
    match: "all",
    types: ["expense"],
    accountIds: [],
    memberIds: [],
    payeeIds: [],
    descOp: "contains",
    descValue: "",
    amountMin: null,
    amountMax: null,
    categoryId: null,
    payeeText: "",
    splitOn: false,
    split: { kind: "bp", shares: Object.fromEntries(memberIds.map((id) => [id, null])) },
    transferAccountId: null,
    recurring: false,
  };
}

/** Lo stato del modulo da una regola salvata o da una bozza (per esempio quella dal movimento). */
export function formOf(
  rule: RuleBody,
  payees: readonly Pick<Payee, "id" | "name">[],
  memberIds: readonly string[],
  newPayeeName: string | null = null,
): RuleFormState {
  const c = rule.conditions;
  const a = rule.actions;
  const base = emptyForm(memberIds);
  return {
    ...base,
    name: rule.name,
    enabled: rule.enabled ?? true,
    match: c.match ?? "all",
    types: (c.types ?? []).filter((x): x is EntryKind => x !== "transfer"),
    accountIds: c.accountIds ?? [],
    memberIds: c.memberIds ?? [],
    payeeIds: c.payeeIds ?? [],
    descOp: c.description?.op ?? "none",
    descValue: c.description?.value ?? "",
    amountMin: (c.amountMinCents ?? null) as Cents | null,
    amountMax: (c.amountMaxCents ?? null) as Cents | null,
    categoryId: a.categoryId ?? null,
    payeeText: payees.find((p) => p.id === a.payeeId)?.name ?? newPayeeName ?? "",
    splitOn: a.split !== undefined,
    split: a.split ? { kind: "bp", shares: { ...base.split.shares, ...a.split.shares } } : base.split,
    transferAccountId: a.transferAccountId ?? null,
    recurring: a.recurring === true,
  };
}

const nonEmpty = <T>(list: readonly T[]) => (list.length > 0 ? [...list] : undefined);

/** Il documento della regola dallo stato del modulo; il destinatario nuovo si crea nello stesso commit. */
export function ruleOf(
  form: RuleFormState,
  base: { readonly id: string; readonly order: number },
  payees: readonly Payee[],
  newId: () => string,
): { readonly rule: WriteDocOf<"rules">; readonly createPayee: WriteDocOf<"payees"> | null } {
  const payee = resolvePayee(form.payeeText, payees, newId);
  const shares = Object.fromEntries(
    Object.entries(form.split.shares).filter((e): e is [string, number] => e[1] !== null && e[1] > 0),
  );
  const rule: WriteDocOf<"rules"> = {
    id: base.id,
    order: base.order,
    name: form.name.trim(),
    enabled: form.enabled,
    conditions: {
      match: form.match,
      types: nonEmpty(form.types),
      accountIds: nonEmpty(form.accountIds),
      memberIds: nonEmpty(form.memberIds),
      payeeIds: nonEmpty(form.payeeIds),
      description:
        form.descOp !== "none" && form.descValue.trim() !== ""
          ? { op: form.descOp, value: form.descValue.trim() }
          : undefined,
      amountMinCents: form.amountMin ?? undefined,
      amountMaxCents: form.amountMax ?? undefined,
    },
    actions: {
      categoryId: form.transferAccountId ? undefined : (form.categoryId ?? undefined),
      payeeId: payee.payeeId ?? undefined,
      split: form.splitOn && !form.transferAccountId ? { kind: "bp", shares } : undefined,
      transferAccountId: form.transferAccountId ?? undefined,
      recurring: form.recurring ? true : undefined,
    },
  };
  return { rule: withoutUndefined(rule), createPayee: payee.create };
}

/** Le chiavi `undefined` non vanno scritte (Firestore le rifiuta, lo schema stretto le ignora). */
function withoutUndefined(rule: WriteDocOf<"rules">): WriteDocOf<"rules"> {
  const clean = <T extends object>(o: T): T =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
  return { ...rule, conditions: clean(rule.conditions), actions: clean(rule.actions) };
}

export interface Names {
  readonly category: (id: string) => string | null;
  readonly payee: (id: string) => string | null;
  readonly account: (id: string) => string | null;
  readonly member: (id: string) => string | null;
}

const OP_KEYS: Readonly<Record<Exclude<DescOp, "none">, MessageKey>> = {
  contains: "rules.descOp.contains",
  startsWith: "rules.descOp.startsWith",
  equals: "rules.descOp.equals",
  pattern: "rules.descOp.pattern",
};
const TYPE_KEYS: Readonly<Record<"expense" | "income" | "transfer", MessageKey>> = {
  expense: "tx.type.expense",
  income: "tx.type.income",
  transfer: "tx.type.transfer",
};

/** "Se descrizione contiene «esselunga» → categoria Spesa, destinatario Esselunga". */
export function describeRule(rule: Pick<Rule, "conditions" | "actions">, names: Names): string {
  const c = rule.conditions;
  const a = rule.actions;
  const missing = t("rules.sum.missing");
  const list = (ids: readonly string[], name: (id: string) => string | null) =>
    ids.map((id) => name(id) ?? missing).join(", ");
  const conds: string[] = [];
  if (c.types)
    conds.push(t("rules.sum.type", { value: c.types.map((x) => t(TYPE_KEYS[x]).toLowerCase()).join(", ") }));
  if (c.accountIds) conds.push(t("rules.sum.account", { value: list(c.accountIds, names.account) }));
  if (c.payeeIds) conds.push(t("rules.sum.payee", { value: list(c.payeeIds, names.payee) }));
  if (c.memberIds) conds.push(t("rules.sum.member", { value: list(c.memberIds, names.member) }));
  if (c.description)
    conds.push(t("rules.sum.desc", { op: t(OP_KEYS[c.description.op]), value: c.description.value }));
  const min = c.amountMinCents;
  const max = c.amountMaxCents;
  if (min !== undefined && max !== undefined)
    conds.push(
      t("rules.sum.amountRange", { min: formatCents(min as Cents), max: formatCents(max as Cents) }),
    );
  else if (min !== undefined) conds.push(t("rules.sum.amountMin", { min: formatCents(min as Cents) }));
  else if (max !== undefined) conds.push(t("rules.sum.amountMax", { max: formatCents(max as Cents) }));
  const acts: string[] = [];
  if (a.categoryId) acts.push(t("rules.sum.category", { value: names.category(a.categoryId) ?? missing }));
  if (a.payeeId) acts.push(t("rules.sum.setPayee", { value: names.payee(a.payeeId) ?? missing }));
  if (a.split)
    acts.push(
      t("rules.sum.split", {
        value: Object.entries(a.split.shares)
          .map(([id, bp]) => `${names.member(id) ?? missing} ${formatBasisPoints(bp as BasisPoints)}`)
          .join(" · "),
      }),
    );
  if (a.transferAccountId)
    acts.push(t("rules.sum.transfer", { value: names.account(a.transferAccountId) ?? missing }));
  if (a.recurring) acts.push(t("rules.sum.recurring"));
  const joiner = c.match === "any" ? t("rules.sum.or") : t("rules.sum.and");
  return `${t("rules.sum.if")} ${conds.join(joiner)} → ${acts.join(", ")}`;
}
