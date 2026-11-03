// Le letture che servono alle pagine delle ricorrenze (spec 0008): tutto dalla famiglia, calcolo in `core`.
import { getLocalTimeZone, today as todayDate } from "@internationalized/date";
import {
  AUDIT_KEYS,
  cents,
  detectRecurring,
  type Account,
  type Category,
  type Member,
  type Payee,
  type Recurrence,
  type RecurringSuggestion,
  type Transaction,
  type WriteDocOf,
} from "@noi2contiamo/core";
import { useMemo } from "react";
import { formatCents } from "../../ui";
import { useAllDocs, useCollection } from "../../data/queries";
import { useFamily } from "../guards";

export const euro = (value: number): string => formatCents(cents(Math.round(value)));

export const todayIso = (): string => todayDate(getLocalTimeZone()).toString();

const audit: ReadonlySet<string> = new Set(AUDIT_KEYS);
const strip = (doc: object) => Object.fromEntries(Object.entries(doc).filter(([key]) => !audit.has(key)));
export const writableTx = (tx: Transaction) => strip(tx) as WriteDocOf<"transactions">;
export const writableRec = (rec: Recurrence) => strip(rec) as WriteDocOf<"recurrences">;

export interface RecurringData {
  readonly today: string;
  readonly recurrences: readonly Recurrence[];
  readonly txs: readonly Transaction[];
  readonly accounts: readonly Account[];
  readonly categories: readonly Category[];
  readonly payees: readonly Payee[];
  readonly members: readonly Member[];
  readonly suggestions: readonly RecurringSuggestion[];
}

/** Null finché le collezioni non sono arrivate. */
export function useRecurringData(): {
  readonly data: RecurringData | null;
  readonly isError: boolean;
  readonly refetch: () => void;
} {
  const { family } = useFamily();
  const recurrences = useCollection(family.id, "recurrences");
  const txs = useAllDocs(family.id, "transactions");
  const accounts = useCollection(family.id, "accounts");
  const categories = useCollection(family.id, "categories");
  const payees = useCollection(family.id, "payees");
  const members = useCollection(family.id, "members");
  const rules = useCollection(family.id, "rules");
  const dismissals = useCollection(family.id, "recurrenceDismissals");
  const data = useMemo((): RecurringData | null => {
    if (
      !recurrences.data ||
      !txs.data ||
      !accounts.data ||
      !categories.data ||
      !payees.data ||
      !members.data ||
      !rules.data ||
      !dismissals.data
    )
      return null;
    const today = todayIso();
    return {
      today,
      recurrences: recurrences.data,
      txs: txs.data,
      accounts: accounts.data,
      categories: categories.data,
      payees: payees.data,
      members: members.data,
      suggestions: detectRecurring({
        txs: txs.data,
        recurrences: recurrences.data,
        dismissedKeys: new Set(dismissals.data.map((d) => d.id)),
        rules: rules.data,
        payees: payees.data,
        today,
      }),
    };
  }, [
    recurrences.data,
    txs.data,
    accounts.data,
    categories.data,
    payees.data,
    members.data,
    rules.data,
    dismissals.data,
  ]);
  const all = [recurrences, txs, accounts, categories, payees, members, rules, dismissals];
  return {
    data,
    isError: all.some((q) => q.isError),
    refetch: () => {
      for (const q of all) void q.refetch();
    },
  };
}
