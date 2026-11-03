// Il registro (feature 8): periodo letto dal backend, filtri e totali da `core`, stato nell'URL.
import {
  NONE,
  PERIOD_PRESETS,
  SUMMARY_DIMENSIONS,
  cents,
  filterTransactions,
  pageOf,
  periodRange,
  signedCents,
  summarize,
  totalsOf,
  type Account,
  type Category,
  type Member,
  type PeriodPreset,
  type SummaryDimension,
  type SummaryRow,
  type Transaction,
} from "@noi2contiamo/core";
import { getLocalTimeZone, parseDate, today } from "@internationalized/date";
import { ChevronLeft, ChevronRight, MoreVertical, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { useCollection, useTransactionsInRange } from "../../data/queries";
import { t, type MessageKey } from "../../i18n/it";
import {
  Amount,
  Button,
  Card,
  ConfirmDialog,
  DataTable,
  DateRangePicker,
  EmptyState,
  ErrorState,
  FilterBar,
  IconButton,
  Menu,
  PageHeader,
  SearchField,
  Select,
  Skeleton,
  StatTile,
  Tabs,
  amountText,
  formatDate,
  type Chip,
  type DataTableColumn,
  type Option,
} from "../../ui";
import { cx } from "../../ui/cx";
import { categoryLabel } from "../catalog/CategoriesPage";
import { useFamily } from "../guards";
import { filterOf, parseRegister, serializeRegister, type RegisterState } from "./registerUrl";
import styles from "./register.module.css";
import { splitText } from "../split/SplitEditor";
import { useDeleteTransaction } from "./useDeleteTransaction";

/** Data di calendario `YYYY-MM-DD` come giorno locale (niente spostamenti di fuso). */
export function calendarDate(date: string): Date {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const PRESET_KEYS: Readonly<Record<PeriodPreset, MessageKey>> = {
  thisMonth: "period.thisMonth",
  lastMonth: "period.lastMonth",
  last30: "period.last30",
  thisYear: "period.thisYear",
  lastYear: "period.lastYear",
  all: "period.all",
  custom: "period.custom",
};

const TYPE_KEYS: Readonly<Record<Transaction["type"], MessageKey>> = {
  expense: "tx.type.expense",
  income: "tx.type.income",
  transfer: "tx.type.transfer",
};

const DIMENSION_KEYS: Readonly<Record<SummaryDimension, MessageKey>> = {
  type: "tx.summary.type",
  account: "tx.summary.account",
  member: "tx.summary.member",
  category: "tx.summary.category",
  payee: "tx.summary.payee",
};

/** "Tutti" nei Select: niente filtro. */
const ALL = "all";

type FilterKey = "type" | "accountId" | "memberId" | "categoryId" | "payeeId";

interface Names {
  readonly account: ReadonlyMap<string, string>;
  readonly member: ReadonlyMap<string, string>;
  readonly category: ReadonlyMap<string, string>;
  readonly payee: ReadonlyMap<string, string>;
}

function namesOf(
  accounts: readonly Account[],
  members: readonly Member[],
  categories: readonly Category[],
  payees: readonly { readonly id: string; readonly name: string }[],
): Names {
  return {
    account: new Map(accounts.map((a) => [a.id, a.name])),
    member: new Map(members.map((m) => [m.id, m.displayName])),
    category: new Map(categories.map((c) => [c.id, categoryLabel(c, categories)])),
    payee: new Map(payees.map((p) => [p.id, p.name])),
  };
}

/** Il nome della voce di una riga riassuntiva (o di un filtro). */
function labelOf(dimension: SummaryDimension, key: string | null, names: Names): string {
  switch (dimension) {
    case "type":
      return key === "expense" || key === "income" || key === "transfer" ? t(TYPE_KEYS[key]) : "";
    case "account":
      return key === null ? "" : (names.account.get(key) ?? "");
    case "member":
      return key === null ? t("tx.commonFund") : (names.member.get(key) ?? "");
    case "category":
      return key === null ? t("tx.noCategory") : (names.category.get(key) ?? "");
    case "payee":
      return key === null ? t("tx.noPayee") : (names.payee.get(key) ?? "");
  }
}

const sorted = (options: Option[]) => options.sort((a, b) => a.label.localeCompare(b.label, "it"));

function amountCell(tx: Transaction) {
  const signed = signedCents(tx);
  if (tx.type === "transfer") return <Amount value={cents(tx.amountCents)} />;
  return <Amount value={cents(tx.amountCents)} kind={signed >= 0 ? "income" : "expense"} />;
}

export function TransactionsPage() {
  const { family } = useFamily();
  const navigate = useNavigate();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const state = parseRegister(params);
  const todayIso = today(getLocalTimeZone()).toString();
  const range = periodRange(state.preset, todayIso, { from: state.from, to: state.to });

  const transactions = useTransactionsInRange(family.id, range);
  const accounts = useCollection(family.id, "accounts");
  const categories = useCollection(family.id, "categories");
  const payees = useCollection(family.id, "payees");
  const members = useCollection(family.id, "members");
  const remove = useDeleteTransaction(family.id);
  const [toDelete, setToDelete] = useState<Transaction | null>(null);

  const update = (patch: Partial<RegisterState>) => {
    // Ogni cambio di filtro riparte dalla prima pagina; cambiare pagina no.
    setParams(serializeRegister({ ...state, page: 1, ...patch }), { replace: true });
  };

  const names = useMemo(
    () => namesOf(accounts.data ?? [], members.data ?? [], categories.data ?? [], payees.data ?? []),
    [accounts.data, members.data, categories.data, payees.data],
  );

  const filtered = filterTransactions(transactions.data ?? [], filterOf(state), {
    categories: categories.data ?? [],
    payeeNames: names.payee,
  });
  const totals = totalsOf(filtered);
  const current = pageOf(filtered, state.page);

  const columns = useMemo((): DataTableColumn<Transaction>[] => {
    const back = `${location.pathname}${location.search}`;
    return [
      {
        id: "description",
        header: t("tx.col.description"),
        sortable: false,
        value: (tx) => tx.description,
        cell: (tx) => (
          <span className={cx(styles.primary)}>
            <span>{tx.description || labelOf("category", tx.categoryId, names)}</span>
            <span className={cx(styles.secondary)}>
              {formatDate(calendarDate(tx.date))} · {labelOf("category", tx.categoryId, names)}
            </span>
          </span>
        ),
      },
      {
        id: "date",
        header: t("tx.col.date"),
        sortable: false,
        hideOnMobile: true,
        value: (tx) => tx.date,
        cell: (tx) => formatDate(calendarDate(tx.date)),
      },
      {
        id: "category",
        header: t("tx.col.category"),
        sortable: false,
        hideOnMobile: true,
        value: (tx) =>
          tx.type === "transfer" ? t("tx.type.transfer") : labelOf("category", tx.categoryId, names),
      },
      {
        id: "account",
        header: t("tx.col.account"),
        sortable: false,
        hideOnMobile: true,
        value: (tx) =>
          tx.toAccountId
            ? `${labelOf("account", tx.accountId, names)} → ${labelOf("account", tx.toAccountId, names)}`
            : labelOf("account", tx.accountId, names),
      },
      {
        id: "payee",
        header: t("tx.col.payee"),
        sortable: false,
        hideOnMobile: true,
        value: (tx) => (tx.payeeId ? labelOf("payee", tx.payeeId, names) : ""),
      },
      {
        id: "member",
        header: t("tx.col.member"),
        sortable: false,
        hideOnMobile: true,
        value: (tx) => labelOf("member", tx.payerMemberId, names),
      },
      {
        id: "split",
        header: t("tx.col.split"),
        sortable: false,
        hideOnMobile: true,
        value: (tx) => splitText(tx, (id) => names.member.get(id) ?? ""),
      },
      {
        id: "amount",
        header: t("tx.col.amount"),
        align: "end",
        sortable: false,
        value: (tx) => signedCents(tx),
        cell: amountCell,
      },
      {
        id: "actions",
        header: t("tx.col.actions"),
        align: "end",
        sortable: false,
        value: () => "",
        cell: (tx) => (
          <Menu
            trigger={
              <IconButton
                label={t("tx.actions", { name: tx.description || formatDate(calendarDate(tx.date)) })}
                icon={<MoreVertical aria-hidden="true" strokeWidth={1.75} />}
              />
            }
            actions={[
              { id: "edit", label: t("tx.action.edit") },
              { id: "delete", label: t("tx.action.delete"), tone: "danger" as const },
            ]}
            onAction={(action) => {
              if (action === "edit") void navigate(`/movimenti/${tx.id}`, { state: { back } });
              else setToDelete(tx);
            }}
          />
        ),
      },
    ];
  }, [names, navigate, location.pathname, location.search]);

  const add = (
    <Button
      icon={<Plus aria-hidden="true" size={20} strokeWidth={1.75} />}
      onPress={() => void navigate("/movimenti/nuovo")}
    >
      {t("tx.add")}
    </Button>
  );

  const lookups = [accounts, categories, payees, members];
  if (lookups.some((q) => q.isError))
    return (
      <>
        <PageHeader title={t("tx.list.title")} subtitle={family.name} actions={add} />
        <ErrorState onRetry={() => void Promise.all(lookups.map((q) => q.refetch()))} />
      </>
    );
  const lookupsPending = lookups.some((q) => q.isPending);

  const chips = activeChips(state, names);
  const hasFilters = chips.length > 0;

  let body;
  if (transactions.isPending || lookupsPending) body = <Skeleton lines={5} />;
  else if (transactions.isError) body = <ErrorState onRetry={() => void transactions.refetch()} />;
  else if (filtered.length === 0)
    body =
      hasFilters || state.preset !== "all" ? (
        <EmptyState title={t("tx.empty.filtered.title")} description={t("tx.empty.filtered.body")} />
      ) : (
        <EmptyState title={t("tx.empty.title")} description={t("tx.empty.body")} action={add} />
      );
  else
    body = (
      <div className={cx(styles.stack)}>
        <DataTable
          caption={t("tx.list.caption")}
          hideCaption
          columns={columns}
          rows={current.items}
          getRowId={(tx) => tx.id}
        />
        {current.pages > 1 ? (
          <nav aria-label={t("tx.page.nav")} className={cx(styles.pager)}>
            <IconButton
              label={t("tx.page.prev")}
              icon={<ChevronLeft aria-hidden="true" strokeWidth={1.75} />}
              isDisabled={current.page <= 1}
              onPress={() => {
                setParams(serializeRegister({ ...state, page: current.page - 1 }));
              }}
            />
            <span aria-live="polite">
              {t("tx.page.status", { page: String(current.page), pages: String(current.pages) })}
            </span>
            <IconButton
              label={t("tx.page.next")}
              icon={<ChevronRight aria-hidden="true" strokeWidth={1.75} />}
              isDisabled={current.page >= current.pages}
              onPress={() => {
                setParams(serializeRegister({ ...state, page: current.page + 1 }));
              }}
            />
          </nav>
        ) : null}
      </div>
    );

  const showData = !transactions.isPending && !lookupsPending && !transactions.isError && filtered.length > 0;

  return (
    <>
      <PageHeader title={t("tx.list.title")} subtitle={family.name} actions={add} />
      <div className={cx(styles.stack)}>
        <Card title={t("tx.filters.title")} as="section">
          <Filters
            state={state}
            update={update}
            names={names}
            lookups={{
              accounts: accounts.data ?? [],
              categories: categories.data ?? [],
              payees: payees.data ?? [],
              members: members.data ?? [],
            }}
          />
          <FilterBar
            chips={chips}
            onRemove={(ids) => {
              const patch: Record<string, unknown> = {};
              for (const id of ids) {
                if (id === "text") patch.text = "";
                else if (id === "period") Object.assign(patch, { preset: "thisMonth", from: null, to: null });
                else patch[String(id)] = null;
              }
              update(patch);
            }}
            onClear={() => {
              setParams(new URLSearchParams(), { replace: true });
            }}
          />
        </Card>
        {showData ? (
          <section aria-label={t("tx.totals.title")} className={cx(styles.tiles)}>
            <StatTile label={t("tx.totals.income")} value={amountText(totals.incomeCents, "income")} />
            <StatTile label={t("tx.totals.expense")} value={amountText(totals.expenseCents, "expense")} />
            <StatTile label={t("tx.totals.net")} value={amountText(totals.netCents)} />
            <StatTile label={t("tx.summary.col.count")} value={String(totals.count)} />
          </section>
        ) : null}
        <Card>{body}</Card>
        {showData ? (
          <Card title={t("tx.summary.title")} as="section">
            <Tabs
              label={t("tx.summary.tabs")}
              items={SUMMARY_DIMENSIONS.map((dimension) => ({
                id: dimension,
                label: t(DIMENSION_KEYS[dimension]),
                content: (
                  <SummaryTable
                    dimension={dimension}
                    rows={summarize(filtered, dimension)}
                    names={names}
                    totals={totals}
                  />
                ),
              }))}
            />
          </Card>
        ) : null}
      </div>
      <ConfirmDialog
        title={t("tx.delete.title")}
        message={t("tx.delete.body")}
        isOpen={toDelete !== null}
        onOpenChange={(open) => {
          if (!open) setToDelete(null);
        }}
        onConfirm={() => {
          if (toDelete) remove.mutate(toDelete.id);
        }}
      />
      {remove.isError ? (
        <p role="alert" className={cx(styles.error)}>
          {t("tx.error.delete")}
        </p>
      ) : null}
    </>
  );
}

function activeChips(state: RegisterState, names: Names): Chip[] {
  const chips: Chip[] = [];
  if (state.preset !== "thisMonth") {
    const label =
      state.preset === "custom"
        ? `${state.from ? formatDate(calendarDate(state.from)) : "…"} – ${state.to ? formatDate(calendarDate(state.to)) : "…"}`
        : t(PRESET_KEYS[state.preset]);
    chips.push({ id: "period", label: t("tx.chip", { label: t("period.label"), value: label }) });
  }
  const dims: readonly (readonly [FilterKey, SummaryDimension, MessageKey])[] = [
    ["type", "type", "tx.filter.type"],
    ["accountId", "account", "tx.filter.account"],
    ["memberId", "member", "tx.filter.member"],
    ["categoryId", "category", "tx.filter.category"],
    ["payeeId", "payee", "tx.filter.payee"],
  ];
  for (const [key, dimension, labelKey] of dims) {
    const value = state[key];
    if (value === null) continue;
    chips.push({
      id: key,
      label: t("tx.chip", {
        label: t(labelKey),
        value: labelOf(dimension, value === NONE ? null : value, names),
      }),
    });
  }
  if (state.text.trim() !== "")
    chips.push({ id: "text", label: t("tx.chip.text", { value: state.text.trim() }) });
  return chips;
}

interface FiltersProps {
  readonly state: RegisterState;
  readonly update: (patch: Partial<RegisterState>) => void;
  readonly names: Names;
  readonly lookups: {
    readonly accounts: readonly Account[];
    readonly categories: readonly Category[];
    readonly payees: readonly { readonly id: string; readonly name: string }[];
    readonly members: readonly Member[];
  };
}

function Filters({ state, update, names, lookups }: FiltersProps) {
  const all = (key: MessageKey = "tx.filter.all"): Option => ({ id: ALL, label: t(key) });
  const pick = (value: string | null) => value ?? ALL;
  const fromKey = (key: string | number | null) => (key === null || key === ALL ? null : String(key));

  return (
    <div className={cx(styles.filters)}>
      <Select
        label={t("period.label")}
        options={PERIOD_PRESETS.map((p) => ({ id: p, label: t(PRESET_KEYS[p]) }))}
        value={state.preset}
        onChange={(key) => {
          const preset = (key ?? "thisMonth") as PeriodPreset;
          if (preset === "custom") {
            // Si parte dal periodo che si stava guardando.
            const seed = periodRange(state.preset, today(getLocalTimeZone()).toString());
            update({ preset, from: seed.from, to: seed.to });
          } else update({ preset, from: null, to: null });
        }}
      />
      {state.preset === "custom" ? (
        <DateRangePicker
          label={t("tx.filter.range")}
          value={state.from && state.to ? { start: parseDate(state.from), end: parseDate(state.to) } : null}
          onChange={(value) => {
            update({ from: value ? value.start.toString() : null, to: value ? value.end.toString() : null });
          }}
        />
      ) : null}
      <Select
        label={t("tx.filter.type")}
        options={[
          all(),
          ...(["expense", "income", "transfer"] as const).map((id) => ({ id, label: t(TYPE_KEYS[id]) })),
        ]}
        value={pick(state.type)}
        onChange={(key) => {
          update({ type: fromKey(key) as Transaction["type"] | null });
        }}
      />
      <Select
        label={t("tx.filter.account")}
        options={[all(), ...sorted(lookups.accounts.map((a) => ({ id: a.id, label: a.name })))]}
        value={pick(state.accountId)}
        onChange={(key) => {
          update({ accountId: fromKey(key) });
        }}
      />
      <Select
        label={t("tx.filter.member")}
        options={[
          all(),
          ...sorted(lookups.members.map((m) => ({ id: m.id, label: m.displayName }))),
          { id: NONE, label: t("tx.commonFund") },
        ]}
        value={pick(state.memberId)}
        onChange={(key) => {
          update({ memberId: fromKey(key) });
        }}
      />
      <Select
        label={t("tx.filter.category")}
        options={[
          all("tx.filter.allFem"),
          ...sorted(lookups.categories.map((c) => ({ id: c.id, label: names.category.get(c.id) ?? c.name }))),
          { id: NONE, label: t("tx.noCategory") },
        ]}
        value={pick(state.categoryId)}
        onChange={(key) => {
          update({ categoryId: fromKey(key) });
        }}
      />
      <Select
        label={t("tx.filter.payee")}
        options={[
          all(),
          ...sorted(lookups.payees.map((p) => ({ id: p.id, label: p.name }))),
          { id: NONE, label: t("tx.noPayee") },
        ]}
        value={pick(state.payeeId)}
        onChange={(key) => {
          update({ payeeId: fromKey(key) });
        }}
      />
      <SearchField
        label={t("tx.filter.search")}
        placeholder={t("tx.filter.searchPlaceholder")}
        value={state.text}
        onChange={(value) => {
          update({ text: value });
        }}
      />
    </div>
  );
}

function SummaryTable({
  dimension,
  rows,
  names,
  totals,
}: {
  readonly dimension: SummaryDimension;
  readonly rows: readonly SummaryRow[];
  readonly names: Names;
  readonly totals: ReturnType<typeof totalsOf>;
}) {
  const columns: DataTableColumn<SummaryRow>[] = [
    { id: "key", header: t(DIMENSION_KEYS[dimension]), value: (row) => labelOf(dimension, row.key, names) },
    { id: "count", header: t("tx.summary.col.count"), align: "end", value: (row) => row.count },
    {
      id: "income",
      header: t("tx.summary.col.income"),
      align: "end",
      value: (row) => row.incomeCents,
      cell: (row) => <Amount value={row.incomeCents} />,
    },
    {
      id: "expense",
      header: t("tx.summary.col.expense"),
      align: "end",
      value: (row) => row.expenseCents,
      cell: (row) => <Amount value={row.expenseCents} />,
    },
    {
      id: "net",
      header: t("tx.summary.col.net"),
      align: "end",
      value: (row) => row.netCents,
      cell: (row) => <Amount value={row.netCents} />,
    },
  ];
  return (
    <DataTable
      caption={t("tx.summary.caption", { dimension: t(DIMENSION_KEYS[dimension]).toLowerCase() })}
      columns={columns}
      rows={rows}
      getRowId={(row) => row.key ?? NONE}
      totals={{
        count: String(totals.count),
        income: <Amount value={totals.incomeCents} />,
        expense: <Amount value={totals.expenseCents} />,
        net: <Amount value={totals.netCents} />,
      }}
    />
  );
}
