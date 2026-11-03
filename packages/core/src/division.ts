// Divisione dei movimenti tra i membri (spec 0004): da dove viene e come si riapplica.
import { splitSpecSchema, type Account, type Category, type Family, type Transaction } from "./model/schemas";
import { resolveSplit, sameShares, type SplitSpec, type TransactionSplit } from "./split";

/** Divisione predefinita di una categoria: la sua, altrimenti quella della principale, altrimenti null. */
export function categorySplit(
  categoryId: string | null,
  categories: readonly Pick<Category, "id" | "parentId" | "defaultSplit">[],
): SplitSpec | null {
  const category = categories.find((c) => c.id === categoryId);
  if (!category) return null;
  if (category.defaultSplit) return category.defaultSplit;
  const parent = categories.find((c) => c.id === category.parentId);
  return parent?.defaultSplit ?? null;
}

export interface AutoSplitContext {
  readonly family: Pick<Family, "defaultSplit">;
  readonly categories: readonly Pick<Category, "id" | "parentId" | "defaultSplit">[];
  readonly accounts: readonly Pick<Account, "id" | "ownerMemberId">[];
}

/** La divisione automatica (senza manuale né regola) di un'entrata o spesa. */
export function autoSplit(
  tx: Pick<Transaction, "type" | "categoryId" | "accountId" | "visibility" | "ownerMemberId">,
  ctx: AutoSplitContext,
): TransactionSplit {
  const account = ctx.accounts.find((a) => a.id === tx.accountId);
  return resolveSplit({
    privateOwner: tx.visibility === "private" ? tx.ownerMemberId : null,
    category: categorySplit(tx.categoryId, ctx.categories),
    incomeOwner: tx.type === "income" ? (account?.ownerMemberId ?? null) : null,
    family: ctx.family.defaultSplit,
  });
}

/**
 * Riapplica la divisione automatica ai movimenti esistenti (AC-6): solo entrate e spese condivise con
 * divisione `category` o `default`, mai `manual` né `rule`. Restituisce solo quelli che cambiano.
 * `categoryId` limita ai movimenti di quella categoria e delle sue sottocategorie.
 */
export function reapplySplits(
  transactions: readonly Transaction[],
  ctx: AutoSplitContext & { readonly categoryId?: string },
): Transaction[] {
  const inScope = (tx: Transaction) => {
    if (ctx.categoryId === undefined) return true;
    if (tx.categoryId === ctx.categoryId) return true;
    return ctx.categories.find((c) => c.id === tx.categoryId)?.parentId === ctx.categoryId;
  };
  return transactions.flatMap((tx) => {
    if (tx.type === "transfer" || tx.visibility !== "shared" || !tx.split) return [];
    if (tx.split.source !== "category" && tx.split.source !== "default") return [];
    if (!inScope(tx)) return [];
    const next = autoSplit(tx, ctx);
    if (next.source === tx.split.source && sameShares(next, tx.split)) return [];
    return [{ ...tx, split: next, provenance: { ...tx.provenance, split: "default" as const } }];
  });
}

/** Divisione della famiglia (AC-7): schema `SplitSpec` e chiavi tutte membri attivi. Vuoto = valida. */
export function familySplitIssues(split: unknown, activeMemberIds: ReadonlySet<string>): string[] {
  const parsed = splitSpecSchema.safeParse(split);
  if (!parsed.success) return parsed.error.issues.map((i) => i.message);
  return Object.keys(parsed.data.shares)
    .filter((id) => !activeMemberIds.has(id))
    .map((id) => `${id} non è un membro attivo della famiglia`);
}
