// Editor della divisione tra i membri (spec 0004): percentuale o importo, scorciatoie, anteprima al centesimo.
// Lo usano il modulo del movimento, la categoria e la divisione della famiglia.
import {
  bpToCents,
  centsToBp,
  equalSplit,
  FULL_BP,
  memberAmounts,
  soloSplit,
  type BasisPoints,
  type Cents,
  type Member,
  type TransactionSplit,
} from "@noi2contiamo/core";
import { useState } from "react";
import { t } from "../../i18n/it";
import { Button, formatBasisPoints, formatCents, MoneyField, PercentField, SegmentedControl } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import type { SplitDraft } from "../transactions/newTransaction";

export type { SplitDraft };

/** I membri da mostrare: gli attivi, più gli usciti che hanno già una quota. */
export function splitMembers(
  members: readonly Member[],
  shares: Readonly<Record<string, unknown>>,
): Member[] {
  return members.filter((m) => m.leftAtMs === null || shares[m.id] !== undefined);
}

export const memberLabel = (m: Pick<Member, "displayName" | "leftAtMs">) =>
  m.leftAtMs === null ? m.displayName : t("split.left", { name: m.displayName });

/** Riga di anteprima: "Anna 60,01 € · Bruno 40,00 €" (solo le quote > 0). */
export function amountsText(
  amountCents: number,
  split: { readonly kind: "bp" | "cents"; readonly shares: Readonly<Record<string, number>> },
  nameOf: (id: string) => string,
): string {
  const amounts = memberAmounts(amountCents, { ...split, source: "manual" });
  return Object.entries(amounts)
    .filter(([id]) => (split.shares[id] ?? 0) > 0)
    .sort(([a], [b]) => nameOf(a).localeCompare(nameOf(b), "it"))
    .map(([id, cents]) => `${nameOf(id)} ${formatCents(cents as Cents)}`)
    .join(" · ");
}

/** La divisione di un movimento nel registro (AC-9): importi per membro, più "a mano" se manuale. */
export function splitText(
  tx: { readonly amountCents: number; readonly split: TransactionSplit | null },
  nameOf: (id: string) => string,
): string {
  if (!tx.split) return "";
  const text = amountsText(tx.amountCents, tx.split, nameOf);
  return tx.split.source === "manual" ? `${text} (${t("split.manualTag")})` : text;
}

/** Stato della somma: quanto manca o avanza (in % o in euro), null se torna. */
export function remainderText(value: SplitDraft, amountCents: number | null): string | null {
  const total = Object.values(value.shares).reduce<number>((sum, v) => sum + (v ?? 0), 0);
  const expected = value.kind === "bp" ? FULL_BP : (amountCents ?? 0);
  const diff = total - expected;
  if (diff === 0) return null;
  const shown =
    value.kind === "bp"
      ? formatBasisPoints(Math.abs(diff) as BasisPoints)
      : formatCents(Math.abs(diff) as Cents);
  return t(diff < 0 ? "split.missing" : "split.extra", { value: shown });
}

export function SplitEditor({
  members,
  value,
  onChange,
  amountCents = null,
  allowCents = false,
}: {
  readonly members: readonly Member[];
  readonly value: SplitDraft;
  readonly onChange: (next: SplitDraft) => void;
  /** Importo del movimento: abilita l'anteprima in euro e la modalità "Importo". */
  readonly amountCents?: number | null;
  readonly allowCents?: boolean;
}) {
  // I campi tengono il loro testo: dopo una scorciatoia o un cambio di modalità si ridisegnano.
  const [revision, setRevision] = useState(0);
  const shown = splitMembers(members, value.shares);
  const active = members.filter((m) => m.leftAtMs === null);
  const nameOf = (id: string) => {
    const m = members.find((x) => x.id === id);
    return m ? m.displayName : id;
  };

  const replace = (next: SplitDraft) => {
    onChange(next);
    setRevision((r) => r + 1);
  };
  const preset = (shares: Readonly<Record<string, number>>) => {
    const withRows = Object.fromEntries(shown.map((m) => [m.id, shares[m.id] ?? 0]));
    replace(
      value.kind === "cents" && amountCents !== null && amountCents > 0
        ? { kind: "cents", shares: bpToCents(amountCents, withRows) }
        : { kind: "bp", shares: withRows },
    );
  };
  const setMode = (kind: "bp" | "cents") => {
    if (kind === value.kind) return;
    replace({
      kind,
      shares: kind === "cents" ? bpToCents(amountCents ?? 0, value.shares) : centsToBp(value.shares),
    });
  };

  const remainder = remainderText(value, amountCents);
  const complete = remainder === null && Object.values(value.shares).some((v) => (v ?? 0) > 0);
  const clean = Object.fromEntries(
    Object.entries(value.shares).map(([id, v]) => [id, v ?? 0] as const),
  ) as Record<string, number>;

  return (
    <div className={cx(styles.stack)}>
      {allowCents ? (
        <SegmentedControl<"bp" | "cents">
          label={t("split.mode")}
          value={value.kind}
          onChange={setMode}
          options={[
            { id: "bp", label: t("split.mode.bp") },
            { id: "cents", label: t("split.mode.cents") },
          ]}
        />
      ) : null}
      <div className={cx(styles.actions)} role="group" aria-label={t("split.presets")}>
        {active.length > 1 ? (
          <Button
            size="sm"
            variant="secondary"
            onPress={() => {
              preset(equalSplit(active.map((m) => m.id)).shares);
            }}
          >
            {t(active.length === 2 ? "split.equal" : "split.equalMany")}
          </Button>
        ) : null}
        {active.map((m) => (
          <Button
            key={m.id}
            size="sm"
            variant="secondary"
            onPress={() => {
              preset(soloSplit(m.id).shares);
            }}
          >
            {t("split.solo", { name: m.displayName })}
          </Button>
        ))}
      </div>
      {shown.map((m) => {
        const label = t("split.share", { name: memberLabel(m) });
        const current = value.shares[m.id] ?? null;
        const set = (next: number | null) => {
          onChange({ ...value, shares: { ...value.shares, [m.id]: next } });
        };
        return value.kind === "bp" ? (
          <PercentField
            key={`${m.id}-bp-${String(revision)}`}
            label={label}
            value={current as BasisPoints | null}
            onChange={set}
          />
        ) : (
          <MoneyField
            key={`${m.id}-cents-${String(revision)}`}
            label={label}
            value={current as Cents | null}
            onChange={set}
          />
        );
      })}
      <p aria-live="polite" className={cx(remainder ? styles.error : styles.muted)}>
        {remainder ??
          (complete && amountCents !== null && amountCents > 0
            ? amountsText(amountCents, { kind: value.kind, shares: clean }, nameOf)
            : t("split.complete"))}
      </p>
    </div>
  );
}
