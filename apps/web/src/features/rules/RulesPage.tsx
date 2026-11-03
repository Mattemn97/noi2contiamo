// `/altro/regole` (spec 0007, AC-14): regole in ordine di priorità, trascinamento e Su/Giù, attiva,
// duplica, elimina, applica a tutti i movimenti.
import {
  AUDIT_KEYS,
  newId,
  nextRuleOrder,
  reorderRules,
  ruleMissingRefs,
  type Rule,
  type WriteDocOf,
} from "@noi2contiamo/core";
import type { CommitOp } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, type DragEvent } from "react";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  Switch,
  useToast,
} from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import list from "../catalog/catalog.module.css";
import { useFamily } from "../guards";
import { ApplyRulesButton } from "./ApplyRulesButton";
import { describeRule, type Names } from "./ruleForm";
import { useRuleEngine, type RuleEngine } from "./useRules";
import own from "./rules.module.css";

const audit: ReadonlySet<string> = new Set(AUDIT_KEYS);
const writable = (rule: Rule) =>
  Object.fromEntries(Object.entries(rule).filter(([key]) => !audit.has(key))) as WriteDocOf<"rules">;

export function namesOf(engine: RuleEngine): Names {
  const find =
    <T extends { readonly id: string }>(items: readonly T[], label: (x: T) => string) =>
    (id: string) => {
      const item = items.find((x) => x.id === id);
      return item ? label(item) : null;
    };
  return {
    category: find(engine.categories, (c) => c.name),
    payee: find(engine.payees, (p) => p.name),
    account: find(engine.accounts, (a) => a.name),
    member: find(engine.members, (m) => m.displayName),
  };
}

export function RulesPage() {
  const { family } = useFamily();
  const adapter = useAdapter();
  const client = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const { engine, isError, refetch } = useRuleEngine();
  const [dragging, setDragging] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<Rule | null>(null);

  const write = useMutation({
    mutationFn: async ({ ops }: { ops: CommitOp[]; message: string }) => {
      unwrap(await adapter.commit(family.id, ops));
    },
    onSuccess: async (_v, { message }) => {
      await client.invalidateQueries({ queryKey: keys.collection(family.id, "rules") });
      toast.show({ message });
    },
  });
  const put = (docs: readonly Rule[], message: string) => {
    if (docs.length === 0) return;
    write.mutate({
      ops: docs.map((doc) => ({ type: "put", collection: "rules", doc: writable(doc) })),
      message,
    });
  };

  if (isError) return <ErrorState onRetry={refetch} />;
  if (!engine) return <Skeleton lines={6} />;
  const rules = engine.rules;
  const names = namesOf(engine);
  const move = (from: number, to: number) => {
    put(reorderRules(rules, from, to), t("rules.reordered"));
  };
  const onDrop = (to: number) => (event: DragEvent) => {
    event.preventDefault();
    if (dragging !== null) move(dragging, to);
    setDragging(null);
  };

  return (
    <>
      <PageHeader title={t("rules.title")} subtitle={t("rules.subtitle")} />
      <Card
        actions={
          <div className={cx(styles.actions)}>
            <ApplyRulesButton
              engine={engine}
              rules={rules}
              label={t("rules.applyAll")}
              isDisabled={!rules.some((r) => r.enabled)}
            />
            <Button size="sm" onPress={() => void navigate("/altro/regole/nuova")}>
              {t("rules.add")}
            </Button>
          </div>
        }
      >
        {rules.length === 0 ? (
          <EmptyState title={t("rules.empty")} />
        ) : (
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("rules.dragHelp")}</p>
            <ol className={cx(list.list)} aria-label={t("rules.title")}>
              {rules.map((rule, index) => (
                <li
                  key={rule.id}
                  className={cx(list.row, dragging === index && own.dragging)}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    setDragging(index);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                  }}
                  onDrop={onDrop(index)}
                  onDragEnd={() => {
                    setDragging(null);
                  }}
                >
                  <span className={cx(list.who)}>
                    <span className={cx(list.name)}>
                      <span aria-hidden="true" className={cx(own.handle)}>
                        ⋮⋮
                      </span>
                      {t("rules.position", { n: String(index + 1) })} {rule.name}
                      {!rule.enabled ? <span className={cx(list.meta)}>{t("rules.disabled")}</span> : null}
                      {ruleMissingRefs(rule, engine.ctx) ? (
                        <StatusBadge status="warning" label={t("rules.missingRefs")} />
                      ) : null}
                    </span>
                    <span className={cx(list.meta)}>{describeRule(rule, names)}</span>
                  </span>
                  <div className={cx(list.end)}>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("rules.moveUpLabel", { name: rule.name })}
                      isDisabled={index === 0 || write.isPending}
                      onPress={() => {
                        move(index, index - 1);
                      }}
                    >
                      {t("rules.moveUp")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("rules.moveDownLabel", { name: rule.name })}
                      isDisabled={index === rules.length - 1 || write.isPending}
                      onPress={() => {
                        move(index, index + 1);
                      }}
                    >
                      {t("rules.moveDown")}
                    </Button>
                    <Switch
                      isSelected={rule.enabled}
                      onChange={(enabled) => {
                        put([{ ...rule, enabled }], t("rules.saved"));
                      }}
                    >
                      {t("rules.enabled")}
                    </Switch>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => void navigate(`/altro/regole/${rule.id}`)}
                    >
                      {t("rules.edit")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        put(
                          [
                            {
                              ...rule,
                              id: newId(),
                              name: t("rules.copyOf", { name: rule.name }).slice(0, 60),
                              order: nextRuleOrder(rules),
                            },
                          ],
                          t("rules.saved"),
                        );
                      }}
                    >
                      {t("rules.duplicate")}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onPress={() => {
                        setDeleting(rule);
                      }}
                    >
                      {t("common.delete")}
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        )}
        {write.isError ? (
          <p role="alert" className={cx(styles.error)}>
            {t("rules.error.save")}
          </p>
        ) : null}
      </Card>
      <ConfirmDialog
        title={t("rules.delete.title")}
        message={t("rules.delete.body", { name: deleting?.name ?? "" })}
        confirmLabel={t("common.delete")}
        isOpen={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        onConfirm={() => {
          if (deleting)
            write.mutate({
              ops: [{ type: "remove", collection: "rules", id: deleting.id }],
              message: t("rules.deleted"),
            });
          setDeleting(null);
        }}
      />
    </>
  );
}
