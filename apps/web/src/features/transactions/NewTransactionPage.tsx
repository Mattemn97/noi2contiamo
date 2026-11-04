// Nuovo movimento o modifica di uno esistente (spesa o entrata); divisione dalla categoria o dalla famiglia.
import { newId, pickable, type Cents, type Transaction } from "@noi2contiamo/core";
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
import { buildTransaction, draftOf, resolvePayee, type DraftError, type EntryType } from "./newTransaction";
import { useDeleteTransaction } from "./useDeleteTransaction";

const ERROR_KEYS: Readonly<Record<DraftError, MessageKey>> = {
  amount: "tx.error.amount",
  category: "tx.error.category",
  account: "tx.error.account",
};

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
  if (tx.data.type === "transfer")
    return (
      <>
        <PageHeader title={t("tx.edit.title")} subtitle={family.name} />
        <Card>
          <EmptyState title={t("tx.edit.transfer.title")} description={t("tx.edit.transfer.body")} />
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

  const initial = existing ? draftOf(existing) : null;
  const [type, setType] = useState<EntryType>(initial?.type ?? "expense");
  const [amountCents, setAmountCents] = useState<Cents | null>(
    (initial?.amountCents as Cents | undefined) ?? null,
  );
  const [date, setDate] = useState<CalendarDate>(() =>
    initial ? parseDate(initial.date) : today(getLocalTimeZone()),
  );
  const [categoryId, setCategoryId] = useState<string | null>(initial?.categoryId ?? null);
  const [chosenAccountId, setAccountId] = useState<string | null>(initial?.accountId ?? null);
  const [description, setDescription] = useState(initial?.description ?? "");
  const [payeeText, setPayeeText] = useState(
    () => (payees.data ?? []).find((p) => p.id === initial?.payeeId)?.name ?? "",
  );
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

  if (accounts.isPending || categories.isPending || payees.isPending) return <Skeleton lines={6} />;
  if (accounts.isError || categories.isError || payees.isError)
    return (
      <ErrorState
        onRetry={() => void Promise.all([accounts.refetch(), categories.refetch(), payees.refetch()])}
      />
    );

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    save.mutate();
  };

  return (
    <>
      <PageHeader title={t(existing ? "tx.edit.title" : "tx.new.title")} subtitle={family.name} />
      <Card>
        <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
          <SegmentedControl<EntryType>
            label={t("tx.type")}
            value={type}
            onChange={(next) => {
              setType(next);
              setCategoryId(null);
            }}
            options={[
              { id: "expense", label: t("tx.type.expense") },
              { id: "income", label: t("tx.type.income") },
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
