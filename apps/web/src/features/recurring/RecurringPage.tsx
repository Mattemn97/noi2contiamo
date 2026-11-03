// `/ricorrenti` (spec 0008, AC-11, AC-5): serie attive, scadenze in arrivo con stato e azioni.
import {
  linkCandidates,
  linkTransaction,
  newId,
  nextDue,
  occurrenceStatuses,
  paymentFromOccurrence,
  shiftDays,
  unlinkTransaction,
  type Occurrence,
  type Recurrence,
  type Transaction,
} from "@noi2contiamo/core";
import type { CommitOp } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import { Button, Card, Dialog, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from "../../ui";
import type { Status } from "../../ui";
import { cx } from "../../ui/cx";
import list from "../catalog/catalog.module.css";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import { frequencyLabel } from "./recurringForm";
import { euro, useRecurringData, writableRec, writableTx, type RecurringData } from "./useRecurring";

const BADGE: Record<Occurrence["status"], Status> = {
  paid: "good",
  skipped: "warning",
  missed: "serious",
  upcoming: "warning",
};

export const amountLabel = (rec: Recurrence): string => {
  const amount = euro(rec.expectedAmountCents);
  return rec.amountToleranceBp === 0 ? amount : t("rec.approx", { amount });
};

const dateLabel = (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT");

export function RecurringPage() {
  const { family } = useFamily();
  const adapter = useAdapter();
  const client = useQueryClient();
  const navigate = useNavigate();
  const { data, isError, refetch } = useRecurringData();
  const [linking, setLinking] = useState<{ rec: Recurrence; date: string } | null>(null);

  const commit = useMutation({
    mutationFn: async (ops: CommitOp[]) => {
      unwrap(await adapter.commit(family.id, ops));
    },
    onSuccess: async () => {
      setLinking(null);
      await client.invalidateQueries({ queryKey: keys.family(family.id) });
    },
  });

  if (isError) return <ErrorState description={t("rec.error.load")} onRetry={refetch} />;
  if (!data) return <Skeleton lines={6} />;

  const active = data.recurrences.filter((r) => r.archivedAtMs === null);
  const from = shiftDays(data.today, -60);
  const to = shiftDays(data.today, 30);
  const rows = active
    .flatMap((rec) =>
      occurrenceStatuses(rec, data.txs, from, to, data.today)
        .filter((o) => o.date >= data.today || o.status === "missed" || o.status === "upcoming")
        .map((o) => ({ rec, o })),
    )
    .sort((a, b) => a.o.date.localeCompare(b.o.date) || a.rec.name.localeCompare(b.rec.name, "it"));

  const txById = new Map(data.txs.map((tx) => [tx.id, tx]));
  const putTx = (tx: Transaction) =>
    ({ type: "put", collection: "transactions", doc: writableTx(tx) }) as const;
  const putRec = (rec: Recurrence, skippedDates: string[]) =>
    ({ type: "put", collection: "recurrences", doc: writableRec({ ...rec, skippedDates }) }) as const;

  const pay = (rec: Recurrence, date: string) => {
    const result = paymentFromOccurrence(rec, date, newId(), {
      family,
      categories: data.categories,
      accounts: data.accounts,
    });
    if (result.ok) commit.mutate([{ type: "put", collection: "transactions", doc: result.value }]);
  };

  const actionsOf = (rec: Recurrence, o: Occurrence) => {
    const label = (action: string) =>
      t("rec.actionLabel", { action, name: rec.name, date: dateLabel(o.date) });
    const btn = (action: string, onPress: () => void) => (
      <Button
        size="sm"
        variant="secondary"
        aria-label={label(action)}
        isDisabled={commit.isPending}
        onPress={onPress}
      >
        {action}
      </Button>
    );
    const paidTx = o.transactionId ? txById.get(o.transactionId) : undefined;
    if (o.status === "paid" && paidTx) {
      return o.match === "auto"
        ? btn(t("rec.confirm"), () => {
            commit.mutate([putTx(linkTransaction(paidTx, rec.id, o.date))]);
          })
        : btn(t("rec.unlink"), () => {
            commit.mutate([putTx(unlinkTransaction(paidTx))]);
          });
    }
    if (o.status === "skipped")
      return btn(t("rec.unskip"), () => {
        commit.mutate([
          putRec(
            rec,
            rec.skippedDates.filter((d) => d !== o.date),
          ),
        ]);
      });
    return (
      <>
        {btn(t("rec.link"), () => {
          setLinking({ rec, date: o.date });
        })}
        {btn(t("rec.pay"), () => {
          pay(rec, o.date);
        })}
        {btn(t("rec.skip"), () => {
          commit.mutate([putRec(rec, [...rec.skippedDates, o.date].sort())]);
        })}
      </>
    );
  };

  return (
    <>
      <PageHeader title={t("rec.title")} subtitle={t("rec.subtitle")} />
      <div className={cx(styles.actions)}>
        <Button onPress={() => void navigate("/ricorrenti/nuova")}>{t("rec.add")}</Button>
        <Button variant="secondary" onPress={() => void navigate("/ricorrenti/suggerimenti")}>
          {t("rec.suggestions")}
          {data.suggestions.length > 0 ? ` (${String(data.suggestions.length)})` : ""}
        </Button>
        <Button variant="secondary" onPress={() => void navigate("/previsioni")}>
          {t("rec.forecast")}
        </Button>
      </div>
      <Card title={t("rec.upcoming")} as="section">
        {rows.length === 0 ? (
          <EmptyState title={t("rec.upcomingEmpty")} />
        ) : (
          <ul className={cx(list.list)} aria-label={t("rec.upcoming")}>
            {rows.map(({ rec, o }) => (
              <li key={`${rec.id}-${o.date}`} className={cx(list.row)}>
                <span className={cx(list.who)}>
                  <span className={cx(list.name)}>
                    {rec.name}
                    <StatusBadge status={BADGE[o.status]} label={t(`rec.status.${o.status}`)} />
                  </span>
                  <span className={cx(list.meta)}>
                    {dateLabel(o.date)} · {euro(o.amountCents)}
                    {o.match === "auto" ? ` · ${t("rec.matchAuto")}` : ""}
                  </span>
                </span>
                <div className={cx(list.end)}>{actionsOf(rec, o)}</div>
              </li>
            ))}
          </ul>
        )}
        {commit.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {t("rec.error.action")}
          </p>
        ) : null}
      </Card>
      <Card title={t("rec.active")} as="section">
        {active.length === 0 ? (
          <EmptyState title={t("rec.empty")} />
        ) : (
          <ul className={cx(list.list)} aria-label={t("rec.active")}>
            {active.map((rec) => (
              <SeriesRow
                key={rec.id}
                rec={rec}
                data={data}
                onEdit={() => void navigate(`/ricorrenti/${rec.id}`)}
              />
            ))}
          </ul>
        )}
      </Card>
      <Dialog
        title={t("rec.linkTitle")}
        isOpen={linking !== null}
        onOpenChange={(open) => {
          if (!open) setLinking(null);
        }}
      >
        {linking ? (
          <LinkChoices
            candidates={linkCandidates(linking.rec, linking.date, data.txs)}
            onPick={(tx) => {
              commit.mutate([putTx(linkTransaction(tx, linking.rec.id, linking.date))]);
            }}
          />
        ) : null}
      </Dialog>
    </>
  );
}

function LinkChoices({
  candidates,
  onPick,
}: {
  readonly candidates: readonly Transaction[];
  readonly onPick: (tx: Transaction) => void;
}) {
  if (candidates.length === 0) return <p className={cx(styles.muted)}>{t("rec.linkNone")}</p>;
  return (
    <ul className={cx(list.list)}>
      {candidates.slice(0, 12).map((tx) => (
        <li key={tx.id} className={cx(list.row)}>
          <span className={cx(list.who)}>
            <span className={cx(list.name)}>{tx.description || euro(tx.amountCents)}</span>
            <span className={cx(list.meta)}>
              {dateLabel(tx.date)} · {euro(tx.amountCents)}
            </span>
          </span>
          <Button
            size="sm"
            variant="secondary"
            aria-label={`${t("rec.link")}: ${tx.description} ${dateLabel(tx.date)}`}
            onPress={() => {
              onPick(tx);
            }}
          >
            {t("rec.link")}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function SeriesRow({
  rec,
  data,
  onEdit,
}: {
  readonly rec: Recurrence;
  readonly data: RecurringData;
  readonly onEdit: () => void;
}) {
  const next = nextDue(rec, data.txs, data.today);
  const last = occurrenceStatuses(rec, data.txs, rec.startDate, data.today, data.today).at(-1);
  return (
    <li className={cx(list.row)}>
      <span className={cx(list.who)}>
        <span className={cx(list.name)}>{rec.name}</span>
        <span className={cx(list.meta)}>
          {frequencyLabel(rec.frequency)} · {amountLabel(rec)} ·{" "}
          {next ? t("rec.next", { date: dateLabel(next.date) }) : t("rec.ended")}
          {last ? ` · ${t("rec.last", { status: t(`rec.status.${last.status}`) })}` : ""}
        </span>
      </span>
      <div className={cx(list.end)}>
        <Button size="sm" variant="secondary" aria-label={`${t("rec.edit")}: ${rec.name}`} onPress={onEdit}>
          {t("rec.edit")}
        </Button>
      </div>
    </li>
  );
}
