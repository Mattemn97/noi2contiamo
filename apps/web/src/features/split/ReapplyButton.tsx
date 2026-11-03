// "Riapplica ai movimenti" (spec 0004, AC-6): conta i movimenti che cambiano, chiede conferma, scrive a blocchi.
import { reapplySplits, type Transaction } from "@noi2contiamo/core";
import { chunkOps, type CommitOp, type Cursor, type DataAdapter } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import { Button, ConfirmDialog, useToast } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { withoutAudit } from "../transactions/newTransaction";

async function allDocs<C extends "transactions" | "categories" | "accounts">(
  adapter: DataAdapter,
  familyId: string,
  collection: C,
) {
  const docs = [];
  let after: Cursor | undefined;
  do {
    const page = unwrap(await adapter.list(familyId, collection, after ? { after } : {}));
    docs.push(...page.docs);
    after = page.next ?? undefined;
  } while (after);
  return docs;
}

/** I movimenti da riscrivere, letti freschi (famiglia, categorie e conti appena salvati). */
export async function pendingReapply(
  adapter: DataAdapter,
  familyId: string,
  categoryId?: string,
): Promise<Transaction[]> {
  const families = unwrap(await adapter.membership.myFamilies());
  const family = families.find((f) => f.family.id === familyId)?.family;
  if (!family) return [];
  const [transactions, categories, accounts] = await Promise.all([
    allDocs(adapter, familyId, "transactions"),
    allDocs(adapter, familyId, "categories"),
    allDocs(adapter, familyId, "accounts"),
  ]);
  return reapplySplits(transactions, {
    family,
    categories,
    accounts,
    ...(categoryId !== undefined ? { categoryId } : {}),
  });
}

export function ReapplyButton({
  familyId,
  categoryId,
}: {
  readonly familyId: string;
  readonly categoryId?: string;
}) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const toast = useToast();
  const [pending, setPending] = useState<Transaction[] | null>(null);

  const prepare = useMutation({
    mutationFn: () => pendingReapply(adapter, familyId, categoryId),
    onSuccess: (txs) => {
      if (txs.length === 0) toast.show({ message: t("split.reapply.none") });
      else setPending(txs);
    },
  });
  const apply = useMutation({
    mutationFn: async (txs: readonly Transaction[]) => {
      const ops: CommitOp[] = txs.map((tx) => ({
        type: "put",
        collection: "transactions",
        doc: withoutAudit(tx),
      }));
      for (const chunk of chunkOps(ops)) unwrap(await adapter.commit(familyId, chunk));
      return txs.length;
    },
    onSuccess: async (count) => {
      toast.show({ message: t("split.reapply.done", { count: String(count) }) });
      await client.invalidateQueries({ queryKey: keys.collection(familyId, "transactions") });
    },
  });

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        isPending={prepare.isPending || apply.isPending}
        onPress={() => {
          prepare.mutate();
        }}
      >
        {t("split.reapply")}
      </Button>
      {prepare.isError || apply.isError ? (
        <p role="alert" className={cx(styles.error)}>
          {t("split.reapply.error")}
        </p>
      ) : null}
      <ConfirmDialog
        title={t("split.reapply.title")}
        message={t("split.reapply.body", { count: String(pending?.length ?? 0) })}
        confirmLabel={t("split.reapply.confirm")}
        isOpen={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
        onConfirm={() => {
          if (pending) apply.mutate(pending);
          setPending(null);
        }}
      />
    </>
  );
}
