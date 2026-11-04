// Dal modulo al documento del movimento (nuovo o modificato): divisione e visibilità vengono da `core`
// (spec 0002, Value sourcing).
import {
  AUDIT_KEYS,
  accountDefaults,
  err,
  normalize,
  ok,
  payeeFromName,
  resolveSplit,
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
}

export type DraftError = "amount" | "category" | "account";

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
  };
}

function withoutAudit(tx: Transaction): WriteDocOf<"transactions"> {
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
  // Una divisione scritta a mano resta; le altre seguono la categoria (nuova) o la famiglia.
  const split =
    existing?.split && existing.split.source === "manual" && existing.split.kind === "bp"
      ? existing.split
      : resolveSplit({ category: category.defaultSplit, family: ctx.family.defaultSplit });
  const defaults = accountDefaults(account);
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
          split: split === existing.split ? existing.provenance.split : "default",
        }
      : { category: "manual", payee: "manual", split: "default" },
    ...defaults,
    // Chi ha pagato resta lo stesso se il conto non cambia.
    payerMemberId:
      existing && existing.accountId === account.id ? existing.payerMemberId : defaults.payerMemberId,
  });
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
