// Prima famiglia: chi la crea diventa proprietario; nascono anche il primo conto e le categorie di base.
import { defaultCategories, newId } from "@noi2contiamo/core";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { getLocalTimeZone, today } from "@internationalized/date";
import { useState, type SyntheticEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap, useFamilies } from "../../data/queries";
import { t } from "../../i18n/it";
import { Button, Card, PageHeader, Skeleton, TextField } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { JoinForm } from "./JoinForm";

export function CreateFamilyPage() {
  const adapter = useAdapter();
  const families = useFamilies();
  const client = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [accountName, setAccountName] = useState(t("family.accountDefault"));

  const create = useMutation({
    mutationFn: async () => {
      const familyId = newId();
      unwrap(
        await adapter.membership.createFamily({
          family: { id: familyId, name },
          ownerMember: { id: newId(), displayName },
          defaults: { categories: defaultCategories() },
        }),
      );
      unwrap(
        await adapter.put(familyId, "accounts", {
          id: newId(),
          name: accountName,
          kind: "checking",
          initialBalanceDate: today(getLocalTimeZone()).toString(),
        }),
      );
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: keys.families });
      await navigate("/movimenti/nuovo", { replace: true });
    },
  });

  if (families.isPending) return <Skeleton lines={4} />;
  // Chi ha già una famiglia non ne crea una seconda da qui (dopo la creazione si va al primo movimento).
  if (families.data?.[0] && create.isIdle) return <Navigate to="/" replace />;

  const onSubmit = (event: SyntheticEvent) => {
    event.preventDefault();
    create.mutate();
  };

  return (
    <main className={cx(styles.center)}>
      <div className={cx(styles.narrow)}>
        <Card title={t("join.title")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("join.subtitle")}</p>
            <JoinForm />
          </div>
        </Card>
        <PageHeader title={t("family.create.title")} subtitle={t("family.create.subtitle")} />
        <Card>
          <form className={cx(styles.form)} onSubmit={onSubmit} noValidate>
            <TextField
              label={t("family.name")}
              placeholder={t("family.namePlaceholder")}
              isRequired
              value={name}
              onChange={setName}
            />
            <TextField
              label={t("family.yourName")}
              autoComplete="given-name"
              isRequired
              value={displayName}
              onChange={setDisplayName}
            />
            <TextField
              label={t("family.accountName")}
              isRequired
              value={accountName}
              onChange={setAccountName}
            />
            {create.isError ? (
              <p role="alert" className={cx(styles.error)}>
                {t("family.error")}
              </p>
            ) : null}
            <div className={cx(styles.actions)}>
              <Button type="submit" isPending={create.isPending}>
                {t("family.submit")}
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </main>
  );
}
