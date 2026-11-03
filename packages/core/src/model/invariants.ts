// Invarianti del movimento che dipendono da altri documenti (AC-2). Le altre stanno nello schema.
import { err, ok, type Result } from "../result";
import type { Account, Category, Payee, Recurrence, Transaction } from "./schemas";

export interface TransactionContext {
  readonly account: Account | null;
  readonly toAccount: Account | null;
  readonly category: Category | null;
  /** Il destinatario di `payeeId`; assente = non controllato (chi chiama non l'ha letto). */
  readonly payee?: Payee | null;
  /** Membri della famiglia (anche usciti: lo storico può citarli). */
  readonly memberIds: ReadonlySet<string>;
}

export function checkTransaction(tx: Transaction, ctx: TransactionContext): Result<Transaction, string[]> {
  const issues: string[] = [];
  if (!ctx.account) issues.push("accountId: conto inesistente");
  if (tx.type === "transfer" && tx.toAccountId !== null && !ctx.toAccount)
    issues.push("toAccountId: conto inesistente");
  if (tx.categoryId !== null) {
    if (!ctx.category) issues.push("categoryId: categoria inesistente");
    else if (ctx.category.kind !== tx.type) issues.push("categoryId: la categoria deve avere lo stesso kind");
  }
  if (tx.payeeId !== null && ctx.payee === null) issues.push("payeeId: destinatario inesistente");
  for (const memberId of Object.keys(tx.split?.shares ?? {}))
    if (!ctx.memberIds.has(memberId)) issues.push(`split: ${memberId} non è un membro della famiglia`);
  for (const memberId of [tx.payerMemberId, tx.settlement?.fromMemberId, tx.settlement?.toMemberId])
    if (memberId && !ctx.memberIds.has(memberId)) issues.push(`${memberId} non è un membro della famiglia`);

  if (tx.visibility === "private") {
    const privateOf = (a: Account | null) =>
      a?.visibility === "private" && a.ownerMemberId === tx.ownerMemberId;
    if (!privateOf(ctx.account))
      issues.push("visibility: privato solo su un conto privato dello stesso proprietario");
    if (tx.type === "transfer" && !privateOf(ctx.toAccount))
      issues.push(
        "visibility: un giroconto è privato solo se entrambi i conti sono privati dello stesso membro",
      );
  } else {
    const isPrivate = (a: Account | null) => a?.visibility === "private";
    if (isPrivate(ctx.account) && (tx.type !== "transfer" || isPrivate(ctx.toAccount)))
      issues.push("visibility: un movimento su un conto privato è privato");
  }
  return issues.length === 0 ? ok(tx) : err(issues);
}

/** Riferimenti di una ricorrenza (spec 0008, AC-14): conti, categoria, destinatario e membri della divisione. */
export function recurrenceRefIssues(
  rec: Recurrence,
  ctx: Pick<TransactionContext, "account" | "toAccount" | "category" | "payee" | "memberIds">,
): string[] {
  const issues: string[] = [];
  if (!ctx.account) issues.push("accountId: conto inesistente");
  if (rec.toAccountId !== null && !ctx.toAccount) issues.push("toAccountId: conto inesistente");
  if (rec.categoryId !== null && !ctx.category) issues.push("categoryId: categoria inesistente");
  if (rec.payeeId !== null && ctx.payee === null) issues.push("payeeId: destinatario inesistente");
  for (const memberId of Object.keys(rec.split?.shares ?? {}))
    if (!ctx.memberIds.has(memberId)) issues.push(`split: ${memberId} non è un membro della famiglia`);
  return issues;
}

/** `visibility`, `ownerMemberId` e `payerMemberId` di default, copiati dal conto (spec 0002, Value sourcing). */
export function accountDefaults(
  account: Account,
  toAccount: Account | null = null,
): Pick<Transaction, "visibility" | "ownerMemberId" | "payerMemberId"> {
  const bothPrivate =
    account.visibility === "private" &&
    (toAccount === null ||
      (toAccount.visibility === "private" && toAccount.ownerMemberId === account.ownerMemberId));
  return {
    visibility: bothPrivate ? "private" : "shared",
    ownerMemberId: bothPrivate ? account.ownerMemberId : null,
    payerMemberId: account.ownerMemberId,
  };
}
