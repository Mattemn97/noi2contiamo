// "Applica ai movimenti esistenti" (spec 0007, AC-10): calcola i cambi con core, mostra l'anteprima,
// chiede conferma e scrive a blocchi di 500. I campi modificati a mano restano.
import {
  planApplyRules,
  type Cents,
  type RuleChange,
  type RuleLike,
  type Transaction,
} from "@noi2contiamo/core";
import { chunkOps, type CommitOp, type Cursor } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import { Button, Dialog, formatCents, useToast } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { useFamily } from "../guards";
import { withoutAudit } from "../transactions/newTransaction";
import type { RuleEngine } from "./useRules";
import { fieldsText } from "./RulePreview";

const SHOWN = 20;

export function ApplyRulesButton({
  engine,
  rules,
  label,
  isDisabled = false,
}: {
  readonly engine: RuleEngine;
  readonly rules: readonly RuleLike[];
  readonly label: string;
  readonly isDisabled?: boolean;
}) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const toast = useToast();
  const { family } = useFamily();
  const [pending, setPending] = useState<RuleChange[] | null>(null);

  const prepare = useMutation({
    mutationFn: async () => {
      const docs: Transaction[] = [];
      let after: Cursor | undefined;
      do {
        const page = unwrap(await adapter.list(family.id, "transactions", after ? { after } : {}));
        docs.push(...page.docs);
        after = page.next ?? undefined;
      } while (after);
      return planApplyRules(docs, rules, engine.ctx);
    },
    onSuccess: (changes) => {
      if (changes.length === 0) toast.show({ message: t("rules.apply.none") });
      else setPending(changes);
    },
  });
  const apply = useMutation({
    mutationFn: async (changes: readonly RuleChange[]) => {
      const ops: CommitOp[] = changes.map((c) => ({
        type: "put",
        collection: "transactions",
        doc: withoutAudit(c.after),
      }));
      for (const chunk of chunkOps(ops)) unwrap(await adapter.commit(family.id, chunk));
      return changes.length;
    },
    onSuccess: async (count) => {
      setPending(null);
      toast.show({ message: t("rules.apply.done", { count: String(count) }) });
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "transactions") });
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        isDisabled={isDisabled}
        isPending={prepare.isPending}
        onPress={() => {
          prepare.mutate();
        }}
      >
        {label}
      </Button>
      {prepare.isError || apply.isError ? (
        <p role="alert" className={cx(styles.error)}>
          {t("rules.apply.error")}
        </p>
      ) : null}
      <Dialog
        title={t("rules.apply.title")}
        isOpen={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <div className={cx(styles.stack)}>
          <p>{t("rules.apply.body", { count: String(pending?.length ?? 0) })}</p>
          <ul className={cx(styles.stack)}>
            {(pending ?? []).slice(0, SHOWN).map((c) => (
              <li key={c.before.id}>
                {c.before.date} · {c.before.description || "—"} · {formatCents(c.before.amountCents as Cents)}{" "}
                → {fieldsText(c.fields)}
              </li>
            ))}
          </ul>
          {(pending?.length ?? 0) > SHOWN ? (
            <p className={cx(styles.muted)}>
              {t("rules.apply.more", { count: String((pending?.length ?? 0) - SHOWN) })}
            </p>
          ) : null}
          <div className={cx(styles.actions)}>
            <Button
              isPending={apply.isPending}
              onPress={() => {
                if (pending) apply.mutate(pending);
              }}
            >
              {t("rules.apply.confirm")}
            </Button>
            <Button
              variant="ghost"
              onPress={() => {
                setPending(null);
              }}
            >
              {t("common.cancel")}
            </Button>
          </div>
        </div>
      </Dialog>
    </>
  );
}
