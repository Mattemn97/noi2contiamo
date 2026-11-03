// Dashboard di coppia, area personale e confronto tra periodi (feature 14-16). I numeri vengono tutti da
// `core/dashboard`; qui si leggono i dati, si sceglie il periodo e si disegna. Recharts resta in blocchi lazy.
import {
  addDays,
  buildReport,
  cents,
  comparePeriods,
  comparisonPeriod,
  byCategory,
  contributions,
  dashboardEntries,
  entriesInRange,
  kpis,
  memberBalances,
  periodAround,
  trend,
  type BasisPoints,
  type CompareGranularity,
  type CompareMode,
  type DashboardView,
  type Delta,
} from "@noi2contiamo/core";
import { getLocalTimeZone, today } from "@internationalized/date";
import { lazy, Suspense, useState } from "react";
import { useNavigate } from "react-router";
import { downloadBytes } from "./reportPdf";
import { useAllDocs, useCollection } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Button,
  Card,
  DataTable,
  ErrorState,
  formatBasisPoints,
  formatCents,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  StatTile,
  type DataTableColumn,
} from "../../ui";
import { cx } from "../../ui/cx";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import local from "./dashboard.module.css";

const TrendChart = lazy(() => import("../../ui/charts/TrendChart").then((m) => ({ default: m.TrendChart })));
const BarList = lazy(() => import("../../ui/charts/BarList").then((m) => ({ default: m.BarList })));
const StackedBar = lazy(() => import("../../ui/charts/StackedBar").then((m) => ({ default: m.StackedBar })));
const CompareChart = lazy(() =>
  import("../../ui/charts/CompareChart").then((m) => ({ default: m.CompareChart })),
);

const GRANULARITIES: readonly CompareGranularity[] = ["week", "month", "year"];
const money = (value: number): string => formatCents(cents(value));
const signed = (value: number): string => formatCents(cents(value), "always");
const cap = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

const utc = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
const fmt = (opts: Intl.DateTimeFormatOptions, iso: string): string =>
  new Intl.DateTimeFormat("it-IT", { ...opts, timeZone: "UTC" }).format(utc(iso));

/** Nome del periodo: "Novembre 2026", "2026", "Settimana dal 2 nov". */
function periodLabel(g: CompareGranularity, from: string): string {
  if (g === "year") return from.slice(0, 4);
  if (g === "month") return cap(fmt({ month: "long", year: "numeric" }, from));
  return t("dash.week", { date: fmt({ day: "numeric", month: "short" }, from) });
}

/** "+12,5%" oppure "n.d. (base zero)". */
export function pctText(d: Delta): string {
  if (d.pctBp === null) return t("dash.noBase");
  return (d.pctBp > 0 ? "+" : "") + formatBasisPoints(d.pctBp as BasisPoints);
}

interface DashboardPageProps {
  readonly initialView: "family" | "personal";
}

export function DashboardPage({ initialView }: DashboardPageProps) {
  const { family, memberId } = useFamily();
  const navigate = useNavigate();
  const transactions = useAllDocs(family.id, "transactions");
  const accounts = useCollection(family.id, "accounts");
  const members = useCollection(family.id, "members");
  const categories = useCollection(family.id, "categories");
  const [kind, setKind] = useState<"family" | "personal">(initialView);
  const [g, setG] = useState<CompareGranularity>("month");
  const [anchor, setAnchor] = useState<string>(() => today(getLocalTimeZone()).toString());
  const [mode, setMode] = useState<CompareMode>("previous");
  const [pdfState, setPdfState] = useState<"idle" | "busy" | "error">("idle");

  if (transactions.isPending || accounts.isPending || members.isPending || categories.isPending)
    return <Skeleton lines={8} />;
  if (transactions.isError || accounts.isError || members.isError || categories.isError)
    return (
      <ErrorState
        description={t("dash.error")}
        onRetry={() =>
          void Promise.all([
            transactions.refetch(),
            accounts.refetch(),
            members.refetch(),
            categories.refetch(),
          ])
        }
      />
    );

  const view: DashboardView = kind === "family" ? { kind: "family" } : { kind: "personal", memberId };
  const nameOfMember = (id: string | null): string =>
    id === null ? t("dash.common") : (members.data.find((m) => m.id === id)?.displayName ?? id);
  const nameOfCategory = (id: string | null): string =>
    id === null ? t("dash.noCategory") : (categories.data.find((c) => c.id === id)?.name ?? id);

  const all = dashboardEntries(transactions.data, { view, accounts: accounts.data });
  const period = periodAround(g, anchor);
  const label = periodLabel(g, period.from);
  const entries = entriesInRange(all, period);
  const k = kpis(entries);
  const points = trend(entries, g === "year" ? "month" : "week", period);
  const cats = byCategory(entries);
  const paid = contributions(entries);
  const against = comparisonPeriod(g, period, mode);
  const againstLabel = periodLabel(g, against.from);
  const cmp = comparePeriods(all, period, against);
  const shift = (direction: -1 | 1): void => {
    setAnchor(direction < 0 ? addDays(period.from, -1) : addDays(period.to, 1));
  };
  const bucketLabel = (start: string): string =>
    g === "year" ? cap(fmt({ month: "short" }, start)) : fmt({ day: "numeric", month: "short" }, start);

  const active = members.data.filter((m) => m.leftAtMs === null).sort((a, b) => a.joinedAtMs - b.joinedAtMs);
  // Colori stabili: i membri in ordine di ingresso, la cassa comune in fondo.
  const paidOrdered = [...active.map((m) => m.id), null].flatMap((id) =>
    paid.filter((p) => p.memberId === id),
  );
  const balances =
    kind === "family"
      ? memberBalances(transactions.data, {
          accounts: accounts.data,
          family,
          memberIds: active.map((m) => m.id),
          range: period,
        })
      : null;

  const downloadPdf = (): void => {
    setPdfState("busy");
    const data = buildReport(
      transactions.data,
      { view, accounts: accounts.data, family, memberIds: active.map((m) => m.id) },
      g,
      anchor,
    );
    void import("./reportPdf")
      .then(({ buildReportPdf }) =>
        buildReportPdf(
          data,
          {
            title: t("report.title", { period: label }),
            subtitle: kind === "family" ? family.name : t("dash.subtitlePersonal"),
            period: label,
            generated: t("report.generated", { date: new Date().toLocaleDateString("it-IT") }),
            kpis: t("report.kpis"),
            income: t("dash.income"),
            expense: t("dash.expense"),
            savings: t("dash.savings"),
            rate: t("dash.rate"),
            noRate: t("report.noRate"),
            categories: t("report.categories"),
            noData: t("report.noData"),
            others: t("report.others"),
            paid: t("report.paid"),
            balance: t("report.balance"),
            balanceNote: t("report.balanceNote"),
            colMember: t("report.col.member"),
            colPaid: t("report.col.paid"),
            colShare: t("report.col.share"),
            colNet: t("report.col.net"),
          },
          {
            money,
            signed,
            percent: (bp) => formatBasisPoints(bp as BasisPoints),
            categoryName: nameOfCategory,
            memberName: nameOfMember,
          },
        ),
      )
      .then((bytes) => {
        downloadBytes(bytes, `report-${g}-${period.from}.pdf`, "application/pdf");
        setPdfState("idle");
      })
      .catch(() => {
        setPdfState("error");
      });
  };

  const chartState = entries.length === 0 ? "empty" : "ready";
  const compareRows = cmp.categories.map((c) => ({
    id: String(c.categoryId),
    name: nameOfCategory(c.categoryId),
    ...c,
  }));
  const columns: DataTableColumn<(typeof compareRows)[number]>[] = [
    { id: "name", header: t("dash.col.item"), value: (r) => r.name },
    {
      id: "cur",
      header: t("dash.col.current"),
      align: "end",
      value: (r) => r.currentCents,
      cell: (r) => money(r.currentCents),
    },
    {
      id: "prev",
      header: t("dash.col.previous"),
      align: "end",
      value: (r) => r.previousCents,
      cell: (r) => money(r.previousCents),
    },
    {
      id: "diff",
      header: t("dash.col.diff"),
      align: "end",
      value: (r) => r.diffCents,
      cell: (r) => signed(r.diffCents),
    },
    {
      id: "pct",
      header: t("dash.col.pct"),
      align: "end",
      value: (r) => r.pctBp ?? 0,
      cell: (r) => pctText(r),
    },
  ];
  const totalRows = [
    { id: "income", name: t("dash.income"), categoryId: null, ...cmp.income },
    { id: "expense", name: t("dash.expense"), categoryId: null, ...cmp.expense },
    { id: "savings", name: t("dash.savings"), categoryId: null, ...cmp.savings },
  ];

  return (
    <>
      <PageHeader
        title={kind === "family" ? t("overview.title") : t("personal.title")}
        subtitle={
          kind === "family" ? t("dash.subtitleFamily", { name: family.name }) : t("dash.subtitlePersonal")
        }
      />
      <div className={cx(styles.stack)}>
        <Card>
          <div className={cx(local.controls)}>
            <SegmentedControl
              label={t("dash.view")}
              options={[
                { id: "family", label: t("dash.view.family") },
                { id: "personal", label: t("dash.view.personal") },
              ]}
              value={kind}
              onChange={setKind}
            />
            <SegmentedControl
              label={t("dash.granularity")}
              options={GRANULARITIES.map((id) => ({ id, label: t(`dash.g.${id}`) }))}
              value={g}
              onChange={setG}
            />
            <div className={cx(local.pager)}>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => {
                  shift(-1);
                }}
              >
                {t("dash.prev")}
              </Button>
              <strong aria-live="polite">{label}</strong>
              <Button
                variant="secondary"
                size="sm"
                onPress={() => {
                  shift(1);
                }}
              >
                {t("dash.next")}
              </Button>
            </div>
            <Button variant="secondary" size="sm" isDisabled={pdfState === "busy"} onPress={downloadPdf}>
              {pdfState === "busy" ? t("report.generating") : t("report.download")}
            </Button>
          </div>
          {pdfState === "error" ? <p role="alert">{t("report.error")}</p> : null}
        </Card>

        <div className={cx(local.kpis)}>
          <StatTile label={t("dash.income")} value={money(k.incomeCents)} />
          <StatTile label={t("dash.expense")} value={money(k.expenseCents)} />
          <StatTile label={t("dash.savings")} value={money(k.savingsCents)} />
          <StatTile
            label={t("dash.rate")}
            value={
              k.savingsRateBp === null ? t("dash.noRate") : formatBasisPoints(k.savingsRateBp as BasisPoints)
            }
          />
        </div>

        <div className={cx(local.grid)}>
          <Card>
            <Suspense fallback={<Skeleton lines={6} />}>
              <TrendChart
                title={t("dash.trendTitle")}
                summary={t("dash.trendSummary", {
                  income: money(k.incomeCents),
                  expense: money(k.expenseCents),
                  label,
                })}
                series={[
                  { key: "income", label: t("dash.income") },
                  { key: "expense", label: t("dash.expense") },
                ]}
                data={points.map((p) => ({
                  periodo: bucketLabel(p.start),
                  income: p.incomeCents,
                  expense: p.expenseCents,
                }))}
                categoryKey="periodo"
                categoryLabel={t("dash.bucket")}
                formatValue={money}
                state={chartState}
              />
            </Suspense>
          </Card>
          <Card>
            <Suspense fallback={<Skeleton lines={6} />}>
              <BarList
                title={t("dash.categoriesTitle")}
                summary={t("dash.categoriesSummary", { label, total: money(k.expenseCents) })}
                series={[{ key: "value", label: t("dash.expense") }]}
                data={cats.map((c) => ({ nome: nameOfCategory(c.categoryId), value: c.cents }))}
                categoryKey="nome"
                formatValue={money}
                state={cats.length === 0 ? "empty" : "ready"}
              />
            </Suspense>
          </Card>
          {kind === "family" ? (
            <Card>
              <Suspense fallback={<Skeleton lines={4} />}>
                <StackedBar
                  title={t("dash.contribTitle")}
                  summary={t("dash.contribSummary", { label, total: money(k.expenseCents) })}
                  series={paidOrdered.map((p) => ({
                    key: p.memberId ?? "common",
                    label: nameOfMember(p.memberId),
                  }))}
                  data={[
                    {
                      nome: t("dash.contribRow"),
                      ...Object.fromEntries(paid.map((p) => [p.memberId ?? "common", p.cents])),
                    },
                  ]}
                  categoryKey="nome"
                  formatValue={money}
                  state={paid.length === 0 ? "empty" : "ready"}
                />
              </Suspense>
            </Card>
          ) : null}
          {balances ? (
            <Card title={t("dash.balanceTitle")} as="section">
              <div className={cx(styles.stack)}>
                <ul>
                  {balances.rows.map((r) => (
                    <li key={r.memberId}>
                      {nameOfMember(r.memberId)}: {signed(r.netCents)}
                    </li>
                  ))}
                </ul>
                <div>
                  <Button variant="secondary" size="sm" onPress={() => void navigate("/saldo")}>
                    {t("dash.balanceLink")}
                  </Button>
                </div>
              </div>
            </Card>
          ) : null}
        </div>

        <Card title={t("dash.compareTitle")} as="section">
          <div className={cx(styles.stack)}>
            <Select
              label={t("dash.compareWith")}
              options={[
                { id: "previous", label: t("dash.mode.previous") },
                ...(g === "year" ? [] : [{ id: "lastYear", label: t("dash.mode.lastYear") }]),
              ]}
              value={g === "year" ? "previous" : mode}
              onChange={(key) => {
                setMode(key === "lastYear" ? "lastYear" : "previous");
              }}
            />
            <Suspense fallback={<Skeleton lines={6} />}>
              <CompareChart
                title={t("dash.compareChart", { a: label, b: againstLabel })}
                summary={t("dash.compareChartSummary", {
                  a: label,
                  b: againstLabel,
                  diff: signed(cmp.expense.diffCents),
                  pct: pctText(cmp.expense),
                })}
                current={{ key: "cur", label }}
                previous={{ key: "prev", label: againstLabel }}
                data={compareRows
                  .slice(0, 8)
                  .map((r) => ({ nome: r.name, cur: r.currentCents, prev: r.previousCents }))}
                categoryKey="nome"
                formatValue={money}
                state={compareRows.length === 0 ? "empty" : "ready"}
              />
            </Suspense>
            <DataTable
              caption={t("dash.compareTable", { label: againstLabel })}
              columns={columns}
              rows={totalRows}
              getRowId={(r) => r.id}
            />
            {compareRows.length > 0 ? (
              <DataTable
                caption={t("dash.categoriesTitle")}
                columns={columns}
                rows={compareRows}
                getRowId={(r) => r.id}
              />
            ) : null}
          </div>
        </Card>
      </div>
    </>
  );
}
