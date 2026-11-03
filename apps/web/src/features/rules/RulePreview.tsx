// Anteprima dal vivo della regola nell'editor (spec 0007, AC-11): ultimi 12 mesi, prime 50 righe.
import {
  previewRule,
  type Cents,
  type ChangedField,
  type RuleField,
  type RuleLike,
} from "@noi2contiamo/core";
import { useMemo } from "react";
import { useTransactionsInRange } from "../../data/queries";
import { t, type MessageKey } from "../../i18n/it";
import { DataTable, ErrorState, formatCents, Skeleton, type DataTableColumn } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { useFamily } from "../guards";
import type { RuleEngine } from "./useRules";

const ROWS = 50;
const FIELD_KEYS: Readonly<Record<ChangedField, MessageKey>> = {
  category: "rules.field.category",
  payee: "rules.field.payee",
  split: "rules.field.split",
  transfer: "rules.field.transfer",
  recurring: "rules.field.recurring",
};

export const fieldsText = (fields: readonly ChangedField[]) => fields.map((f) => t(FIELD_KEYS[f])).join(", ");

/** Gli ultimi 12 mesi fino a oggi, nel fuso del dispositivo. */
export function lastYearRange(now: Date = new Date()): { from: string; to: string } {
  const iso = (d: Date) =>
    `${String(d.getFullYear())}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const from = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate());
  return { from: iso(from), to: iso(now) };
}

interface Row {
  readonly id: string;
  readonly date: string;
  readonly description: string;
  readonly amount: string;
  readonly effect: string;
}

export function RulePreview({
  rule,
  engine,
}: {
  readonly rule: RuleLike | null;
  readonly engine: RuleEngine;
}) {
  const { family } = useFamily();
  const range = useMemo(() => lastYearRange(), []);
  const txs = useTransactionsInRange(family.id, range);
  const items = useMemo(
    () => (rule && txs.data ? previewRule(rule, txs.data, engine.ctx) : null),
    [rule, txs.data, engine.ctx],
  );
  if (txs.isPending) return <Skeleton lines={3} />;
  if (txs.isError) return <ErrorState onRetry={() => void txs.refetch()} />;
  if (!rule || !items) return <p className={cx(styles.muted)}>{t("rules.previewInvalid")}</p>;
  if (items.length === 0) return <p aria-live="polite">{t("rules.previewNone")}</p>;
  const changed = items.filter((i) => i.after !== null).length;
  const kept = (fields: readonly RuleField[]) =>
    fields.length > 0 ? `${fields.map((f) => t(FIELD_KEYS[f])).join(", ")}: ${t("rules.effect.manual")}` : "";
  const rows: Row[] = items.slice(0, ROWS).map((i) => ({
    id: i.tx.id,
    date: i.tx.date,
    description: i.tx.description || "—",
    amount: formatCents(i.tx.amountCents as Cents),
    effect:
      [i.fields.length > 0 ? fieldsText(i.fields) : "", kept(i.keptManual)].filter(Boolean).join(" · ") ||
      t("rules.effect.none"),
  }));
  const columns: DataTableColumn<Row>[] = [
    { id: "date", header: t("rules.col.date"), value: (r) => r.date },
    { id: "description", header: t("rules.col.description"), value: (r) => r.description },
    { id: "amount", header: t("rules.col.amount"), value: (r) => r.amount, align: "end", sortable: false },
    { id: "effect", header: t("rules.col.effect"), value: (r) => r.effect },
  ];
  return (
    <div className={cx(styles.stack)}>
      <p aria-live="polite">
        {t("rules.previewCount", { count: String(items.length), changed: String(changed) })}
      </p>
      <DataTable
        caption={t("rules.preview")}
        hideCaption
        columns={columns}
        rows={rows}
        getRowId={(r) => r.id}
      />
    </div>
  );
}
