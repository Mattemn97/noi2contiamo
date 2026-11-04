// Conti (feature 7): comuni e personali, saldo iniziale, saldo calcolato in core da tutti i movimenti visibili.
import { accountBalance, cents, newId, type Account, type Cents, type Transaction } from "@noi2contiamo/core";
import { getLocalTimeZone, parseDate, today, type CalendarDate } from "@internationalized/date";
import { useState, type SyntheticEvent } from "react";
import { useAllDocs, useCollection } from "../../data/queries";
import { t, type MessageKey } from "../../i18n/it";
import {
  Amount,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dialog,
  EmptyState,
  ErrorState,
  MoneyField,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  TextField,
} from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { useFamily } from "../guards";
import list from "./catalog.module.css";
import { ArchiveButton, saveErrorText, useSave } from "./shared";

const KINDS: readonly Account["kind"][] = ["checking", "savings", "cash", "card", "other"];
type Ownership = "shared" | "mine" | "private";

export function ownershipOf(account: Pick<Account, "ownerMemberId" | "visibility">): Ownership {
  if (account.ownerMemberId === null) return "shared";
  return account.visibility === "private" ? "private" : "mine";
}

export function ownershipFields(
  ownership: Ownership,
  meId: string,
): Pick<Account, "ownerMemberId" | "visibility"> {
  if (ownership === "shared") return { ownerMemberId: null, visibility: "shared" };
  return { ownerMemberId: meId, visibility: ownership === "private" ? "private" : "shared" };
}

/** Saldi per conto, dagli stessi movimenti per tutti (calcolo in core). */
export function balances(
  accounts: readonly Account[],
  transactions: readonly Transaction[],
): Map<string, Cents> {
  return new Map(accounts.map((a) => [a.id, accountBalance(a, transactions)]));
}

function AccountForm({
  familyId,
  meId,
  account,
  locked,
  onDone,
}: {
  readonly familyId: string;
  readonly meId: string;
  readonly account: Account | null;
  readonly locked: boolean;
  readonly onDone: () => void;
}) {
  const [name, setName] = useState(account?.name ?? "");
  const [kind, setKind] = useState<Account["kind"]>(account?.kind ?? "checking");
  const [ownership, setOwnership] = useState<Ownership>(account ? ownershipOf(account) : "shared");
  const [initial, setInitial] = useState<Cents | null>(cents(account?.initialBalanceCents ?? 0));
  const [date, setDate] = useState<CalendarDate>(() =>
    account ? parseDate(account.initialBalanceDate) : today(getLocalTimeZone()),
  );
  const [nameError, setNameError] = useState(false);
  const save = useSave(familyId, "accounts", onDone);

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    setNameError(false);
    save.mutate({
      ...(account ?? { id: newId(), order: 0, archivedAtMs: null }),
      name: name.trim(),
      kind,
      ...(locked && account
        ? ownershipFields(ownershipOf(account), account.ownerMemberId ?? meId)
        : ownershipFields(ownership, meId)),
      initialBalanceCents: initial ?? cents(0),
      initialBalanceDate: date.toString(),
    });
  };

  return (
    <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
      <TextField
        label={t("accounts.name")}
        isRequired
        value={name}
        onChange={setName}
        isInvalid={nameError}
        errorMessage={t("catalog.error.name")}
      />
      <Select
        label={t("accounts.kind")}
        options={KINDS.map((k) => ({ id: k, label: t(`accounts.kind.${k}` as MessageKey) }))}
        value={kind}
        onChange={(key) => {
          if (key !== null) setKind(String(key) as Account["kind"]);
        }}
      />
      {locked ? (
        <p className={cx(styles.muted)}>{t("accounts.ownerLocked")}</p>
      ) : (
        <>
          <SegmentedControl<Ownership>
            label={t("accounts.owner")}
            value={ownership}
            onChange={setOwnership}
            options={[
              { id: "shared", label: t("accounts.owner.shared") },
              { id: "mine", label: t("accounts.owner.mine") },
              { id: "private", label: t("accounts.owner.private") },
            ]}
          />
          <p className={cx(styles.muted)}>{t("accounts.ownerHelp")}</p>
        </>
      )}
      <MoneyField
        label={t("accounts.initialBalance")}
        description={t("accounts.initialBalanceHelp")}
        value={initial}
        onChange={setInitial}
      />
      <DatePicker
        label={t("accounts.initialBalanceDate")}
        value={date}
        onChange={(next) => {
          if (next) setDate(next);
        }}
      />
      {save.isError ? (
        <p role="alert" className={cx(styles.error)}>
          {saveErrorText(save.error)}
        </p>
      ) : null}
      <div className={cx(styles.actions)}>
        <Button type="submit" isPending={save.isPending}>
          {t("catalog.save")}
        </Button>
        <Button variant="ghost" onPress={onDone}>
          {t("common.cancel")}
        </Button>
      </div>
    </form>
  );
}

export function AccountsPage() {
  const { family, memberId } = useFamily();
  const accounts = useCollection(family.id, "accounts");
  const transactions = useAllDocs(family.id, "transactions");
  const members = useCollection(family.id, "members");
  const [editing, setEditing] = useState<Account | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (accounts.isPending || transactions.isPending) return <Skeleton lines={6} />;
  if (accounts.isError || transactions.isError)
    return <ErrorState onRetry={() => void Promise.all([accounts.refetch(), transactions.refetch()])} />;

  const byId = balances(accounts.data, transactions.data);
  const shown = accounts.data.filter((a) => showArchived || a.archivedAtMs === null);
  const active = accounts.data.filter((a) => a.archivedAtMs === null);
  const total = cents(active.reduce((sum, a) => sum + (byId.get(a.id) ?? 0), 0));
  const memberName = (id: string) => members.data?.find((m) => m.id === id)?.displayName ?? "";
  const used = (id: string) => transactions.data.some((tx) => tx.accountId === id || tx.toAccountId === id);
  const current = editing === "new" ? null : editing;

  return (
    <>
      <PageHeader title={t("accounts.title")} subtitle={t("accounts.subtitle")} />
      <Card
        actions={
          <Button
            size="sm"
            onPress={() => {
              setEditing("new");
            }}
          >
            {t("accounts.add")}
          </Button>
        }
      >
        <div className={cx(styles.stack)}>
          <Checkbox isSelected={showArchived} onChange={setShowArchived}>
            {t("catalog.showArchived")}
          </Checkbox>
          {shown.length === 0 ? (
            <EmptyState title={t("accounts.empty")} />
          ) : (
            <ul className={cx(list.list)}>
              {shown.map((account) => (
                <li key={account.id} className={cx(list.row)}>
                  <div className={cx(list.who)}>
                    <span className={cx(list.name)}>{account.name}</span>
                    <span className={cx(list.meta)}>
                      {t(`accounts.kind.${account.kind}` as MessageKey)} ·{" "}
                      {account.ownerMemberId === null
                        ? t("accounts.owner.shared")
                        : t("accounts.ownerOf", { name: memberName(account.ownerMemberId) })}
                      {account.visibility === "private" ? ` · ${t("accounts.private")}` : ""}
                      {account.archivedAtMs !== null ? ` · ${t("catalog.archived")}` : ""}
                    </span>
                  </div>
                  <div className={cx(list.end)}>
                    <span aria-label={`${t("accounts.balance")} ${account.name}`}>
                      <Amount value={byId.get(account.id) ?? cents(0)} />
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        setEditing(account);
                      }}
                    >
                      {t("catalog.edit")}
                    </Button>
                    <ArchiveButton familyId={family.id} collection="accounts" doc={account} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className={cx(list.total)}>
            <span>{t("accounts.total")}</span>
            <Amount value={total} />
          </p>
        </div>
      </Card>
      <Dialog
        title={t(current ? "accounts.editTitle" : "accounts.new")}
        isOpen={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <AccountForm
          key={current?.id ?? "new"}
          familyId={family.id}
          meId={memberId}
          account={current}
          locked={
            current !== null &&
            (used(current.id) || (current.ownerMemberId !== null && current.ownerMemberId !== memberId))
          }
          onDone={() => {
            setEditing(null);
          }}
        />
      </Dialog>
    </>
  );
}
