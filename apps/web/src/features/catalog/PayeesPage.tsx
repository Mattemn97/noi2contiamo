// Destinatari (feature 7): negozi, fornitori e persone; nome normalizzato unico, rinomina e archivio.
import { newId, payeeFromName, type Payee } from "@noi2contiamo/core";
import { useState, type SyntheticEvent } from "react";
import { useCollection } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  Button,
  Card,
  Checkbox,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  TextField,
} from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { useFamily } from "../guards";
import list from "./catalog.module.css";
import { ArchiveButton, saveErrorText, useSave } from "./shared";

function PayeeForm({
  familyId,
  payee,
  onDone,
}: {
  readonly familyId: string;
  readonly payee: Payee | null;
  readonly onDone: () => void;
}) {
  const [name, setName] = useState(payee?.name ?? "");
  const [nameError, setNameError] = useState(false);
  const save = useSave(familyId, "payees", onDone);
  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    if (name.trim() === "") {
      setNameError(true);
      return;
    }
    setNameError(false);
    save.mutate({ archivedAtMs: null, ...payee, ...payeeFromName(payee?.id ?? newId(), name) });
  };
  return (
    <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
      <TextField
        label={t("payees.name")}
        isRequired
        value={name}
        onChange={setName}
        isInvalid={nameError}
        errorMessage={t("catalog.error.name")}
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

export function PayeesPage() {
  const { family } = useFamily();
  const payees = useCollection(family.id, "payees");
  const [editing, setEditing] = useState<Payee | "new" | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  if (payees.isPending) return <Skeleton lines={6} />;
  if (payees.isError) return <ErrorState onRetry={() => void payees.refetch()} />;

  const shown = payees.data
    .filter((p) => showArchived || p.archivedAtMs === null)
    .sort((a, b) => a.name.localeCompare(b.name, "it"));
  const current = editing === "new" ? null : editing;

  return (
    <>
      <PageHeader title={t("payees.title")} subtitle={t("payees.subtitle")} />
      <Card
        actions={
          <Button
            size="sm"
            onPress={() => {
              setEditing("new");
            }}
          >
            {t("payees.add")}
          </Button>
        }
      >
        <div className={cx(styles.stack)}>
          <Checkbox isSelected={showArchived} onChange={setShowArchived}>
            {t("catalog.showArchived")}
          </Checkbox>
          {shown.length === 0 ? (
            <EmptyState title={t("payees.empty")} />
          ) : (
            <ul className={cx(list.list)}>
              {shown.map((payee) => (
                <li key={payee.id} className={cx(list.row)}>
                  <span className={cx(list.name)}>
                    {payee.name}
                    {payee.archivedAtMs !== null ? (
                      <span className={cx(list.meta)}>{t("catalog.archived")}</span>
                    ) : null}
                  </span>
                  <div className={cx(list.end)}>
                    <Button
                      size="sm"
                      variant="secondary"
                      onPress={() => {
                        setEditing(payee);
                      }}
                    >
                      {t("catalog.edit")}
                    </Button>
                    <ArchiveButton familyId={family.id} collection="payees" doc={payee} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
      <Dialog
        title={t(current ? "payees.editTitle" : "payees.new")}
        isOpen={editing !== null}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <PayeeForm
          key={current?.id ?? "new"}
          familyId={family.id}
          payee={current}
          onDone={() => {
            setEditing(null);
          }}
        />
      </Dialog>
    </>
  );
}
