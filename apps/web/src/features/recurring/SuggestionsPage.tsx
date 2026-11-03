// `/ricorrenti/suggerimenti` (spec 0008, AC-12): pagamenti ricorrenti trovati nello storico.
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton, useToast } from "../../ui";
import { cx } from "../../ui/cx";
import list from "../catalog/catalog.module.css";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import { frequencyLabel } from "./recurringForm";
import { euro, useRecurringData } from "./useRecurring";

const dateLabel = (iso: string): string => new Date(`${iso}T00:00:00`).toLocaleDateString("it-IT");

export function SuggestionsPage() {
  const { family, memberId } = useFamily();
  const adapter = useAdapter();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, isError, refetch } = useRecurringData();

  const dismiss = useMutation({
    mutationFn: async (key: string) => {
      unwrap(
        await adapter.put(family.id, "recurrenceDismissals", {
          id: key,
          dismissedAtMs: Date.now(),
          dismissedByMemberId: memberId,
        }),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "recurrenceDismissals") });
      toast.show({ message: t("rec.sugg.dismissed") });
    },
  });

  if (isError) return <ErrorState description={t("rec.error.load")} onRetry={refetch} />;
  if (!data) return <Skeleton lines={6} />;

  return (
    <>
      <PageHeader title={t("rec.sugg.title")} subtitle={t("rec.sugg.subtitle")} />
      <div className={cx(styles.actions)}>
        <Button variant="secondary" onPress={() => void navigate("/ricorrenti")}>
          {t("rec.sugg.back")}
        </Button>
      </div>
      <Card>
        {data.suggestions.length === 0 ? (
          <EmptyState title={t("rec.sugg.empty")} />
        ) : (
          <ul className={cx(list.list)} aria-label={t("rec.sugg.title")}>
            {data.suggestions.map((s) => (
              <li key={s.key} className={cx(list.row)}>
                <span className={cx(list.who)}>
                  <span className={cx(list.name)}>{s.name}</span>
                  <span className={cx(list.meta)}>
                    {frequencyLabel(s.frequency)} · {euro(s.expectedAmountCents)}
                    {s.fromRule ? ` · ${t("rec.sugg.rule")}` : ""}
                  </span>
                  <span className={cx(list.meta)}>
                    {t("rec.sugg.count", {
                      n: String(s.transactionIds.length),
                      from: dateLabel(s.dates[0] ?? s.startDate),
                      to: dateLabel(s.dates[s.dates.length - 1] ?? s.startDate),
                    })}
                  </span>
                </span>
                <div className={cx(list.end)}>
                  <Button
                    size="sm"
                    aria-label={`${t("rec.sugg.accept")}: ${s.name}`}
                    onPress={() => void navigate(`/ricorrenti/nuova?suggerimento=${s.key}`)}
                  >
                    {t("rec.sugg.accept")}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`${t("rec.sugg.dismiss")}: ${s.name}`}
                    isDisabled={dismiss.isPending}
                    onPress={() => {
                      dismiss.mutate(s.key);
                    }}
                  >
                    {t("rec.sugg.dismiss")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {dismiss.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {t("rec.error.action")}
          </p>
        ) : null}
      </Card>
    </>
  );
}
