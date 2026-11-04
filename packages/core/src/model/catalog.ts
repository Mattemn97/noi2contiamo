// Conti, categorie e destinatari (feature 7): saldo calcolato, nomi unici, un solo livello di categorie.
import { cents, type Cents } from "../money";
import { normalize } from "../normalize";
import { err, ok, type Result } from "../result";
import type { Account, Category, Payee, Transaction } from "./schemas";

type BalanceTx = Pick<
  Transaction,
  "type" | "date" | "amountCents" | "isRefund" | "accountId" | "toAccountId"
>;

/**
 * Effetto di un movimento sul conto: entrata +, spesa −, giroconto − in uscita e + in entrata.
 * Un rimborso inverte il segno (una spesa rimborsata riporta soldi sul conto).
 */
export function balanceEffect(tx: BalanceTx, accountId: string): Cents {
  const sign = tx.isRefund ? -1 : 1;
  if (tx.type === "income" && tx.accountId === accountId) return cents(sign * tx.amountCents);
  if (tx.type === "expense" && tx.accountId === accountId) return cents(-sign * tx.amountCents);
  if (tx.type === "transfer") {
    if (tx.accountId === accountId && tx.toAccountId !== accountId) return cents(-tx.amountCents);
    if (tx.toAccountId === accountId && tx.accountId !== accountId) return cents(tx.amountCents);
  }
  return cents(0);
}

/** Saldo del conto: `initialBalanceCents` + movimenti con `date >= initialBalanceDate` (spec 0002, Value sourcing). */
export function accountBalance(
  account: Pick<Account, "id" | "initialBalanceCents" | "initialBalanceDate">,
  transactions: readonly BalanceTx[],
): Cents {
  return cents(
    transactions
      .filter((tx) => tx.date >= account.initialBalanceDate)
      .reduce((total, tx) => total + balanceEffect(tx, account.id), account.initialBalanceCents),
  );
}

export type NameIssue = "duplicate";

/** Nome già usato: conti tra i non archiviati, categorie per `kind` e `parentId`, destinatari in tutta la famiglia. */
export function nameTaken(
  collection: "accounts" | "categories" | "payees",
  doc: { readonly id: string; readonly name: string } & Partial<
    Pick<Category, "kind" | "parentId" | "archivedAtMs">
  >,
  others: readonly ({ readonly id: string; readonly name: string } & Partial<
    Pick<Category, "kind" | "parentId" | "archivedAtMs">
  >)[],
): boolean {
  const key = normalize(doc.name);
  return others.some((other) => {
    if (other.id === doc.id || normalize(other.name) !== key) return false;
    if (collection === "accounts")
      return (other.archivedAtMs ?? null) === null && (doc.archivedAtMs ?? null) === null;
    if (collection === "categories")
      return other.kind === doc.kind && (other.parentId ?? null) === (doc.parentId ?? null);
    return true;
  });
}

/** Un solo livello: il genitore esiste, è dello stesso tipo, non ha a sua volta un genitore; chi ha figli non diventa figlio. */
export function checkCategory(category: Category, all: readonly Category[]): Result<Category, string[]> {
  if (category.parentId === null) return ok(category);
  const issues: string[] = [];
  const parent = all.find((c) => c.id === category.parentId);
  if (category.parentId === category.id) issues.push("parentId: una categoria non può contenere sé stessa");
  else if (!parent) issues.push("parentId: categoria genitore inesistente");
  else {
    if (parent.parentId !== null) issues.push("parentId: le categorie hanno un solo livello");
    if (parent.kind !== category.kind) issues.push("parentId: il genitore deve avere lo stesso tipo");
  }
  if (all.some((c) => c.parentId === category.id && c.id !== category.id))
    issues.push("parentId: una categoria con sottocategorie non può diventare sottocategoria");
  return issues.length === 0 ? ok(category) : err(issues);
}

/** Documento del destinatario da un nome scritto a mano (`normalizedName` viene dal nome). */
export function payeeFromName(id: string, name: string): Pick<Payee, "id" | "name" | "normalizedName"> {
  const trimmed = name.trim().replace(/\s+/g, " ");
  return { id, name: trimmed, normalizedName: normalize(trimmed) };
}

/** Voci per una lista di scelta: le non archiviate, più quella già scelta anche se archiviata. */
export function pickable<T extends { readonly id: string; readonly archivedAtMs: number | null }>(
  items: readonly T[],
  selectedId: string | null = null,
): T[] {
  return items.filter((item) => item.archivedAtMs === null || item.id === selectedId);
}
