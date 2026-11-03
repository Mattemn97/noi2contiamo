// Dal modulo al documento del movimento (nuovo o modificato): divisione e visibilità vengono da `core`
// (spec 0002, Value sourcing).
import {
  AUDIT_KEYS,
  accountDefaults,
  autoSplit,
  checkSplit,
  err,
  normalize,
  ok,
  payeeFromName,
  resolveSplit,
  type SplitIssue,
  type SplitSpec,
  type Account,
  type Category,
  type Family,
  type Payee,
  type Result,
  type Transaction,
  type WriteDocOf,
} from "@noi2contiamo/core";

export type EntryType = "expense" | "income";

export interface TransactionDraft {
  readonly type: EntryType;
  readonly amountCents: number | null;
  /** `YYYY-MM-DD`, il giorno nel fuso del dispositivo. */
  readonly date: string;
  readonly categoryId: string | null;
  readonly accountId: string | null;
  readonly description: string;
  /** Già risolto con `resolvePayee`; null = nessun destinatario. */
  readonly payeeId?: string | null;
  /** Divisione scritta a mano nell'editor; assente o null = automatica (spec 0004, AC-1). */
  readonly split?: SplitDraft | null;
  /** Campi rimasti come li ha suggeriti una regola (spec 0007, AC-9), con l'id della regola. */
  readonly rule?: RuleApplied;
}

export interface RuleApplied {
  readonly category?: string;
  readonly payee?: string;
  readonly split?: { readonly spec: SplitSpec; readonly ruleId: string };
  readonly recurring?: readonly string[];
}

/** Lo stato dell'editor della divisione: quote ancora da completare (null = campo vuoto). */
export interface SplitDraft {
  readonly kind: "bp" | "cents";
  readonly shares: Readonly<Record<string, number | null>>;
}

export type DraftError = "amount" | "category" | "account" | "split" | "toAccount" | "sameAccount";

export interface DraftContext {
  readonly id: string;
  readonly family: Family;
  readonly accounts: readonly Account[];
  readonly categories: readonly Category[];
  /** Il movimento che si sta modificando: i campi che il modulo non mostra restano com'erano. */
  readonly existing?: Transaction;
}

/** I valori del modulo per un movimento esistente (solo entrate e spese si modificano qui). */
export function draftOf(tx: Transaction): TransactionDraft | null {
  if (tx.type === "transfer") return null;
  return {
    type: tx.type,
    amountCents: tx.amountCents,
    date: tx.date,
    categoryId: tx.categoryId,
    accountId: tx.accountId,
    description: tx.description,
    payeeId: tx.payeeId,
    split: tx.split?.source === "manual" ? { kind: tx.split.kind, shares: { ...tx.split.shares } } : null,
  };
}

export function withoutAudit(tx: Transaction): WriteDocOf<"transactions"> {
  const audit: ReadonlySet<string> = new Set(AUDIT_KEYS);
  return Object.fromEntries(
    Object.entries(tx).filter(([key]) => !audit.has(key)),
  ) as WriteDocOf<"transactions">;
}

export function buildTransaction(
  draft: TransactionDraft,
  ctx: DraftContext,
): Result<WriteDocOf<"transactions">, DraftError[]> {
  const errors: DraftError[] = [];
  const amount = draft.amountCents;
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) errors.push("amount");
  const category = ctx.categories.find((c) => c.id === draft.categoryId && c.kind === draft.type);
  if (!category) errors.push("category");
  const account = ctx.accounts.find((a) => a.id === draft.accountId);
  if (!account) errors.push("account");
  if (errors.length > 0 || !category || !account || amount === null) return err(errors);

  const existing = ctx.existing;
  const categoryChanged = existing?.categoryId !== category.id;
  const defaults = accountDefaults(account);
  const decided = splitFor(draft, {
    ...ctx,
    amountCents: amount,
    categoryId: category.id,
    accountId: account.id,
    defaults,
  });
  if (!decided.ok) return err(["split"]);
  const split = decided.value;
  const base = existing ? withoutAudit(existing) : null;
  return ok({
    ...base,
    id: existing?.id ?? ctx.id,
    type: draft.type,
    date: draft.date,
    amountCents: amount,
    accountId: account.id,
    categoryId: category.id,
    description: draft.description.trim(),
    payeeId: draft.payeeId ?? null,
    split,
    provenance: existing
      ? {
          category: categoryChanged ? "manual" : existing.provenance.category,
          payee: existing.payeeId !== (draft.payeeId ?? null) ? "manual" : existing.provenance.payee,
          split:
            split.source === "manual"
              ? "manual"
              : split === existing.split
                ? existing.provenance.split
                : "default",
        }
      : {
          category: draft.rule?.category ? "rule" : "manual",
          payee: draft.rule?.payee && draft.payeeId ? "rule" : "manual",
          split: split.source === "manual" ? "manual" : split.source === "rule" ? "rule" : "default",
        },
    ...(existing ? {} : { ruleIds: ruleIdsOf(draft, split) }),
    ...defaults,
    // Chi ha pagato resta lo stesso se il conto non cambia.
    payerMemberId:
      existing && existing.accountId === account.id ? existing.payerMemberId : defaults.payerMemberId,
  });
}

function ruleIdsOf(draft: TransactionDraft, split: NonNullable<Transaction["split"]>): string[] {
  const r = draft.rule;
  if (!r) return [];
  const ids = [
    r.category,
    draft.payeeId ? r.payee : undefined,
    split.source === "rule" ? r.split?.ruleId : undefined,
    ...(r.recurring ?? []),
  ];
  return ids.filter((id, i): id is string => id !== undefined && ids.indexOf(id) === i);
}

/**
 * La divisione da salvare (spec 0004): privato al 100% sul proprietario; poi quella scritta a mano; in
 * automatico la fotografia resta se categoria e conto non cambiano, altrimenti si risolve di nuovo.
 */
function splitFor(
  draft: TransactionDraft,
  ctx: DraftContext & {
    readonly amountCents: number;
    readonly categoryId: string;
    readonly accountId: string;
    readonly defaults: ReturnType<typeof accountDefaults>;
  },
): Result<NonNullable<Transaction["split"]>, SplitIssue> {
  const { defaults, existing } = ctx;
  if (defaults.visibility === "private")
    return ok(resolveSplit({ privateOwner: defaults.ownerMemberId, family: ctx.family.defaultSplit }));
  if (draft.split) {
    const checked = checkSplit(draft.split, ctx.amountCents);
    return checked.ok
      ? ok(resolveSplit({ manual: checked.value, family: ctx.family.defaultSplit }))
      : checked;
  }
  if (draft.rule?.split && !existing)
    return ok(resolveSplit({ rule: draft.rule.split.spec, family: ctx.family.defaultSplit }));
  if (
    existing?.split &&
    existing.split.source !== "manual" &&
    existing.type === draft.type &&
    existing.categoryId === ctx.categoryId &&
    existing.accountId === ctx.accountId
  )
    return ok(existing.split);
  return ok(
    autoSplit(
      { type: draft.type, categoryId: ctx.categoryId, accountId: ctx.accountId, ...defaults },
      { family: ctx.family, categories: ctx.categories, accounts: ctx.accounts },
    ),
  );
}

/** La divisione che il modulo mostrerebbe in automatico (anteprima, nessun controllo). */
export function previewAutoSplit(
  draft: Pick<TransactionDraft, "type" | "categoryId" | "accountId" | "rule">,
  ctx: DraftContext,
): NonNullable<Transaction["split"]> | null {
  const account = ctx.accounts.find((a) => a.id === draft.accountId);
  if (!account) return null;
  const built = splitFor(
    { ...draft, amountCents: 0, date: "", description: "", split: null },
    {
      ...ctx,
      amountCents: 0,
      categoryId: draft.categoryId ?? "",
      accountId: account.id,
      defaults: accountDefaults(account),
    },
  );
  return built.ok ? built.value : null;
}

/**
 * Dal testo del campo destinatario: quello esistente con lo stesso nome normalizzato (anche archiviato),
 * oppure un destinatario nuovo da creare insieme al movimento. Testo vuoto = nessun destinatario.
 */
export function resolvePayee(
  text: string,
  payees: readonly Payee[],
  makeId: () => string,
): { readonly payeeId: string | null; readonly create: WriteDocOf<"payees"> | null } {
  const key = normalize(text);
  if (key === "") return { payeeId: null, create: null };
  const found = payees.find((p) => p.normalizedName === key);
  if (found) return { payeeId: found.id, create: null };
  const create = payeeFromName(makeId(), text);
  return { payeeId: create.id, create };
}

// ---- Giroconti (feature 10, spec 0005, AC-1) ------------------------------------------------

export interface TransferDraft {
  readonly amountCents: number | null;
  readonly date: string;
  readonly accountId: string | null;
  readonly toAccountId: string | null;
  readonly description: string;
}

export function transferDraftOf(tx: Transaction): TransferDraft | null {
  if (tx.type !== "transfer") return null;
  return {
    amountCents: tx.amountCents,
    date: tx.date,
    accountId: tx.accountId,
    toAccountId: tx.toAccountId,
    description: tx.description,
  };
}

/**
 * Dal modulo al giroconto: niente categoria, destinatario né divisione; visibilità e chi paga dai conti.
 * Modificando un giroconto restano `settlement`, impronte e il resto dei campi che il modulo non mostra.
 */
export function buildTransfer(
  draft: TransferDraft,
  ctx: { readonly id: string; readonly accounts: readonly Account[]; readonly existing?: Transaction },
): Result<WriteDocOf<"transactions">, DraftError[]> {
  const errors: DraftError[] = [];
  const amount = draft.amountCents;
  if (amount === null || !Number.isSafeInteger(amount) || amount <= 0) errors.push("amount");
  const from = ctx.accounts.find((a) => a.id === draft.accountId);
  const to = ctx.accounts.find((a) => a.id === draft.toAccountId);
  if (!from) errors.push("account");
  if (!to) errors.push("toAccount");
  if (from && to && from.id === to.id) errors.push("sameAccount");
  if (errors.length > 0 || !from || !to || amount === null) return err(errors);
  const existing = ctx.existing;
  const base = existing ? withoutAudit(existing) : null;
  return ok({
    ...base,
    id: existing?.id ?? ctx.id,
    type: "transfer",
    date: draft.date,
    amountCents: amount,
    isRefund: false,
    accountId: from.id,
    toAccountId: to.id,
    categoryId: null,
    payeeId: null,
    split: null,
    settlement: existing?.type === "transfer" ? existing.settlement : null,
    description: draft.description.trim(),
    ...accountDefaults(from, to),
  });
}
