// `/previsioni` (spec 0008, AC-13): saldo previsto mese per mese, per famiglia o per conto.
import { forecast, type ForecastCell } from "@noi2contiamo/core";
import { lazy, Suspense, useMemo, useState } from "react";
import { t } from "../../i18n/it";
import {
  Card,
  DataTable,
  EmptyState,
  ErrorState,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  type DataTableColumn,
} from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { euro, useRecurringData } from "./useRecurring";

const TrendChart = lazy(() => import("../../ui/charts/TrendChart").then((m) => ({ default: m.TrendChart })));

const FAMILY = "family";
const MONTHS = ["3", "6", "12"] as const;

interface Row {
  readonly month: string;
  readonly label: string;
  readonly cell: ForecastCell;
}

const monthLabel = (month: string): string =>
  new Date(`${month}-01T00:00:00`).toLocaleDateString("it-IT", { month: "short", year: "2-digit" });

export function ForecastPage() {
  const { data, isError, refetch } = useRecurringData();
  const [months, setMonths] = useState<(typeof MONTHS)[number]>("6");
  const [view, setView] = useState(FAMILY);

  const result = useMemo(() => {
    if (!data) return null;
    return forecast({
      accounts: data.accounts.filter((a) => a.archivedAtMs === null),
      txs: data.txs,
      recurrences: data.recurrences,
      today: data.today,
      months: Number(months),
    });
  }, [data, months]);

  if (isError) return <ErrorState description={t("rec.error.load")} onRetry={refetch} />;
  if (!data || !result) return <Skeleton lines={8} />;

  const accounts = data.accounts.filter((a) => a.archivedAtMs === null);
  if (accounts.length === 0)
    return (
      <>
        <PageHeader title={t("fc.title")} subtitle={t("fc.subtitle")} />
        <EmptyState title={t("fc.empty")} />
      </>
    );

  const rows: Row[] = result.map((m) => ({
    month: m.month,
    label: monthLabel(m.month),
    cell: view === FAMILY ? m.family : (m.byAccount[view] ?? m.family),
  }));
  const money = euro;
  const columns: DataTableColumn<Row>[] = [
    { id: "month", header: t("fc.month"), value: (r) => r.month, cell: (r) => r.label },
    {
      id: "balance",
      header: t("fc.balance"),
      align: "end",
      value: (r) => r.cell.balanceCents,
      cell: (r) => money(r.cell.balanceCents),
    },
    {
      id: "recIn",
      header: t("fc.recIn"),
      align: "end",
      value: (r) => r.cell.recurringInCents,
      cell: (r) => money(r.cell.recurringInCents),
    },
    {
      id: "recOut",
      header: t("fc.recOut"),
      align: "end",
      value: (r) => r.cell.recurringOutCents,
      cell: (r) => money(r.cell.recurringOutCents),
    },
    {
      id: "varIn",
      header: t("fc.varIn"),
      align: "end",
      value: (r) => r.cell.variableInCents,
      cell: (r) => money(r.cell.variableInCents),
    },
    {
      id: "varOut",
      header: t("fc.varOut"),
      align: "end",
      value: (r) => r.cell.variableOutCents,
      cell: (r) => money(r.cell.variableOutCents),
    },
  ];
  const first = rows[0]?.cell.balanceCents ?? 0;
  const last = rows[rows.length - 1]?.cell.balanceCents ?? 0;

  return (
    <>
      <PageHeader title={t("fc.title")} subtitle={t("fc.subtitle")} />
      <Card>
        <div className={cx(styles.form)}>
          <SegmentedControl
            label={t("fc.months")}
            value={months}
            onChange={setMonths}
            options={MONTHS.map((m) => ({ id: m, label: m }))}
          />
          <Select
            label={t("fc.view")}
            options={[
              { id: FAMILY, label: t("fc.family") },
              ...accounts.map((a) => ({ id: a.id, label: a.name })),
            ]}
            value={view}
            onChange={(key) => {
              setView(key === null ? FAMILY : String(key));
            }}
          />
        </div>
      </Card>
      <Card>
        <Suspense fallback={<Skeleton lines={6} />}>
          <TrendChart
            title={t("fc.chartTitle")}
            summary={t("fc.chartSummary", { from: money(first), to: money(last), n: months })}
            series={[{ key: "saldo", label: t("fc.series") }]}
            data={rows.map((r) => ({ mese: r.label, saldo: r.cell.balanceCents }))}
            categoryKey="mese"
            categoryLabel={t("fc.month")}
            formatValue={money}
          />
        </Suspense>
      </Card>
      <Card>
        <DataTable caption={t("fc.table")} columns={columns} rows={rows} getRowId={(r) => r.month} />
      </Card>
    </>
  );
}
