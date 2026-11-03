// Controlli dell'editor prima di salvare (spec 0008, AC-11, AC-14): schema e riferimenti, in italiano.
import type { Account, Category, Payee } from "../model/schemas";
import { recurrenceObjectSchema, recurrenceShapeIssues } from "../model/schemas";

export interface RecurrenceContext {
  readonly accounts: readonly Pick<Account, "id">[];
  readonly categories: readonly Pick<Category, "id" | "kind">[];
  readonly payees: readonly Pick<Payee, "id">[];
  readonly activeMemberIds: ReadonlySet<string>;
}

/** Vuoto = valida. */
export function recurrenceIssues(rec: unknown, ctx: RecurrenceContext): string[] {
  const parsed = recurrenceObjectSchema
    .omit({ createdAtMs: true, createdByMemberId: true, updatedAtMs: true, updatedByMemberId: true })
    .superRefine((r, c) => {
      for (const message of recurrenceShapeIssues(r)) c.addIssue({ code: "custom", message });
    })
    .safeParse(rec);
  if (!parsed.success) return parsed.error.issues.map((i) => i.message);
  const issues: string[] = [];
  const r = parsed.data;
  const has = (list: readonly { readonly id: string }[], id: string) => list.some((x) => x.id === id);
  if (!has(ctx.accounts, r.accountId)) issues.push("il conto non esiste");
  if (r.toAccountId !== null && !has(ctx.accounts, r.toAccountId))
    issues.push("il conto di arrivo non esiste");
  if (r.categoryId !== null) {
    const cat = ctx.categories.find((c) => c.id === r.categoryId);
    if (!cat) issues.push("la categoria non esiste");
    else if (cat.kind !== r.type) issues.push("la categoria non è del tipo scelto");
  }
  if (r.payeeId !== null && !has(ctx.payees, r.payeeId)) issues.push("il destinatario non esiste");
  if (r.split && Object.keys(r.split.shares).some((id) => !ctx.activeMemberIds.has(id)))
    issues.push("la divisione usa un membro non attivo");
  if (r.endDate !== null && r.endDate < r.startDate) issues.push("la fine viene prima dell'inizio");
  return issues;
}
