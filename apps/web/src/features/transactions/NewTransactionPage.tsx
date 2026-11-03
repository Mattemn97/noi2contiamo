// Nuovo movimento o modifica di uno esistente (spesa, entrata o giroconto); divisione dalla categoria o dalla famiglia.
import {
  newId,
  pickable,
  sameShares,
  soloSplit,
  type Account,
  type Cents,
  type Member,
  type Transaction,
} from "@noi2contiamo/core";
import { getLocalTimeZone, parseDate, today, type CalendarDate } from "@internationalized/date";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap, useCollection } from "../../data/queries";
import { t, type MessageKey } from "../../i18n/it";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ComboBox,
  DatePicker,
  ErrorState,
  MoneyField,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  TextField,
  useToast,
} from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { useFamily } from "../guards";
import { categoryLabel } from "../catalog/CategoriesPage";
import { amountsText, splitMembers, SplitEditor } from "../split/SplitEditor";
import {
  buildTransaction,
  buildTransfer,
  draftOf,
  transferDraftOf,
  previewAutoSplit,
  resolvePayee,
  type DraftError,
  type EntryType,
  type SplitDraft,
} from "./newTransaction";
import { useDeleteTransaction } from "./useDeleteTransaction";

const ERROR_KEYS: Readonly<Record<DraftError, MessageKey>> = {
  amount: "tx.error.amount",
  category: "tx.error.category",
  account: "tx.error.account",
  split: "tx.error.split",
  toAccount: "tx.error.toAccount",
  sameAccount: "tx.error.sameAccount",
};

type FormType = EntryType | "transfer";

type SplitSourceKey =
  "split.source.category" | "split.source.default" | "split.source.owner" | "split.source.rule";

/** Da dove viene la divisione automatica, per la frase "In automatico: ...". */
export function autoSourceKey(
  split: NonNullable<Transaction["split"]>,
  type: EntryType,
  account: Pick<Account, "ownerMemberId"> | undefined,
): SplitSourceKey {
  if (split.source === "category") return "split.source.category";
  if (split.source === "rule") return "split.source.rule";
  const owner = account?.ownerMemberId;
  if (type === "income" && owner && sameShares(split, soloSplit(owner))) return "split.source.owner";
  return "split.source.default";
}

function SplitSection({
  members,
  manual,
  onManual,
  auto,
  autoKey,
  isPrivate,
  amountCents,
  invalid,
}: {
  readonly members: readonly Member[];
  readonly manual: SplitDraft | null;
  readonly onManual: (next: SplitDraft | null) => void;
  readonly auto: NonNullable<Transaction["split"]> | null;
  readonly autoKey: SplitSourceKey;
  readonly isPrivate: boolean;
  readonly amountCents: number | null;
  readonly invalid: boolean;
}) {
  const nameOf = (id: string) => members.find((m) => m.id === id)?.displayName ?? id;
  return (
    <fieldset className={cx(styles.stack)}>
      <legend>{t("split.title")}</legend>
      {isPrivate ? (
        <p className={cx(styles.muted)}>{t("split.private")}</p>
      ) : manual ? (
        <>
          <SplitEditor
            members={members}
            value={manual}
            onChange={onManual}
            amountCents={amountCents}
            allowCents
          />
          {invalid ? (
            <p role="alert" className={cx(styles.error)}>
              {t("tx.error.split")}
            </p>
          ) : null}
          <div className={cx(styles.actions)}>
            <Button
              size="sm"
              variant="ghost"
              onPress={() => {
                onManual(null);
              }}
            >
              {t("split.backToAuto")}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className={cx(styles.muted)}>
            {t("split.auto", { source: t(autoKey) })}
            {auto && amountCents !== null && amountCents > 0
              ? ` ${amountsText(amountCents, auto, nameOf)}`
              : ""}
          </p>
          <div className={cx(styles.actions)}>
            <Button
              size="sm"
              variant="secondary"
              onPress={() => {
                const start: SplitDraft = auto ?? { kind: "bp", shares: {} };
                const rows = splitMembers(members, start.shares);
                onManual({
                  kind: start.kind,
                  shares: Object.fromEntries(rows.map((m) => [m.id, start.shares[m.id] ?? 0])),
                });
              }}
            >
              {t("split.edit")}
            </Button>
          </div>
        </>
      )}
    </fieldset>
  );
}

/** Dove tornare dopo salva, annulla o elimina: il registro con i filtri da cui si è partiti. */
export function backTo(state: unknown): string {
  const back = (state as { back?: unknown } | null)?.back;
  return typeof back === "string" && back.startsWith("/movimenti") ? back : "/movimenti";
}

export function NewTransactionPage() {
  return <TransactionForm />;
}

/** `/movimenti/:id`: lo stesso modulo, già compilato, più "Elimina". */
export function EditTransactionPage() {
  const adapter = useAdapter();
  const { family } = useFamily();
  const { id = "" } = useParams();
  const tx = useQuery({
    queryKey: [...keys.collection(family.id, "transactions"), "doc", id],
    queryFn: async () => unwrap(await adapter.get(family.id, "transactions", id)),
    retry: false,
  });
  // Il nome del destinatario serve già al primo disegno del modulo.
  const payees = useCollection(family.id, "payees");
  if (tx.isPending || payees.isPending) return <Skeleton lines={6} />;
  if (tx.isError)
    return (
      <>
        <PageHeader title={t("tx.edit.title")} subtitle={family.name} />
        <Card>
          <EmptyState title={t("tx.edit.notFound.title")} description={t("tx.edit.notFound.body")} />
        </Card>
      </>
    );
  return <TransactionForm key={tx.data.id} existing={tx.data} />;
}

function TransactionForm({ existing }: { readonly existing?: Transaction }) {
  const adapter = useAdapter();
  const { family } = useFamily();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const accounts = useCollection(family.id, "accounts");
  const categories = useCollection(family.id, "categories");
  const payees = useCollection(family.id, "payees");
  const members = useCollection(family.id, "members");

  const initial = existing ? (draftOf(existing) ?? transferDraftOf(existing)) : null;
  const initialTransfer = existing ? transferDraftOf(existing) : null;
  const [type, setType] = useState<FormType>(existing?.type ?? "expense");
  const [toAccountId, setToAccountId] = useState<string | null>(initialTransfer?.toAccountId ?? null);
  const [amountCents, setAmountCents] = useState<Cents | null>(
    (initial?.amountCents as Cents | undefined) ?? null,
  );
  const [date, setDate] = useState<CalendarDate>(() =>
    initial ? parseDate(initial.date) : today(getLocalTimeZone()),
  );
  const [categoryId, setCategoryId] = useState<string | null>(
    initial && "categoryId" in initial ? initial.categoryId : null,
  );
  const [chosenAccountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [description, setDescription] = useState(initial?.description ?? "");
  const entryInitial = existing ? draftOf(existing) : null;
  const [payeeText, setPayeeText] = useState(
    () => (payees.data ?? []).find((p) => p.id === entryInitial?.payeeId)?.name ?? "",
  );
  const [manualSplit, setManualSplit] = useState<SplitDraft | null>(entryInitial?.split ?? null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // Il registro passa i suoi filtri nello state: si torna lì com'era.
  const location = useLocation();
  const back = backTo(location.state);
  const remove = useDeleteTransaction(family.id, () => void navigate(back));
  const [errors, setErrors] = useState<readonly DraftError[]>([]);

  const activeAccounts = pickable(accounts.data ?? [], chosenAccountId);
  const accountId = chosenAccountId ?? activeAccounts[0]?.id ?? null;
  const allCategories = categories.data ?? [];
  const categoryOptions = pickable(allCategories, categoryId)
    .filter((c) => c.kind === type)
    .map((c) => ({ id: c.id, label: categoryLabel(c, allCategories) }))
    .sort((a, b) => a.label.localeCompare(b.label, "it"));
  const payeeOptions = pickable(payees.data ?? []).map((p) => ({ id: p.id, label: p.name }));

  const save = useMutation({
    mutationFn: async () => {
      if (type === "transfer") {
        const built = buildTransfer(
          { amountCents, date: date.toString(), accountId, toAccountId, description },
          { id: newId(), accounts: accounts.data ?? [], ...(existing ? { existing } : {}) },
        );
        if (!built.ok) {
          setErrors(built.error);
          return false;
        }
        setErrors([]);
        unwrap(await adapter.put(family.id, "transactions", built.value));
        return true;
      }
      const payee = resolvePayee(payeeText, payees.data ?? [], newId);
      const built = buildTransaction(
        {
          type,
          amountCents,
          date: date.toString(),
          categoryId,
          accountId,
          description,
          payeeId: payee.payeeId,
          split: manualSplit,
        },
        {
          id: newId(),
          family,
          accounts: accounts.data ?? [],
          categories: categories.data ?? [],
          ...(existing ? { existing } : {}),
        },
      );
      if (!built.ok) {
        setErrors(built.error);
        return false;
      }
      setErrors([]);
      // Destinatario nuovo e movimento insieme: o tutti e due o nessuno.
      unwrap(
        await adapter.commit(family.id, [
          ...(payee.create
            ? [{ type: "put" as const, collection: "payees" as const, doc: payee.create }]
            : []),
          { type: "put", collection: "transactions", doc: built.value },
        ]),
      );
      return true;
    },
    onSuccess: async (saved) => {
      if (!saved) return;
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "transactions") });
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "payees") });
      toast.show({ message: t(existing ? "tx.updated" : "tx.saved") });
      // Dopo una modifica si torna al registro con i suoi filtri; dopo un nuovo movimento al registro.
      await navigate(existing ? back : "/movimenti");
    },
  });

  if (accounts.isPending || categories.isPending || payees.isPending || members.isPending)
    return <Skeleton lines={6} />;
  if (accounts.isError || categories.isError || payees.isError || members.isError)
    return (
      <ErrorState
        onRetry={() =>
          void Promise.all([accounts.refetch(), categories.refetch(), payees.refetch(), members.refetch()])
        }
      />
    );

  const draftCtx = {
    id: "",
    family,
    accounts: accounts.data,
    categories: categories.data,
    ...(existing ? { existing } : {}),
  };
  const account = accounts.data.find((a) => a.id === accountId);
  const entryType: EntryType = type === "transfer" ? "expense" : type;
  const autoSplit = previewAutoSplit({ type: entryType, categoryId, accountId }, draftCtx);

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <>
      <PageHeader title={t(existing ? "tx.edit.title" : "tx.new.title")} subtitle={family.name} />
      <Card>
        <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
          <SegmentedControl<FormType>
            label={t("tx.type")}
            value={type}
            onChange={(next) => {
              setType(next);
              setCategoryId(null);
            }}
            options={[
              { id: "expense", label: t("tx.type.expense") },
              { id: "income", label: t("tx.type.income") },
              { id: "transfer", label: t("tx.type.transfer") },
            ]}
          />
          <MoneyField label={t("tx.amount")} isRequired value={amountCents} onChange={setAmountCents} />
          <DatePicker
            label={t("tx.date")}
            value={date}
            onChange={(next) => {
              if (next) setDate(next);
            }}
          />
          {type === "transfer" ? (
            <>
              <Select
                label={t("tx.fromAccount")}
                options={activeAccounts.map((a) => ({ id: a.id, label: a.name }))}
                value={accountId}
                onChange={(key) => {
                  setAccountId(key === null ? null : String(key));
                }}
                isInvalid={errors.includes("account") || errors.includes("sameAccount")}
                errorMessage={t(errors.includes("sameAccount") ? "tx.error.sameAccount" : "tx.error.account")}
              />
              <Select
                label={t("tx.toAccount")}
                options={pickable(accounts.data, toAccountId)
                  .filter((a) => a.id !== accountId)
                  .map((a) => ({ id: a.id, label: a.name }))}
                value={toAccountId}
                onChange={(key) => {
                  setToAccountId(key === null ? null : String(key));
                }}
                isInvalid={errors.includes("toAccount")}
                errorMessage={t("tx.error.toAccount")}
              />
              <p className={cx(styles.muted)}>{t("tx.transferHelp")}</p>
              <TextField
                label={t("tx.description")}
                placeholder={t("tx.descriptionPlaceholder")}
                value={description}
                onChange={setDescription}
              />
            </>
          ) : (
            <>
              <Select
                label={t("tx.category")}
                options={categoryOptions}
                value={categoryId}
                onChange={(key) => {
                  setCategoryId(key === null ? null : String(key));
                }}
                isInvalid={errors.includes("category")}
                errorMessage={t("tx.error.category")}
              />
              <Select
                label={t("tx.account")}
                options={activeAccounts.map((a) => ({ id: a.id, label: a.name }))}
                value={accountId}
                onChange={(key) => {
                  setAccountId(key === null ? null : String(key));
                }}
                isInvalid={errors.includes("account")}
                errorMessage={t("tx.error.account")}
              />
              <ComboBox
                label={t("tx.payee")}
                description={t("tx.payeeHelp")}
                options={payeeOptions}
                allowsCustomValue
                inputValue={payeeText}
                onInputChange={setPayeeText}
              />
              <TextField
                label={t("tx.description")}
                placeholder={t("tx.descriptionPlaceholder")}
                value={description}
                onChange={setDescription}
              />
              <SplitSection
                members={members.data}
                manual={manualSplit}
                onManual={setManualSplit}
                auto={autoSplit}
                autoKey={autoSplit ? autoSourceKey(autoSplit, entryType, account) : "split.source.default"}
                isPrivate={account?.visibility === "private"}
                amountCents={amountCents}
                invalid={errors.includes("split")}
              />
            </>
          )}
          {errors.length > 0 || save.isError ? (
            <ul role="alert" className={cx(styles.error)}>
              {errors.map((e) => (
                <li key={e}>{t(ERROR_KEYS[e])}</li>
              ))}
              {save.isError ? <li>{t("tx.error.save")}</li> : null}
            </ul>
          ) : null}
          <div className={cx(styles.actions)}>
            <Button type="submit" isPending={save.isPending}>
              {t("tx.save")}
            </Button>
            <Button variant="ghost" onPress={() => void navigate(back)}>
              {t("common.cancel")}
            </Button>
            {existing ? (
              <Button
                variant="danger"
                isPending={remove.isPending}
                onPress={() => {
                  setConfirmDelete(true);
                }}
              >
                {t("common.delete")}
              </Button>
            ) : null}
          </div>
          {remove.isError ? (
            <p role="alert" className={cx(styles.error)}>
              {t("tx.error.delete")}
            </p>
          ) : null}
        </form>
      </Card>
      {existing ? (
        <ConfirmDialog
          title={t("tx.delete.title")}
          message={t("tx.delete.body")}
          isOpen={confirmDelete}
          onOpenChange={setConfirmDelete}
          onConfirm={() => {
            remove.mutate(existing.id);
          }}
        />
      ) : null}
    </>
  );
}
