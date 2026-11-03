// Saldo tra i membri (feature 10, spec 0005): chi deve a chi, dettaglio, pareggio, giroconti da riconoscere.
// Tutti i numeri vengono da `core`; qui si leggono i movimenti e si scrive con l'adapter.
import {
  cents,
  findTransferPairs,
  memberBalances,
  mergeTransferPair,
  newId,
  settlementAccount,
  settlementPlan,
  settlementTransfer,
  pickable,
  type BalanceRow,
  type Cents,
  type SettlementPayment,
  type TransferPair,
  type Transaction,
} from "@noi2contiamo/core";
import { getLocalTimeZone, parseDate, today, type CalendarDate } from "@internationalized/date";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle } from "lucide-react";
import { useState } from "react";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap, useAllDocs, useCollection } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Amount,
  amountText,
  Button,
  Card,
  DataTable,
  DatePicker,
  Dialog,
  EmptyState,
  ErrorState,
  MoneyField,
  PageHeader,
  Select,
  Skeleton,
  formatDate,
  useToast,
  type DataTableColumn,
} from "../../ui";
import { cx } from "../../ui/cx";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import local from "./balance.module.css";

const asDate = (iso: string) => parseDate(iso).toDate(getLocalTimeZone());

/** Saldo con il segno: negativo (da dare) in rosso con icona, come vuole design.md. */
export function NetAmount({ value }: { readonly value: number }) {
  if (value >= 0) return <Amount value={cents(value)} />;
  return (
    <span className={cx(local.debt)}>
      <AlertCircle aria-hidden="true" size={16} strokeWidth={1.75} />
      <Amount value={cents(value)} />
      <span className={cx(local.srOnly)}>{t("balance.debtor")}</span>
    </span>
  );
}

export function BalancePage() {
  const { family } = useFamily();
  const transactions = useAllDocs(family.id, "transactions");
  const accounts = useCollection(family.id, "accounts");
  const members = useCollection(family.id, "members");
  const [to, setTo] = useState<CalendarDate>(() => today(getLocalTimeZone()));
  const [from, setFrom] = useState<CalendarDate | null>(null);
  const [settling, setSettling] = useState<SettlementPayment | null>(null);

  if (transactions.isPending || accounts.isPending || members.isPending) return <Skeleton lines={6} />;
  if (transactions.isError || accounts.isError || members.isError)
    return (
      <ErrorState
        onRetry={() => void Promise.all([transactions.refetch(), accounts.refetch(), members.refetch()])}
      />
    );

  const nameOf = (id: string) => members.data.find((m) => m.id === id)?.displayName ?? id;
  const activeIds = members.data.filter((m) => m.leftAtMs === null).map((m) => m.id);
  const balances = memberBalances(transactions.data, {
    accounts: accounts.data,
    family,
    memberIds: activeIds,
    range: { from: from?.toString() ?? null, to: to.toString() },
  });
  const plan = settlementPlan(Object.fromEntries(balances.rows.map((r) => [r.memberId, r.netCents])));
  const pairs = findTransferPairs(transactions.data, { accounts: accounts.data });

  return (
    <>
      <PageHeader title={t("balance.title")} subtitle={family.name} />
      <div className={cx(styles.stack)}>
        <Card>
          <div className={cx(local.dates)}>
            <DatePicker
              label={t("balance.to")}
              value={to}
              onChange={(next) => {
                if (next) setTo(next);
              }}
            />
            <DatePicker label={t("balance.from")} value={from} onChange={setFrom} />
          </div>
          <p className={cx(styles.muted)}>{t("balance.periodHelp")}</p>
        </Card>
        <Card title={t("balance.payments")} as="section">
          {plan.length === 0 ? (
            <EmptyState title={t("balance.even")} description={t("balance.evenBody")} />
          ) : (
            <ul className={cx(local.list)}>
              {plan.map((p) => (
                <li key={`${p.fromMemberId}-${p.toMemberId}`} className={cx(local.item)}>
                  <span>
                    {t("balance.owes", {
                      from: nameOf(p.fromMemberId),
                      to: nameOf(p.toMemberId),
                      amount: amountText(cents(p.amountCents)),
                    })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      setSettling(p);
                    }}
                  >
                    {t("balance.settle")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={t("balance.detail")} as="section">
          <div className={cx(styles.stack)}>
            <BalanceTable rows={balances.rows} nameOf={nameOf} />
            <p className={cx(styles.muted)}>{t("balance.netHelp")}</p>
          </div>
        </Card>
        {pairs.length > 0 ? (
          <PairsCard pairs={pairs} accountName={(id) => accounts.data.find((a) => a.id === id)?.name ?? id} />
        ) : null}
      </div>
      {settling ? (
        <SettleDialog
          key={`${settling.fromMemberId}-${settling.toMemberId}-${String(settling.amountCents)}`}
          payment={settling}
          nameOf={nameOf}
          onClose={() => {
            setSettling(null);
          }}
        />
      ) : null}
    </>
  );
}

function BalanceTable({
  rows,
  nameOf,
}: {
  readonly rows: readonly BalanceRow[];
  readonly nameOf: (id: string) => string;
}) {
  const money = (
    id: string,
    header: string,
    pick: (r: BalanceRow) => number,
  ): DataTableColumn<BalanceRow> => ({
    id,
    header,
    align: "end",
    hideOnMobile: true,
    value: pick,
    cell: (r) => <Amount value={cents(pick(r))} />,
  });
  const columns: DataTableColumn<BalanceRow>[] = [
    { id: "member", header: t("balance.col.member"), value: (r) => nameOf(r.memberId) },
    money("paid", t("balance.col.paid"), (r) => r.paidCents),
    money("expenseShare", t("balance.col.expenseShare"), (r) => r.expenseShareCents),
    money("received", t("balance.col.received"), (r) => r.receivedCents),
    money("incomeShare", t("balance.col.incomeShare"), (r) => r.incomeShareCents),
    money("transfers", t("balance.col.transfers"), (r) => r.transfersCents),
    {
      id: "net",
      header: t("balance.col.net"),
      align: "end",
      value: (r) => r.netCents,
      cell: (r) => <NetAmount value={r.netCents} />,
    },
  ];
  return (
    <DataTable caption={t("balance.caption")} columns={columns} rows={rows} getRowId={(r) => r.memberId} />
  );
}

function SettleDialog({
  payment,
  nameOf,
  onClose,
}: {
  readonly payment: SettlementPayment;
  readonly nameOf: (id: string) => string;
  readonly onClose: () => void;
}) {
  const adapter = useAdapter();
  const { family } = useFamily();
  const client = useQueryClient();
  const toast = useToast();
  const accounts = useCollection(family.id, "accounts");
  const all = accounts.data ?? [];
  const [amount, setAmount] = useState<Cents | null>(cents(payment.amountCents));
  const [date, setDate] = useState<CalendarDate>(() => today(getLocalTimeZone()));
  const [fromId, setFromId] = useState<string | null>(() => settlementAccount(payment.fromMemberId, all));
  const [toId, setToId] = useState<string | null>(() => settlementAccount(payment.toMemberId, all, fromId));
  const [problem, setProblem] = useState<"amount" | "no_accounts" | "same_member" | null>(null);
  const options = pickable(all).map((a) => ({ id: a.id, label: a.name }));

  const save = useMutation({
    mutationFn: async () => {
      const built = settlementTransfer(
        { ...payment, amountCents: amount ?? 0 },
        {
          id: newId(),
          date: date.toString(),
          accounts: all,
          fromAccountId: fromId,
          toAccountId: toId,
          description: t("balance.settle.description"),
        },
      );
      if (!built.ok) {
        setProblem(built.error);
        return false;
      }
      unwrap(await adapter.put(family.id, "transactions", built.value));
      return true;
    },
    onSuccess: async (saved) => {
      if (!saved) return;
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "transactions") });
      toast.show({ message: t("balance.settle.done") });
      onClose();
    },
  });

  return (
    <Dialog
      title={t("balance.settle.title")}
      isOpen
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      footer={(close) => (
        <>
          <Button variant="secondary" onPress={close}>
            {t("common.cancel")}
          </Button>
          <Button
            isPending={save.isPending}
            onPress={() => {
              save.mutate();
            }}
          >
            {t("balance.settle.save")}
          </Button>
        </>
      )}
    >
      <div className={cx(styles.stack)}>
        <p>
          {t("balance.settle.body", { from: nameOf(payment.fromMemberId), to: nameOf(payment.toMemberId) })}
        </p>
        <MoneyField label={t("tx.amount")} isRequired value={amount} onChange={setAmount} />
        <DatePicker
          label={t("tx.date")}
          value={date}
          onChange={(next) => {
            if (next) setDate(next);
          }}
        />
        <Select
          label={t("tx.fromAccount")}
          options={options}
          value={fromId}
          onChange={(key) => {
            setFromId(key === null ? null : String(key));
          }}
        />
        <Select
          label={t("tx.toAccount")}
          options={options.filter((o) => o.id !== fromId)}
          value={toId}
          onChange={(key) => {
            setToId(key === null ? null : String(key));
          }}
        />
        {problem || save.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {problem === "amount"
              ? t("tx.error.amount")
              : problem === "no_accounts"
                ? t("balance.settle.noAccounts")
                : t("balance.settle.error")}
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}

function PairsCard({
  pairs,
  accountName,
}: {
  readonly pairs: readonly TransferPair<Transaction>[];
  readonly accountName: (id: string) => string;
}) {
  const adapter = useAdapter();
  const { family } = useFamily();
  const client = useQueryClient();
  const toast = useToast();
  const accounts = useCollection(family.id, "accounts");
  const merge = useMutation({
    mutationFn: async (pair: TransferPair<Transaction>) => {
      const doc = mergeTransferPair(pair, newId(), accounts.data ?? []);
      if (!doc) throw new Error("conti della coppia non trovati");
      unwrap(
        await adapter.commit(family.id, [
          { type: "remove", collection: "transactions", id: pair.out.id },
          { type: "remove", collection: "transactions", id: pair.in.id },
          { type: "put", collection: "transactions", doc },
        ]),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "transactions") });
      toast.show({ message: t("balance.merged") });
    },
  });
  return (
    <Card title={t("balance.pairs")} as="section">
      <div className={cx(styles.stack)}>
        <p className={cx(styles.muted)}>{t("balance.pairsHelp")}</p>
        <ul className={cx(local.list)}>
          {pairs.map((pair) => (
            <li key={`${pair.out.id}-${pair.in.id}`} className={cx(local.item)}>
              <span>
                {t("balance.pair", {
                  amount: amountText(cents(pair.out.amountCents)),
                  from: accountName(pair.out.accountId),
                  to: accountName(pair.in.accountId),
                  fromDate: formatDate(asDate(pair.out.date)),
                  toDate: formatDate(asDate(pair.in.date)),
                })}
              </span>
              <Button
                size="sm"
                variant="secondary"
                isPending={merge.isPending && merge.variables === pair}
                onPress={() => {
                  merge.mutate(pair);
                }}
              >
                {t("balance.merge")}
              </Button>
            </li>
          ))}
        </ul>
        {merge.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {t("balance.mergeError")}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
