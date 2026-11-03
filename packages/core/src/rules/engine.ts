// Motore delle regole automatiche (spec 0007, AC-4..AC-10): per ogni campo vince la prima regola che lo
// imposta, un campo scritto a mano non cambia mai. Usato da import, modulo, anteprima e "Applica".
import { autoSplit } from "../division";
import type { ImportHook } from "../import/plan";
import { accountDefaults } from "../model/invariants";
import type { WriteDocOf } from "../model/registry";
import type { Account, Category, Family, Payee, Rule, Transaction } from "../model/schemas";
import { resolveSplit, sameShares, type SplitSpec } from "../split";
import { ruleMatches, type RuleSubject } from "./match";

export type RuleLike = Pick<Rule, "id" | "name" | "enabled" | "order" | "conditions" | "actions">;
export type RuleField = "category" | "payee" | "split" | "transfer";

export interface RuleContext {
  readonly family: Pick<Family, "defaultSplit">;
  readonly categories: readonly Pick<
    Category,
    "id" | "kind" | "parentId" | "defaultSplit" | "archivedAtMs"
  >[];
  readonly payees: readonly Pick<Payee, "id">[];
  readonly accounts: readonly Account[];
  readonly activeMemberIds: ReadonlySet<string>;
}

interface Decided<T> {
  readonly value: T;
  readonly ruleId: string;
}

/** Cosa le regole decidono per un movimento, campo per campo, con la regola che ha vinto. */
export interface RuleOutcome {
  readonly categoryId?: Decided<string>;
  readonly payeeId?: Decided<string>;
  readonly split?: Decided<SplitSpec>;
  readonly transferAccountId?: Decided<string>;
  /** Regole con `recurring`, nell'ordine. */
  readonly recurring: readonly string[];
}

/** Il movimento come lo vede il motore: un documento in scrittura (anche un `Transaction` salvato). */
export type RuleTx = WriteDocOf<"transactions">;

type Provenance = NonNullable<RuleTx["provenance"]>;
const provenanceOf = (tx: RuleTx): Required<Provenance> => ({
  category: tx.provenance?.category ?? "manual",
  payee: tx.provenance?.payee ?? "manual",
  split: tx.provenance?.split ?? "manual",
});

/** Regole in ordine di priorità: `order` crescente, poi `id` (AC-5). */
export function sortRules<T extends Pick<Rule, "order" | "id">>(rules: readonly T[]): T[] {
  return [...rules].sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export interface EvaluateOptions {
  /** Campi da non toccare oltre a quelli `manual` (per esempio quelli cambiati nel modulo). */
  readonly locked?: ReadonlySet<RuleField>;
  /** Falso nel modulo manuale: il giroconto non si propone (AC-9). */
  readonly allowTransfer?: boolean;
}

const subjectOf = (tx: RuleTx): RuleSubject => ({
  type: tx.type,
  amountCents: tx.amountCents,
  accountId: tx.accountId,
  toAccountId: tx.toAccountId ?? null,
  payeeId: tx.payeeId ?? null,
  payerMemberId: tx.payerMemberId ?? null,
  description: tx.description ?? "",
});

/** Decide i campi (AC-5, AC-6, AC-7). Le condizioni si valutano sui valori di partenza. */
export function evaluateRules(
  tx: RuleTx,
  rules: readonly RuleLike[],
  ctx: RuleContext,
  options: EvaluateOptions = {},
): RuleOutcome {
  if (tx.type === "transfer") return { recurring: [] };
  const prov = provenanceOf(tx);
  const locked = (field: RuleField) =>
    options.locked?.has(field) === true ||
    (field === "transfer"
      ? prov.category === "manual" || prov.split === "manual" || prov.payee === "manual"
      : prov[field] === "manual");
  const subject = subjectOf(tx);
  const shared = (tx.visibility ?? "shared") === "shared";
  let categoryId: Decided<string> | undefined;
  let payeeId: Decided<string> | undefined;
  let split: Decided<SplitSpec> | undefined;
  let transferAccountId: Decided<string> | undefined;
  const recurring: string[] = [];

  for (const rule of sortRules(rules)) {
    if (!ruleMatches(rule, subject)) continue;
    const a = rule.actions;
    if (a.recurring) recurring.push(rule.id);
    if (a.categoryId && !categoryId && !locked("category")) {
      const cat = ctx.categories.find((c) => c.id === a.categoryId);
      if (cat && cat.archivedAtMs === null && cat.kind === tx.type)
        categoryId = { value: cat.id, ruleId: rule.id };
    }
    if (a.payeeId && !payeeId && !locked("payee") && ctx.payees.some((p) => p.id === a.payeeId))
      payeeId = { value: a.payeeId, ruleId: rule.id };
    if (
      a.split &&
      !split &&
      shared &&
      !locked("split") &&
      Object.keys(a.split.shares).every((id) => ctx.activeMemberIds.has(id))
    )
      split = { value: a.split, ruleId: rule.id };
    if (
      a.transferAccountId &&
      !transferAccountId &&
      options.allowTransfer !== false &&
      !locked("transfer") &&
      !(tx.isRefund ?? false) &&
      a.transferAccountId !== tx.accountId &&
      ctx.accounts.some((acc) => acc.id === a.transferAccountId)
    )
      transferAccountId = { value: a.transferAccountId, ruleId: rule.id };
  }
  return {
    ...(categoryId && { categoryId }),
    ...(payeeId && { payeeId }),
    ...(split && { split }),
    ...(transferAccountId && { transferAccountId }),
    recurring,
  };
}

const addIds = (existing: readonly string[], more: readonly (string | undefined)[]): string[] => {
  const out = [...existing];
  for (const id of more) if (id !== undefined && !out.includes(id)) out.push(id);
  return out;
};

/**
 * Scrive l'esito sul movimento. Un campo cambia solo se il valore è diverso (così riapplicare non cambia
 * niente, AC-10); la divisione segue la nuova categoria se non è manuale né di regola (AC-7).
 */
export function applyOutcome<T extends RuleTx>(tx: T, outcome: RuleOutcome, ctx: RuleContext): T {
  const prov = provenanceOf(tx);
  const transfer = outcome.transferAccountId;
  if (transfer && (tx.type === "income" || tx.type === "expense")) {
    const here = ctx.accounts.find((a) => a.id === tx.accountId);
    const there = ctx.accounts.find((a) => a.id === transfer.value);
    if (here && there) {
      const [from, to] = tx.type === "expense" ? [here, there] : [there, here];
      return {
        ...tx,
        type: "transfer",
        accountId: from.id,
        toAccountId: to.id,
        categoryId: null,
        split: null,
        settlement: null,
        isRefund: false,
        ...accountDefaults(from, to),
        provenance: { ...prov, category: "rule", split: "rule" },
        ruleIds: addIds(tx.ruleIds ?? [], [transfer.ruleId, ...outcome.recurring]),
      };
    }
  }
  const used: (string | undefined)[] = [];
  let next: T = tx;
  const nextProv = { ...prov };
  const cat = outcome.categoryId;
  if (cat && cat.value !== (tx.categoryId ?? null)) {
    next = { ...next, categoryId: cat.value };
    nextProv.category = "rule";
    used.push(cat.ruleId);
  }
  const payee = outcome.payeeId;
  if (payee && payee.value !== (tx.payeeId ?? null)) {
    next = { ...next, payeeId: payee.value };
    nextProv.payee = "rule";
    used.push(payee.ruleId);
  }
  const current = tx.split ?? null;
  if (outcome.split) {
    const split = resolveSplit({ rule: outcome.split.value, family: ctx.family.defaultSplit });
    if (!current || current.source !== "rule" || !sameShares(current, split)) {
      next = { ...next, split };
      nextProv.split = "rule";
      used.push(outcome.split.ruleId);
    }
  } else if (next !== tx && next.categoryId !== (tx.categoryId ?? null) && prov.split !== "manual") {
    const source = current?.source;
    if (source !== "manual" && source !== "rule") {
      const split = autoSplit(
        {
          type: tx.type,
          categoryId: next.categoryId ?? null,
          accountId: tx.accountId,
          visibility: tx.visibility ?? "shared",
          ownerMemberId: tx.ownerMemberId ?? null,
        },
        ctx,
      );
      if (!current || current.source !== split.source || !sameShares(current, split)) {
        next = { ...next, split };
        nextProv.split = "default";
      }
    }
  }
  const ruleIds = addIds(tx.ruleIds ?? [], [...used, ...outcome.recurring]);
  if (next === tx && ruleIds.length === (tx.ruleIds ?? []).length) return tx;
  return { ...next, provenance: nextProv, ruleIds };
}

/** Evaluate + apply in un passo. */
export function applyRules<T extends RuleTx>(
  tx: T,
  rules: readonly RuleLike[],
  ctx: RuleContext,
  options?: EvaluateOptions,
): T {
  return applyOutcome(tx, evaluateRules(tx, rules, ctx, options), ctx);
}

/** L'aggancio di `planImport` (AC-8): solo le regole abilitate, nell'ordine. */
export function ruleImportHook(rules: readonly RuleLike[], ctx: RuleContext): ImportHook {
  const enabled = sortRules(rules.filter((r) => r.enabled));
  return (tx) => (enabled.length === 0 ? tx : applyRules(tx, enabled, ctx));
}

export type ChangedField = RuleField | "recurring";

export interface RuleChange {
  readonly before: Transaction;
  readonly after: Transaction;
  readonly fields: readonly ChangedField[];
}

function changedFields(before: Transaction, after: Transaction): ChangedField[] {
  const fields: ChangedField[] = [];
  if (before.type !== after.type) return ["transfer"];
  if (before.categoryId !== after.categoryId) fields.push("category");
  if (before.payeeId !== after.payeeId) fields.push("payee");
  const a = before.split;
  const b = after.split;
  if ((a === null) !== (b === null) || (a && b && (a.source !== b.source || !sameShares(a, b))))
    fields.push("split");
  if (fields.length === 0 && before.ruleIds.length !== after.ruleIds.length) fields.push("recurring");
  return fields;
}

/**
 * "Applica ai movimenti esistenti" (AC-10): solo i movimenti che cambiano davvero, con prima e dopo.
 * I campi `manual` restano; un campo messo da una regola che ora non corrisponde resta com'è.
 */
export function planApplyRules(
  transactions: readonly Transaction[],
  rules: readonly RuleLike[],
  ctx: RuleContext,
): RuleChange[] {
  const enabled = sortRules(rules.filter((r) => r.enabled));
  if (enabled.length === 0) return [];
  return transactions.flatMap((before) => {
    if (before.type === "transfer") return [];
    const after = applyRules(before, enabled, ctx);
    if (after === before) return [];
    const fields = changedFields(before, after);
    return fields.length > 0 ? [{ before, after, fields }] : [];
  });
}

export interface RulePreviewItem {
  readonly tx: Transaction;
  /** Il movimento dopo questa regola da sola, null se non cambia niente. */
  readonly after: Transaction | null;
  readonly fields: readonly ChangedField[];
  /** Campi che la regola imposterebbe ma che restano perché scritti a mano. */
  readonly keptManual: readonly RuleField[];
}

/** Prova di una regola (AC-11), anche disabilitata o non salvata, sui movimenti dati. */
export function previewRule(
  rule: RuleLike,
  transactions: readonly Transaction[],
  ctx: RuleContext,
): RulePreviewItem[] {
  const active = { ...rule, enabled: true };
  return transactions.flatMap((tx): RulePreviewItem[] => {
    if (tx.type === "transfer" || !ruleMatches(active, tx)) return [];
    const after = applyRules(tx, [active], ctx);
    const keptManual: RuleField[] = [];
    const a = rule.actions;
    if (a.categoryId && tx.provenance.category === "manual" && tx.categoryId !== a.categoryId)
      keptManual.push("category");
    if (a.payeeId && tx.provenance.payee === "manual" && tx.payeeId !== a.payeeId) keptManual.push("payee");
    if (a.split && tx.provenance.split === "manual") keptManual.push("split");
    if (a.transferAccountId && after.type !== "transfer") keptManual.push("transfer");
    return [
      after === tx
        ? { tx, after: null, fields: [], keptManual }
        : { tx, after, fields: changedFields(tx, after), keptManual },
    ];
  });
}

export interface RuleSuggestion {
  readonly categoryId?: Decided<string>;
  readonly payeeId?: Decided<string>;
  readonly split?: Decided<SplitSpec>;
  readonly recurring: readonly string[];
}

/** Suggerimento nel modulo del nuovo movimento (AC-9): mai il giroconto, mai i campi già toccati. */
export function suggestFromRules(
  subject: RuleSubject & { readonly visibility?: "shared" | "private" },
  rules: readonly RuleLike[],
  ctx: RuleContext,
  touched: ReadonlySet<RuleField> = new Set(),
): RuleSuggestion {
  if (subject.type === "transfer") return { recurring: [] };
  const outcome = evaluateRules(
    {
      ...subject,
      toAccountId: null,
      date: "1970-01-01",
      id: "",
      provenance: { category: "default", payee: "default", split: "default" },
    },
    rules.filter((r) => r.enabled),
    ctx,
    { locked: touched, allowTransfer: false },
  );
  return {
    ...(outcome.categoryId && { categoryId: outcome.categoryId }),
    ...(outcome.payeeId && { payeeId: outcome.payeeId }),
    ...(outcome.split && { split: outcome.split }),
    recurring: outcome.recurring,
  };
}
