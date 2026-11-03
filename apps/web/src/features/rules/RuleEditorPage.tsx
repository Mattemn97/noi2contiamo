// `/altro/regole/:id` e `/altro/regole/nuova` (anche `?movimento=<id>`): editor della regola con anteprima
// dal vivo e "Applica ai movimenti esistenti" (spec 0007, AC-10..AC-13).
import {
  newId,
  nextRuleOrder,
  payeeNameFromDescription,
  pickable,
  ruleFromTransaction,
  ruleIssues,
  ruleSchema,
  type RuleLike,
} from "@noi2contiamo/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type SyntheticEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Button,
  Card,
  Checkbox,
  ComboBox,
  EmptyState,
  ErrorState,
  MoneyField,
  PageHeader,
  SegmentedControl,
  Select,
  Skeleton,
  Switch,
  TextField,
  useToast,
} from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { categoryLabel } from "../catalog/CategoriesPage";
import { useFamily } from "../guards";
import { SplitEditor } from "../split/SplitEditor";
import { ApplyRulesButton } from "./ApplyRulesButton";
import { emptyForm, formOf, ruleOf, type DescOp, type EntryKind, type RuleFormState } from "./ruleForm";
import { RulePreview } from "./RulePreview";
import { useRuleEngine, type RuleEngine } from "./useRules";
import own from "./rules.module.css";

const NONE = "__none__";

export function RuleEditorPage() {
  const { id = "nuova" } = useParams();
  const [search] = useSearchParams();
  const txId = search.get("movimento");
  const adapter = useAdapter();
  const { family } = useFamily();
  const { engine, isError, refetch } = useRuleEngine();
  const tx = useQuery({
    queryKey: [...keys.collection(family.id, "transactions"), "doc", txId ?? ""],
    queryFn: async () => unwrap(await adapter.get(family.id, "transactions", txId ?? "")),
    enabled: txId !== null && id === "nuova",
    retry: false,
  });
  if (isError) return <ErrorState onRetry={refetch} />;
  if (!engine || (txId !== null && id === "nuova" && tx.isPending)) return <Skeleton lines={8} />;
  const memberIds = engine.members.filter((m) => m.leftAtMs === null).map((m) => m.id);
  if (id !== "nuova") {
    const rule = engine.rules.find((r) => r.id === id);
    if (!rule)
      return (
        <>
          <PageHeader title={t("rules.editTitle")} />
          <Card>
            <EmptyState title={t("rules.notFound")} />
          </Card>
        </>
      );
    return (
      <RuleForm
        key={rule.id}
        engine={engine}
        base={{ id: rule.id, order: rule.order }}
        initial={formOf(rule, engine.payees, memberIds)}
        saved={rule}
      />
    );
  }
  const fromTx = tx.data ? ruleFromTransaction(tx.data, engine.payees) : null;
  return (
    <RuleForm
      key="new"
      engine={engine}
      base={{ id: newId(), order: nextRuleOrder(engine.rules) }}
      initial={
        fromTx ? formOf(fromTx.rule, engine.payees, memberIds, fromTx.newPayeeName) : emptyForm(memberIds)
      }
      saved={null}
    />
  );
}

function toggle<T>(list: readonly T[], item: T, on: boolean): T[] {
  return on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);
}

function RuleForm({
  engine,
  base,
  initial,
  saved,
}: {
  readonly engine: RuleEngine;
  readonly base: { readonly id: string; readonly order: number };
  readonly initial: RuleFormState;
  readonly saved: RuleLike | null;
}) {
  const adapter = useAdapter();
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { family } = useFamily();
  const [form, setForm] = useState(initial);
  const [showIssues, setShowIssues] = useState(false);
  const set = <K extends keyof RuleFormState>(key: K, value: RuleFormState[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const built = useMemo(() => ruleOf(form, base, engine.payees, newId), [form, base, engine.payees]);
  // Per l'anteprima un destinatario nuovo non esiste ancora: si prova senza quell'azione.
  const previewDoc = useMemo((): RuleLike | null => {
    const doc = built.createPayee
      ? { ...built.rule, actions: { ...built.rule.actions, payeeId: undefined } }
      : built.rule;
    const parsed = ruleSchema
      .omit({ createdAtMs: true, createdByMemberId: true, updatedAtMs: true, updatedByMemberId: true })
      .safeParse(JSON.parse(JSON.stringify(doc)));
    return parsed.success ? { ...parsed.data, enabled: true } : null;
  }, [built]);
  const ctxWithNewPayee = useMemo(
    () => ({
      ...engine.ctx,
      payees: built.createPayee ? [...engine.ctx.payees, { id: built.createPayee.id }] : engine.ctx.payees,
    }),
    [engine.ctx, built.createPayee],
  );
  const issues = ruleIssues(built.rule, ctxWithNewPayee);

  const save = useMutation({
    mutationFn: async () => {
      unwrap(
        await adapter.commit(family.id, [
          ...(built.createPayee
            ? [{ type: "put" as const, collection: "payees" as const, doc: built.createPayee }]
            : []),
          { type: "put", collection: "rules", doc: built.rule },
        ]),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "rules") });
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "payees") });
      toast.show({ message: t("rules.saved") });
      await navigate("/altro/regole");
    },
  });
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (issues.length > 0) {
      setShowIssues(true);
      return;
    }
    save.mutate();
  };

  const accounts = pickable(engine.accounts);
  const categories = pickable(engine.categories, form.categoryId)
    .filter((c) => form.types.length !== 1 || c.kind === form.types[0])
    .map((c) => ({ id: c.id, label: categoryLabel(c, engine.categories) }))
    .sort((a, b) => a.label.localeCompare(b.label, "it"));
  const payeeOptions = pickable(engine.payees).map((p) => ({ id: p.id, label: p.name }));
  const activeMembers = engine.members.filter((m) => m.leftAtMs === null);
  const suggestedPayee = form.descOp !== "none" ? payeeNameFromDescription(form.descValue) : null;

  return (
    <>
      <PageHeader title={t(saved ? "rules.editTitle" : "rules.new")} subtitle={family.name} />
      <div className={cx(styles.stack)}>
        <Card>
          <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
            <TextField
              label={t("rules.name")}
              isRequired
              value={form.name}
              onChange={(v) => {
                set("name", v);
              }}
            />
            <Switch
              isSelected={form.enabled}
              onChange={(v) => {
                set("enabled", v);
              }}
            >
              {t("rules.enabled")}
            </Switch>
            <fieldset className={cx(styles.stack)}>
              <legend>{t("rules.when")}</legend>
              <SegmentedControl<"all" | "any">
                label={t("rules.match")}
                value={form.match}
                onChange={(v) => {
                  set("match", v);
                }}
                options={[
                  { id: "all", label: t("rules.match.all") },
                  { id: "any", label: t("rules.match.any") },
                ]}
              />
              <fieldset className={cx(own.group)}>
                <legend>{t("rules.types")}</legend>
                {(["expense", "income"] as const satisfies readonly EntryKind[]).map((kind) => (
                  <Checkbox
                    key={kind}
                    isSelected={form.types.includes(kind)}
                    onChange={(on) => {
                      set("types", toggle(form.types, kind, on));
                    }}
                  >
                    {t(kind === "expense" ? "tx.type.expense" : "tx.type.income")}
                  </Checkbox>
                ))}
              </fieldset>
              <div className={cx(styles.stack)}>
                <Select
                  label={t("rules.descOp")}
                  options={(["none", "contains", "startsWith", "equals", "pattern"] as const).map((op) => ({
                    id: op,
                    label: t(`rules.descOp.${op}`),
                  }))}
                  value={form.descOp}
                  onChange={(key) => {
                    set("descOp", (key ?? "none") as DescOp);
                  }}
                />
                {form.descOp !== "none" ? (
                  <TextField
                    label={t("rules.descValue")}
                    description={t("rules.descHelp")}
                    value={form.descValue}
                    onChange={(v) => {
                      set("descValue", v);
                    }}
                  />
                ) : null}
              </div>
              {accounts.length > 0 ? (
                <fieldset className={cx(own.group)}>
                  <legend>{t("rules.accounts")}</legend>
                  {accounts.map((a) => (
                    <Checkbox
                      key={a.id}
                      isSelected={form.accountIds.includes(a.id)}
                      onChange={(on) => {
                        set("accountIds", toggle(form.accountIds, a.id, on));
                      }}
                    >
                      {a.name}
                    </Checkbox>
                  ))}
                </fieldset>
              ) : null}
              <fieldset className={cx(own.group)}>
                <legend>{t("rules.members")}</legend>
                {activeMembers.map((m) => (
                  <Checkbox
                    key={m.id}
                    isSelected={form.memberIds.includes(m.id)}
                    onChange={(on) => {
                      set("memberIds", toggle(form.memberIds, m.id, on));
                    }}
                  >
                    {m.displayName}
                  </Checkbox>
                ))}
              </fieldset>
              <Select
                label={t("rules.payeeIs")}
                options={[{ id: NONE, label: t("rules.payeeAny") }, ...payeeOptions]}
                value={form.payeeIds[0] ?? NONE}
                onChange={(key) => {
                  set("payeeIds", key === null || key === NONE ? [] : [String(key)]);
                }}
              />
              <MoneyField
                label={t("rules.amountMin")}
                value={form.amountMin}
                onChange={(v) => {
                  set("amountMin", v);
                }}
              />
              <MoneyField
                label={t("rules.amountMax")}
                value={form.amountMax}
                onChange={(v) => {
                  set("amountMax", v);
                }}
              />
            </fieldset>
            <fieldset className={cx(styles.stack)}>
              <legend>{t("rules.then")}</legend>
              <Select
                label={t("rules.transfer")}
                description={t("rules.transferHelp")}
                options={[
                  { id: NONE, label: t("rules.none") },
                  ...accounts.map((a) => ({ id: a.id, label: a.name })),
                ]}
                value={form.transferAccountId ?? NONE}
                onChange={(key) => {
                  set("transferAccountId", key === null || key === NONE ? null : String(key));
                }}
              />
              {form.transferAccountId ? null : (
                <Select
                  label={t("rules.setCategory")}
                  options={[{ id: NONE, label: t("rules.none") }, ...categories]}
                  value={form.categoryId ?? NONE}
                  onChange={(key) => {
                    set("categoryId", key === null || key === NONE ? null : String(key));
                  }}
                />
              )}
              <ComboBox
                label={t("rules.setPayee")}
                description={t("rules.setPayeeHelp")}
                options={payeeOptions}
                allowsCustomValue
                inputValue={form.payeeText}
                onInputChange={(v) => {
                  set("payeeText", v);
                }}
              />
              {suggestedPayee && form.payeeText.trim() === "" ? (
                <div className={cx(styles.actions)}>
                  <span className={cx(styles.muted)}>
                    {t("rules.suggestPayee", { name: suggestedPayee })}
                  </span>
                  <Button
                    size="sm"
                    variant="secondary"
                    onPress={() => {
                      set("payeeText", suggestedPayee);
                    }}
                  >
                    {t("rules.useSuggestion", { name: suggestedPayee })}
                  </Button>
                </div>
              ) : null}
              {form.transferAccountId ? null : (
                <>
                  <Checkbox
                    isSelected={form.splitOn}
                    onChange={(v) => {
                      set("splitOn", v);
                    }}
                  >
                    {t("rules.setSplit")}
                  </Checkbox>
                  {form.splitOn ? (
                    <SplitEditor
                      members={engine.members}
                      value={form.split}
                      onChange={(v) => {
                        set("split", v);
                      }}
                    />
                  ) : null}
                </>
              )}
              <Checkbox
                isSelected={form.recurring}
                onChange={(v) => {
                  set("recurring", v);
                }}
              >
                {t("rules.recurring")}
              </Checkbox>
            </fieldset>
            {showIssues && issues.length > 0 ? (
              <ul role="alert" className={cx(styles.error)}>
                {issues.map((issue) => (
                  <li key={issue}>{issue}</li>
                ))}
              </ul>
            ) : null}
            {save.isError ? (
              <p role="alert" className={cx(styles.error)}>
                {t("rules.error.save")}
              </p>
            ) : null}
            <div className={cx(styles.actions)}>
              <Button type="submit" isPending={save.isPending}>
                {t("rules.save")}
              </Button>
              <Button variant="ghost" onPress={() => void navigate("/altro/regole")}>
                {t("common.cancel")}
              </Button>
              {saved ? (
                <ApplyRulesButton
                  engine={engine}
                  rules={[{ ...saved, enabled: true }]}
                  label={t("rules.apply")}
                />
              ) : null}
            </div>
          </form>
        </Card>
        <Card title={t("rules.preview")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("rules.previewHelp")}</p>
            <RulePreview rule={previewDoc} engine={{ ...engine, ctx: ctxWithNewPayee }} />
          </div>
        </Card>
      </div>
    </>
  );
}
