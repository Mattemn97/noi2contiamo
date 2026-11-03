// `/ricorrenti/nuova` e `/ricorrenti/:id` (spec 0008, AC-11, AC-8): editor con validazione in italiano,
// archivia ed elimina. Da un suggerimento accettato collega i movimenti trovati nello stesso commit.
import { getLocalTimeZone, parseDate, today as todayDate, type CalendarDate } from "@internationalized/date";
import {
  autoLinks,
  newId,
  pickable,
  recurrenceFromSuggestion,
  unlinkTransaction,
  type RecurrenceDraft,
} from "@noi2contiamo/core";
import type { CommitOp } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type SyntheticEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Button,
  Card,
  ConfirmDialog,
  DatePicker,
  ErrorState,
  MoneyField,
  PageHeader,
  PercentField,
  Select,
  SegmentedControl,
  Skeleton,
  Switch,
  TextField,
  useToast,
} from "../../ui";
import { cx } from "../../ui/cx";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import {
  PRESETS,
  emptyForm,
  formIssues,
  formOf,
  recurrenceOf,
  type Preset,
  type RecurrenceForm,
} from "./recurringForm";
import { useRecurringData, writableRec, writableTx, type RecurringData } from "./useRecurring";

const NONE = "none";
const withNone = (options: readonly { id: string; label: string }[]) => [
  { id: NONE, label: t("rec.none") },
  ...options,
];

export function RecurrenceEditorPage() {
  const { data, isError, refetch } = useRecurringData();
  if (isError) return <ErrorState description={t("rec.error.load")} onRetry={refetch} />;
  if (!data) return <Skeleton lines={8} />;
  return <Editor data={data} />;
}

function Editor({ data }: { readonly data: RecurringData }) {
  const { family } = useFamily();
  const { id = "nuova" } = useParams();
  const [params] = useSearchParams();
  const adapter = useAdapter();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const existing = data.recurrences.find((r) => r.id === id) ?? null;
  const suggestion = existing
    ? null
    : (data.suggestions.find((s) => s.key === params.get("suggerimento")) ?? null);
  const base: RecurrenceDraft | null = existing ?? (suggestion ? recurrenceFromSuggestion(suggestion) : null);
  const firstAccount = pickable(data.accounts)[0]?.id ?? null;
  const [recId] = useState(() => existing?.id ?? newId());
  const [form, setForm] = useState<RecurrenceForm>(() =>
    base ? formOf(base) : emptyForm(data.today, firstAccount),
  );
  const [errors, setErrors] = useState<readonly string[]>([]);
  const [deleting, setDeleting] = useState(false);
  const set = (patch: Partial<RecurrenceForm>) => {
    setForm((f) => ({ ...f, ...patch }));
  };

  const write = useMutation({
    mutationFn: async ({ ops }: { ops: CommitOp[]; message: string }) => {
      unwrap(await adapter.commit(family.id, ops));
    },
    onSuccess: async (_v, { message }) => {
      await client.invalidateQueries({ queryKey: keys.family(family.id) });
      toast.show({ message });
      await navigate("/ricorrenti");
    },
  });

  const ctx = {
    accounts: data.accounts,
    categories: data.categories,
    payees: data.payees,
    activeMemberIds: new Set(data.members.filter((m) => m.leftAtMs === null).map((m) => m.id)),
  };

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    const issues = formIssues(form, recId, ctx);
    setErrors(issues);
    if (issues.length > 0) return;
    const doc = recurrenceOf(form, recId, base);
    const ops: CommitOp[] = [{ type: "put", collection: "recurrences", doc }];
    if (suggestion) {
      const found = new Set(suggestion.transactionIds);
      const candidates = data.txs.filter((tx) => found.has(tx.id));
      for (const tx of autoLinks(doc, candidates, data.today))
        ops.push({ type: "put", collection: "transactions", doc: writableTx(tx) });
    }
    write.mutate({ ops, message: t("rec.saved") });
  };

  const archive = () => {
    if (!existing) return;
    const archivedAtMs = existing.archivedAtMs === null ? Date.now() : null;
    write.mutate({
      ops: [{ type: "put", collection: "recurrences", doc: writableRec({ ...existing, archivedAtMs }) }],
      message: t("rec.saved"),
    });
  };

  const remove = () => {
    if (!existing) return;
    const ops: CommitOp[] = data.txs
      .filter((tx) => tx.recurrenceId === existing.id)
      .map((tx) => ({ type: "put", collection: "transactions", doc: writableTx(unlinkTransaction(tx)) }));
    ops.push({ type: "remove", collection: "recurrences", id: existing.id });
    write.mutate({ ops, message: t("rec.deleted") });
  };

  const accountOptions = pickable(data.accounts, form.accountId).map((a) => ({ id: a.id, label: a.name }));
  const categoryOptions = pickable(data.categories, form.categoryId)
    .filter((c) => c.kind === form.type)
    .map((c) => ({ id: c.id, label: c.name }));
  const payeeOptions = pickable(data.payees, form.payeeId).map((p) => ({ id: p.id, label: p.name }));
  const pick = (key: string | number | null) => (key === null || key === NONE ? null : String(key));
  const date = (iso: string): CalendarDate => {
    try {
      return parseDate(iso);
    } catch {
      return todayDate(getLocalTimeZone());
    }
  };

  return (
    <>
      <PageHeader title={existing ? existing.name : t("rec.add")} />
      <Card>
        <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
          <TextField
            label={t("rec.name")}
            isRequired
            value={form.name}
            onChange={(name) => {
              set({ name });
            }}
          />
          <SegmentedControl
            label={t("rec.type")}
            value={form.type}
            onChange={(type) => {
              set({ type, categoryId: null, toAccountId: null });
            }}
            options={[
              { id: "expense", label: t("tx.type.expense") },
              { id: "income", label: t("tx.type.income") },
              { id: "transfer", label: t("tx.type.transfer") },
            ]}
          />
          <MoneyField
            label={t("rec.amount")}
            isRequired
            value={form.amountCents}
            onChange={(amountCents) => {
              set({ amountCents });
            }}
          />
          <Switch
            isSelected={form.fixed}
            onChange={(fixed) => {
              set({ fixed });
            }}
          >
            {t("rec.fixed")}
          </Switch>
          {form.fixed ? null : (
            <PercentField
              label={t("rec.tolerance")}
              value={form.toleranceBp}
              onChange={(toleranceBp) => {
                set({ toleranceBp });
              }}
            />
          )}
          <Select
            label={form.type === "transfer" ? t("tx.fromAccount") : t("tx.account")}
            options={accountOptions}
            value={form.accountId}
            onChange={(key) => {
              set({ accountId: pick(key) });
            }}
          />
          {form.type === "transfer" ? (
            <Select
              label={t("rec.toAccount")}
              options={accountOptions.filter((a) => a.id !== form.accountId)}
              value={form.toAccountId}
              onChange={(key) => {
                set({ toAccountId: pick(key) });
              }}
            />
          ) : (
            <Select
              label={t("tx.category")}
              options={withNone(categoryOptions)}
              value={form.categoryId ?? NONE}
              onChange={(key) => {
                set({ categoryId: pick(key) });
              }}
            />
          )}
          <Select
            label={t("tx.payee")}
            options={withNone(payeeOptions)}
            value={form.payeeId ?? NONE}
            onChange={(key) => {
              set({ payeeId: pick(key) });
            }}
          />
          <Select
            label={t("rec.preset")}
            options={PRESETS.map((p) => ({ id: p, label: t(`rec.preset.${p}`) }))}
            value={form.preset}
            onChange={(key) => {
              set({ preset: String(key) as Preset });
            }}
          />
          {form.preset === "custom" ? (
            <>
              <Select
                label={t("rec.unit")}
                options={(["day", "week", "month", "year"] as const).map((u) => ({
                  id: u,
                  label: t(`rec.unit.${u}`),
                }))}
                value={form.unit}
                onChange={(key) => {
                  set({ unit: String(key) as RecurrenceForm["unit"] });
                }}
              />
              <TextField
                label={t("rec.interval")}
                inputMode="numeric"
                value={form.interval}
                onChange={(interval) => {
                  set({ interval });
                }}
              />
            </>
          ) : null}
          <DatePicker
            label={t("rec.startDate")}
            value={date(form.startDate)}
            onChange={(next) => {
              if (next) set({ startDate: next.toString() });
            }}
          />
          {(form.preset === "custom" ? form.unit : PRESET_UNIT(form.preset)) === "month" ||
          (form.preset === "custom" ? form.unit : PRESET_UNIT(form.preset)) === "year" ? (
            <TextField
              label={t("rec.dayOfMonth")}
              description={t("rec.dayOfMonthHelp")}
              inputMode="numeric"
              value={form.dayOfMonth}
              onChange={(dayOfMonth) => {
                set({ dayOfMonth });
              }}
            />
          ) : null}
          <DatePicker
            label={t("rec.endDate")}
            value={form.endDate === null ? null : date(form.endDate)}
            onChange={(next) => {
              set({ endDate: next ? next.toString() : null });
            }}
          />
          <TextField
            label={t("rec.count")}
            inputMode="numeric"
            value={form.count}
            onChange={(count) => {
              set({ count });
            }}
          />
          <TextField
            label={t("rec.window")}
            inputMode="numeric"
            value={form.windowDays}
            onChange={(windowDays) => {
              set({ windowDays });
            }}
          />
          {errors.length > 0 || write.isError ? (
            <ul role="alert" className={cx(styles.error)}>
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
              {write.isError ? <li>{t("rec.error.save")}</li> : null}
            </ul>
          ) : null}
          <div className={cx(styles.actions)}>
            <Button variant="ghost" onPress={() => void navigate("/ricorrenti")}>
              {t("common.cancel")}
            </Button>
            {existing ? (
              <>
                <Button variant="secondary" onPress={archive}>
                  {existing.archivedAtMs === null ? t("rec.archive") : t("rec.unarchive")}
                </Button>
                <Button
                  variant="ghost"
                  onPress={() => {
                    setDeleting(true);
                  }}
                >
                  {t("common.delete")}
                </Button>
              </>
            ) : null}
            <Button type="submit" isDisabled={write.isPending}>
              {t("rec.save")}
            </Button>
          </div>
        </form>
      </Card>
      <ConfirmDialog
        title={t("rec.delete.title")}
        message={t("rec.delete.body", { name: existing?.name ?? "" })}
        confirmLabel={t("common.delete")}
        isOpen={deleting}
        onOpenChange={setDeleting}
        onConfirm={() => {
          setDeleting(false);
          remove();
        }}
      />
    </>
  );
}

function PRESET_UNIT(preset: Preset): "week" | "month" | "year" {
  return preset === "week" ? "week" : preset === "year" ? "year" : "month";
}
