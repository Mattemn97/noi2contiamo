// Pagina catalogo /dev/ui: ogni componente di ui/ con dati di esempio. Solo con import.meta.env.DEV.
import { cents, type BasisPoints, type Cents } from "@noi2contiamo/core";
import { MoreVertical, Info, Settings } from "lucide-react";
import { lazy, Suspense, useState } from "react";
import { t } from "../i18n/it";
import {
  Amount,
  AppShell,
  Button,
  Card,
  Checkbox,
  ComboBox,
  ConfirmDialog,
  DataTable,
  DatePicker,
  DateRangePicker,
  Dialog,
  EmptyState,
  ErrorState,
  FilterBar,
  formatCents,
  IconButton,
  Link,
  Menu,
  MoneyField,
  PageHeader,
  PercentField,
  RadioGroup,
  SearchField,
  SegmentedControl,
  Select,
  Sheet,
  Skeleton,
  StatTile,
  StatusBadge,
  Switch,
  Tabs,
  TextField,
  ThemeSwitcher,
  Tooltip,
  useToast,
  type Chip,
  type DataTableColumn,
} from "../ui";
import { cx } from "../ui/cx";
import styles from "./UiCatalog.module.css";

const Charts = lazy(() => import("./CatalogCharts").then((module) => ({ default: module.CatalogCharts })));

const CATEGORIES = [
  { id: "casa", label: t("dev.categoryHome") },
  { id: "spesa", label: t("dev.categoryFood") },
  { id: "trasporti", label: t("dev.categoryTransport") },
  { id: "svago", label: t("dev.categoryLeisure") },
];

const PAYEES = [
  { id: "market", label: t("dev.payeeMarket") },
  { id: "landlord", label: t("dev.payeeLandlord") },
  { id: "gas", label: t("dev.payeeGas") },
];

interface CategoryRow {
  readonly id: string;
  readonly label: string;
  readonly expenses: Cents;
  readonly income: Cents;
}

const ROWS: readonly CategoryRow[] = [
  { id: "casa", label: t("dev.categoryHome"), expenses: cents(120000), income: cents(0) },
  { id: "spesa", label: t("dev.categoryFood"), expenses: cents(48350), income: cents(0) },
  { id: "trasporti", label: t("dev.categoryTransport"), expenses: cents(15990), income: cents(2500) },
  { id: "svago", label: t("dev.categoryLeisure"), expenses: cents(9900), income: cents(0) },
];

const COLUMNS: readonly DataTableColumn<CategoryRow>[] = [
  { id: "label", header: t("dev.category"), value: (row) => row.label },
  {
    id: "expenses",
    header: t("dev.expenses"),
    value: (row) => row.expenses,
    cell: (row) => <Amount value={row.expenses} kind="expense" />,
    align: "end",
  },
  {
    id: "income",
    header: t("dev.income"),
    value: (row) => row.income,
    cell: (row) => <Amount value={row.income} kind="income" />,
    align: "end",
  },
];

const TOTAL_EXPENSES = cents(ROWS.reduce((total, row) => total + row.expenses, 0));
const TOTAL_INCOME = cents(ROWS.reduce((total, row) => total + row.income, 0));

const INITIAL_CHIPS: readonly Chip[] = [
  { id: "category", label: t("dev.filterCategory") },
  { id: "person", label: t("dev.filterPerson") },
];

type View = "week" | "month" | "year";

export function UiCatalog() {
  const toast = useToast();
  const [amount, setAmount] = useState<Cents | null>(null);
  const [share, setShare] = useState<BasisPoints | null>(null);
  const [view, setView] = useState<View>("month");
  const [chips, setChips] = useState<readonly Chip[]>(INITIAL_CHIPS);
  const [period, setPeriod] = useState<Parameters<typeof DateRangePicker>[0]["value"]>(null);

  return (
    <AppShell current="more">
      <PageHeader title={t("dev.title")} subtitle={t("dev.subtitle")} actions={<ThemeSwitcher />} />

      <div className={cx(styles.sections)}>
        <Card title={t("dev.section.actions")} as="section">
          <div className={cx(styles.row)}>
            <Button>{t("dev.primary")}</Button>
            <Button variant="secondary">{t("dev.secondary")}</Button>
            <Button variant="ghost">{t("dev.ghost")}</Button>
            <Button variant="danger">{t("common.delete")}</Button>
            <Button size="sm" variant="secondary">
              {t("dev.small")}
            </Button>
            <IconButton label={t("dev.settings")} icon={<Settings aria-hidden="true" strokeWidth={1.75} />} />
            <Link href="#contenuto">{t("dev.link")}</Link>
          </div>
        </Card>

        <Card title={t("dev.section.fields")} as="section">
          <div className={cx(styles.fields)}>
            <TextField label={t("dev.description")} description={t("dev.descriptionHelp")} />
            <SearchField />
            <MoneyField
              label={t("dev.amount")}
              description={t("dev.amountHelp")}
              value={amount}
              onChange={setAmount}
            />
            <p className={cx(styles.muted)}>
              {t("dev.amountResult", { value: amount === null ? "—" : String(amount) })}
            </p>
            <PercentField label={t("dev.share")} value={share} onChange={setShare} />
            <Select label={t("dev.category")} options={CATEGORIES} />
            <ComboBox label={t("dev.payee")} options={PAYEES} />
            <DatePicker label={t("dev.date")} />
            <DateRangePicker label={t("period.label")} value={period} onChange={setPeriod} />
          </div>
        </Card>

        <Card title={t("dev.section.choices")} as="section">
          <div className={cx(styles.fields)}>
            <Checkbox>{t("dev.recurring")}</Checkbox>
            <Switch>{t("dev.notify")}</Switch>
            <RadioGroup
              label={t("dev.split")}
              defaultValue="category"
              options={[
                { id: "equal", label: t("dev.splitEqual") },
                { id: "category", label: t("dev.splitCategory") },
                { id: "manual", label: t("dev.splitManual") },
              ]}
            />
            <SegmentedControl<View>
              label={t("dev.view")}
              value={view}
              onChange={setView}
              options={[
                { id: "week", label: t("dev.week") },
                { id: "month", label: t("dev.month") },
                { id: "year", label: t("dev.year") },
              ]}
            />
            <Tabs
              label={t("dev.tabs")}
              items={[
                { id: "summary", label: t("dev.tabSummary"), content: <p>{t("dev.tabSummaryBody")}</p> },
                { id: "detail", label: t("dev.tabDetail"), content: <p>{t("dev.tabDetailBody")}</p> },
              ]}
            />
          </div>
        </Card>

        <Card title={t("dev.section.overlays")} as="section">
          <div className={cx(styles.row)}>
            <Dialog
              title={t("dev.dialogTitle")}
              trigger={<Button variant="secondary">{t("dev.openDialog")}</Button>}
              footer={(close) => <Button onPress={close}>{t("dev.primary")}</Button>}
            >
              <p>{t("dev.dialogBody")}</p>
            </Dialog>
            <Sheet
              title={t("dev.dialogTitle")}
              trigger={<Button variant="secondary">{t("dev.openSheet")}</Button>}
            >
              <p>{t("dev.dialogBody")}</p>
            </Sheet>
            <ConfirmDialog
              title={t("dev.confirmTitle")}
              message={t("dev.confirmBody")}
              trigger={<Button variant="danger">{t("dev.openConfirm")}</Button>}
              onConfirm={() => {
                toast.show({ message: t("dev.toastText") });
              }}
            />
            <Menu
              trigger={
                <IconButton
                  label={t("dev.actions")}
                  icon={<MoreVertical aria-hidden="true" strokeWidth={1.75} />}
                />
              }
              actions={[
                { id: "edit", label: t("dev.edit") },
                { id: "duplicate", label: t("dev.duplicate") },
                { id: "delete", label: t("common.delete"), tone: "danger" },
              ]}
              onAction={() => undefined}
            />
            <Tooltip text={t("dev.tooltipText")}>
              <IconButton label={t("dev.tooltip")} icon={<Info aria-hidden="true" strokeWidth={1.75} />} />
            </Tooltip>
            <Button
              variant="secondary"
              onPress={() => {
                toast.show({
                  message: t("dev.toastText"),
                  action: { label: t("common.undo"), onAction: () => undefined },
                });
              }}
            >
              {t("dev.showToast")}
            </Button>
          </div>
          <div className={cx(styles.row)}>
            <StatusBadge status="good" label={t("dev.statusGood")} />
            <StatusBadge status="warning" label={t("dev.statusWarning")} />
            <StatusBadge status="serious" label={t("dev.statusSerious")} />
            <StatusBadge status="critical" label={t("dev.statusCritical")} />
          </div>
        </Card>

        <Card title={t("dev.section.states")} as="section">
          <EmptyState title={t("dev.emptyTitle")} description={t("dev.emptyBody")} />
          <ErrorState description={t("dev.errorBody")} onRetry={() => undefined} />
          <Skeleton lines={3} />
        </Card>

        <Card title={t("dev.section.data")} as="section">
          <div className={cx(styles.tiles)}>
            <StatTile
              label={t("dev.balance")}
              value={formatCents(cents(184520))}
              change="+12,5%"
              trend="up"
              changeLabel={t("dev.vsLastMonth")}
            />
            <StatTile
              label={t("dev.expenses")}
              value={formatCents(TOTAL_EXPENSES)}
              change="−3,1%"
              trend="down"
            />
          </div>
          <FilterBar
            chips={chips}
            onRemove={(ids) => {
              setChips((current) => current.filter((chip) => !ids.has(chip.id)));
            }}
            onClear={() => {
              setChips([]);
            }}
          />
          <DataTable
            caption={t("dev.tableCaption")}
            columns={COLUMNS}
            rows={ROWS}
            getRowId={(row) => row.id}
            totals={{
              expenses: <Amount value={TOTAL_EXPENSES} kind="expense" />,
              income: <Amount value={TOTAL_INCOME} kind="income" />,
            }}
          />
        </Card>

        <section className={cx(styles.charts)} aria-labelledby="catalogo-grafici">
          <h2 id="catalogo-grafici" className={cx(styles.sectionTitle)}>
            {t("dev.section.charts")}
          </h2>
          <Suspense fallback={<Skeleton blockHeight="chart" />}>
            <Charts />
          </Suspense>
        </section>
      </div>
    </AppShell>
  );
}
