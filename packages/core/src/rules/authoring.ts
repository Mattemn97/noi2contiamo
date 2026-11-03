// Scrivere regole (spec 0007, AC-12..AC-15): destinatario dalla descrizione, regola da un movimento,
// riordino e controlli in italiano.
import type { WriteDocOf } from "../model/registry";
import { ruleSchema, type Rule, type Transaction } from "../model/schemas";
import { normalize } from "../normalize";
import type { RuleContext, RuleLike } from "./engine";

/** Parole delle banche che non dicono chi è il destinatario (confronto sul testo normalizzato). */
export const BANK_NOISE_WORDS: ReadonlySet<string> = new Set([
  "pagamento",
  "pag",
  "pagam",
  "pos",
  "carta",
  "carte",
  "card",
  "addebito",
  "add",
  "sdd",
  "rid",
  "bonifico",
  "bonif",
  "bon",
  "a",
  "favore",
  "fav",
  "di",
  "da",
  "del",
  "della",
  "dello",
  "prelievo",
  "prel",
  "acquisto",
  "acq",
  "contactless",
  "n",
  "nr",
  "num",
  "op",
  "oper",
  "operazione",
  "presso",
  "tramite",
  "apple",
  "google",
  "pay",
  "vs",
  "disposizione",
  "disp",
  "ricarica",
  "rata",
  "mandato",
  "cod",
  "ord",
  "beneficiario",
  "benef",
  "ordinante",
  "debit",
  "deb",
  "mastercard",
  "visa",
  "maestro",
  "bancomat",
  "pagobancomat",
  "fattura",
  "in",
  "data",
  "ore",
  "il",
  "ecommerce",
  "online",
  "internet",
  "sepa",
  "core",
  "inc",
  "incasso",
  "per",
  "su",
  "transazione",
  "trx",
  "rif",
  "valuta",
  "estero",
  "commissione",
  "c",
  "cc",
]);

const titleCase = (word: string) =>
  word
    .toLocaleLowerCase("it")
    .replace(/(^|[\s'&.-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toLocaleUpperCase("it"));

const hasDigit = (word: string) => /\d/.test(word);
const clean = (word: string) => word.replace(/^[^\p{L}\d]+|[^\p{L}\d]+$/gu, "");

/**
 * Destinatario proposto dalla descrizione della banca (AC-13): via le parole bancarie e i codici
 * iniziali, poi al massimo 3 parole fino alla prima con una cifra o una parola bancaria.
 * `PAGAMENTO POS ESSELUNGA 1234 MILANO` → `Esselunga`. Nessuna parola utile → null.
 */
export function payeeNameFromDescription(description: string): string | null {
  const words = description
    .split(/[\s*/]+/)
    .map(clean)
    .filter((w) => w !== "");
  const isNoise = (w: string) => hasDigit(w) || BANK_NOISE_WORDS.has(normalize(w));
  let i = 0;
  while (i < words.length && isNoise(words[i] ?? "")) i += 1;
  const picked: string[] = [];
  for (; i < words.length && picked.length < 3; i += 1) {
    const w = words[i] ?? "";
    if (isNoise(w)) break;
    picked.push(w);
  }
  if (picked.length === 0) return null;
  const name = titleCase(picked.join(" ")).slice(0, 100).trim();
  return normalize(name).length >= 2 ? name : null;
}

export type RuleDraft = Omit<WriteDocOf<"rules">, "id" | "order">;

export interface RuleFromTransaction {
  readonly rule: RuleDraft;
  /** Destinatario da creare insieme alla regola (null se esiste già o non serve). */
  readonly newPayeeName: string | null;
}

/** "Crea regola da questo movimento" (AC-12). */
export function ruleFromTransaction(
  tx: Transaction,
  payees: readonly { readonly id: string; readonly name: string; readonly normalizedName: string }[],
): RuleFromTransaction {
  const suggested = payeeNameFromDescription(tx.description);
  const known = suggested ? payees.find((p) => p.normalizedName === normalize(suggested)) : undefined;
  const current = payees.find((p) => p.id === tx.payeeId);
  const keyword = suggested
    ? normalize(suggested)
    : normalize(tx.description).split(" ").slice(0, 3).join(" ");
  const types = tx.type === "transfer" ? undefined : [tx.type];
  const conditions: RuleDraft["conditions"] =
    keyword !== ""
      ? { types, description: { op: "contains", value: keyword } }
      : tx.payeeId
        ? { types, payeeIds: [tx.payeeId] }
        : { types, accountIds: [tx.accountId] };
  const payeeId = tx.payeeId ?? known?.id;
  const newPayeeName = !payeeId && suggested ? suggested : null;
  const split = tx.split?.source === "manual" && tx.split.kind === "bp" ? tx.split : null;
  const name = (current?.name ?? suggested ?? (tx.description.trim() || "Nuova regola")).slice(0, 60);
  return {
    rule: {
      name,
      enabled: true,
      conditions,
      actions: {
        ...(tx.categoryId && { categoryId: tx.categoryId }),
        ...(payeeId && { payeeId }),
        ...(split && { split: { kind: "bp", shares: { ...split.shares } } }),
      },
    },
    newPayeeName,
  };
}

/** `order` per una regola nuova: in fondo (AC-14). */
export function nextRuleOrder(rules: readonly Pick<Rule, "order">[]): number {
  return rules.reduce((max, r) => Math.max(max, r.order + 1), 0);
}

/**
 * Sposta la regola da `from` a `to` (indici nella lista già ordinata) e rinumera 0, 1, 2, ...
 * Restituisce solo le regole il cui `order` cambia (AC-14).
 */
export function reorderRules<T extends Pick<Rule, "id" | "order">>(
  ordered: readonly T[],
  from: number,
  to: number,
): T[] {
  if (from === to || from < 0 || to < 0 || from >= ordered.length || to >= ordered.length) return [];
  const list = [...ordered];
  const [moved] = list.splice(from, 1);
  if (moved === undefined) return [];
  list.splice(to, 0, moved);
  return list.flatMap((r, i) => (r.order === i ? [] : [{ ...r, order: i }]));
}

/** Controlli prima di salvare (AC-11, AC-15): schema e riferimenti, in italiano. Vuoto = valida. */
export function ruleIssues(rule: unknown, ctx: RuleContext): string[] {
  const parsed = ruleSchema
    .omit({ createdAtMs: true, createdByMemberId: true, updatedAtMs: true, updatedByMemberId: true })
    .safeParse(rule);
  if (!parsed.success) return parsed.error.issues.map((i) => i.message);
  const { conditions: c, actions: a } = parsed.data;
  const issues: string[] = [];
  const has = (list: readonly { readonly id: string }[], id: string) => list.some((x) => x.id === id);
  if (c.accountIds?.some((id) => !has(ctx.accounts, id))) issues.push("un conto della condizione non esiste");
  if (c.payeeIds?.some((id) => !has(ctx.payees, id)))
    issues.push("un destinatario della condizione non esiste");
  if (c.memberIds?.some((id) => !ctx.activeMemberIds.has(id)))
    issues.push("un membro della condizione non è attivo");
  if (a.categoryId) {
    const cat = ctx.categories.find((x) => x.id === a.categoryId);
    if (!cat) issues.push("la categoria non esiste");
    else if (c.types && c.types.every((t) => t !== cat.kind))
      issues.push("la categoria non è del tipo dei movimenti scelti");
  }
  if (a.payeeId && !has(ctx.payees, a.payeeId)) issues.push("il destinatario non esiste");
  if (a.transferAccountId && !has(ctx.accounts, a.transferAccountId))
    issues.push("il conto del giroconto non esiste");
  if (a.split && Object.keys(a.split.shares).some((id) => !ctx.activeMemberIds.has(id)))
    issues.push("la divisione usa un membro non attivo");
  return issues;
}

/** Riferimenti che una regola salvata nomina ma che non esistono più (avviso nella lista, AC-14). */
export function ruleMissingRefs(rule: RuleLike, ctx: RuleContext): boolean {
  const ids = (list: readonly { readonly id: string }[]) => new Set(list.map((x) => x.id));
  const accounts = ids(ctx.accounts);
  const payees = ids(ctx.payees);
  const categories = ids(ctx.categories);
  const { conditions: c, actions: a } = rule;
  return (
    (c.accountIds ?? []).some((id) => !accounts.has(id)) ||
    (c.payeeIds ?? []).some((id) => !payees.has(id)) ||
    (c.memberIds ?? []).some((id) => !ctx.activeMemberIds.has(id)) ||
    (a.categoryId !== undefined && !categories.has(a.categoryId)) ||
    (a.payeeId !== undefined && !payees.has(a.payeeId)) ||
    (a.transferAccountId !== undefined && !accounts.has(a.transferAccountId)) ||
    Object.keys(a.split?.shares ?? {}).some((id) => !ctx.activeMemberIds.has(id))
  );
}
