// Condizioni delle regole automatiche (spec 0007, AC-1..AC-3): funzioni pure, nessuna regex dal testo utente.
import type { Rule, Transaction } from "../model/schemas";
import { normalize } from "../normalize";

/** I valori del movimento su cui si valutano le condizioni (prima di qualunque azione). */
export type RuleSubject = Pick<Transaction, "type" | "amountCents" | "accountId"> & {
  readonly toAccountId?: string | null;
  readonly payeeId?: string | null;
  readonly payerMemberId?: string | null;
  readonly description?: string;
};

export type RuleConditions = Rule["conditions"];

/**
 * Confronto con caratteri jolly (AC-2): `*` qualsiasi testo, `?` un carattere, il resto letterale; il
 * modello copre tutto il testo. Algoritmo lineare con ritorno all'ultima stella: nessuna regex, nessun
 * caso esponenziale. Testo e modello vanno già normalizzati.
 */
export function wildcardMatch(text: string, pattern: string): boolean {
  let t = 0;
  let p = 0;
  let star = -1;
  let mark = 0;
  while (t < text.length) {
    const c = pattern[p];
    if (c !== undefined && c !== "*" && (c === "?" || c === text[t])) {
      t += 1;
      p += 1;
    } else if (c === "*") {
      star = p;
      mark = t;
      p += 1;
    } else if (star >= 0) {
      p = star + 1;
      mark += 1;
      t = mark;
    } else return false;
  }
  while (pattern[p] === "*") p += 1;
  return p === pattern.length;
}

export function descriptionMatches(
  description: string,
  condition: NonNullable<RuleConditions["description"]>,
): boolean {
  const text = normalize(description);
  const value = normalize(condition.value);
  switch (condition.op) {
    case "contains":
      return text.includes(value);
    case "startsWith":
      return text.startsWith(value);
    case "equals":
      return text === value;
    case "pattern":
      return wildcardMatch(text, value.replace(/\*+/g, "*"));
  }
}

/** Le singole condizioni presenti, ognuna già valutata (l'intervallo di importo conta una volta). */
function conditionResults(c: RuleConditions, tx: RuleSubject): boolean[] {
  const results: boolean[] = [];
  if (c.types) results.push(c.types.includes(tx.type));
  if (c.accountIds) {
    const ids = c.accountIds;
    results.push(ids.includes(tx.accountId) || (tx.toAccountId != null && ids.includes(tx.toAccountId)));
  }
  if (c.payeeIds) results.push(tx.payeeId != null && c.payeeIds.includes(tx.payeeId));
  if (c.memberIds) results.push(tx.payerMemberId != null && c.memberIds.includes(tx.payerMemberId));
  if (c.description) results.push(descriptionMatches(tx.description ?? "", c.description));
  if (c.amountMinCents !== undefined || c.amountMaxCents !== undefined)
    results.push(
      (c.amountMinCents === undefined || tx.amountCents >= c.amountMinCents) &&
        (c.amountMaxCents === undefined || tx.amountCents <= c.amountMaxCents),
    );
  return results;
}

/** Vero se le condizioni (tutte o almeno una, secondo `match`) valgono per il movimento. */
export function conditionsMatch(conditions: RuleConditions, tx: RuleSubject): boolean {
  const results = conditionResults(conditions, tx);
  if (results.length === 0) return false;
  return conditions.match === "any" ? results.some(Boolean) : results.every(Boolean);
}

export function ruleMatches(rule: Pick<Rule, "enabled" | "conditions">, tx: RuleSubject): boolean {
  return rule.enabled && conditionsMatch(rule.conditions, tx);
}
