// Le letture che servono al motore delle regole (spec 0007): regole in ordine e contesto della famiglia.
import {
  sortRules,
  type Account,
  type Category,
  type Member,
  type Payee,
  type Rule,
  type RuleContext,
} from "@noi2contiamo/core";
import { useMemo } from "react";
import { useCollection } from "../../data/queries";
import { useFamily } from "../guards";

export interface RuleEngine {
  /** Tutte le regole, in ordine di priorità. */
  readonly rules: readonly Rule[];
  readonly ctx: RuleContext;
  readonly categories: readonly Category[];
  readonly payees: readonly Payee[];
  readonly accounts: readonly Account[];
  readonly members: readonly Member[];
}

/** Null finché le collezioni non sono arrivate. */
export function useRuleEngine(): {
  readonly engine: RuleEngine | null;
  readonly isError: boolean;
  readonly refetch: () => void;
} {
  const { family } = useFamily();
  const rules = useCollection(family.id, "rules");
  const categories = useCollection(family.id, "categories");
  const payees = useCollection(family.id, "payees");
  const accounts = useCollection(family.id, "accounts");
  const members = useCollection(family.id, "members");
  const engine = useMemo((): RuleEngine | null => {
    if (!rules.data || !categories.data || !payees.data || !accounts.data || !members.data) return null;
    return {
      categories: categories.data,
      payees: payees.data,
      accounts: accounts.data,
      members: members.data,
      rules: sortRules(rules.data),
      ctx: {
        family,
        categories: categories.data,
        payees: payees.data,
        accounts: accounts.data,
        activeMemberIds: new Set(members.data.filter((m) => m.leftAtMs === null).map((m) => m.id)),
      },
    };
  }, [rules.data, categories.data, payees.data, accounts.data, members.data, family]);
  const all = [rules, categories, payees, accounts, members];
  return {
    engine,
    isError: all.some((q) => q.isError),
    refetch: () => {
      for (const q of all) void q.refetch();
    },
  };
}
