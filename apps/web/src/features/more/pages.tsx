// Pagine piccole del filo base: panoramica, area personale (segnaposto), altro (account, tema, server), 404.
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { useCollection, useResetAfterAuth, useSession } from "../../data/queries";
import { t } from "../../i18n/it";
import { Button, Card, EmptyState, PageHeader, StatusBadge, ThemeSwitcher, type Status } from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";
import { useFamily } from "../guards";

export function OverviewPage() {
  const { family } = useFamily();
  const navigate = useNavigate();
  const transactions = useCollection(family.id, "transactions");
  return (
    <>
      <PageHeader title={t("overview.title")} subtitle={t("overview.family", { name: family.name })} />
      <Card>
        <div className={cx(styles.stack)}>
          <p className={cx(styles.muted)}>
            {t("overview.count", { count: String(transactions.data?.length ?? 0) })}
          </p>
          <div className={cx(styles.actions)}>
            <Button onPress={() => void navigate("/movimenti/nuovo")}>{t("tx.add")}</Button>
            <Button variant="secondary" onPress={() => void navigate("/movimenti")}>
              {t("overview.goList")}
            </Button>
            <Button variant="secondary" onPress={() => void navigate("/saldo")}>
              {t("overview.goBalance")}
            </Button>
          </div>
        </div>
      </Card>
    </>
  );
}

export function PersonalPage() {
  return (
    <>
      <PageHeader title={t("personal.title")} />
      <Card>
        <EmptyState title={t("personal.soon")} />
      </Card>
    </>
  );
}

type Health = "checking" | "online" | "offline";
const HEALTH_STATUS: Readonly<Record<Health, Status>> = {
  checking: "warning",
  online: "good",
  offline: "critical",
};

function ServerStatus() {
  const adapter = useAdapter();
  const [health, setHealth] = useState<Health>("checking");
  useEffect(() => {
    let active = true;
    // Solo il server HTTP ha un endpoint di salute; Firebase è considerato raggiungibile.
    const check =
      "health" in adapter ? (adapter as { health(): Promise<boolean> }).health() : Promise.resolve(true);
    check
      .then((ok) => {
        if (active) setHealth(ok ? "online" : "offline");
      })
      .catch(() => {
        if (active) setHealth("offline");
      });
    return () => {
      active = false;
    };
  }, [adapter]);
  return (
    <Card title={t("status.title")} as="section">
      <p className={cx(styles.muted)}>{t("status.backend", { backend: import.meta.env.VITE_BACKEND })}</p>
      <p aria-live="polite">
        <StatusBadge status={HEALTH_STATUS[health]} label={t(`status.${health}`)} />
      </p>
    </Card>
  );
}

export function MorePage() {
  const adapter = useAdapter();
  const session = useSession();
  const navigate = useNavigate();
  const resetAfterAuth = useResetAfterAuth();
  const logout = useMutation({
    mutationFn: () => adapter.auth.signOut(),
    onSuccess: async () => {
      resetAfterAuth(null);
      await navigate("/accedi", { replace: true });
    },
  });
  return (
    <>
      <PageHeader title={t("more.title")} />
      <div className={cx(styles.stack)}>
        <Card title={t("more.account")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("more.signedInAs", { email: session.data?.email ?? "" })}</p>
            <div className={cx(styles.actions)}>
              <Button
                variant="secondary"
                isPending={logout.isPending}
                onPress={() => {
                  logout.mutate();
                }}
              >
                {t("auth.logout")}
              </Button>
            </div>
          </div>
        </Card>
        <Card title={t("more.family")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("more.familyHelp")}</p>
            <div className={cx(styles.actions)}>
              <Button variant="secondary" onPress={() => void navigate("/altro/famiglia")}>
                {t("more.familyGo")}
              </Button>
            </div>
          </div>
        </Card>
        <Card title={t("more.catalog")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("more.catalogHelp")}</p>
            <div className={cx(styles.actions)}>
              <Button variant="secondary" onPress={() => void navigate("/altro/conti")}>
                {t("accounts.title")}
              </Button>
              <Button variant="secondary" onPress={() => void navigate("/altro/categorie")}>
                {t("categories.title")}
              </Button>
              <Button variant="secondary" onPress={() => void navigate("/altro/destinatari")}>
                {t("payees.title")}
              </Button>
            </div>
          </div>
        </Card>
        <Card title={t("more.balance")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("more.balanceHelp")}</p>
            <div className={cx(styles.actions)}>
              <Button variant="secondary" onPress={() => void navigate("/saldo")}>
                {t("balance.title")}
              </Button>
            </div>
          </div>
        </Card>
        <Card title={t("rec.more")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("rec.moreHelp")}</p>
            <div className={cx(styles.actions)}>
              <Button variant="secondary" onPress={() => void navigate("/ricorrenti")}>
                {t("rec.open")}
              </Button>
              <Button variant="secondary" onPress={() => void navigate("/previsioni")}>
                {t("rec.openForecast")}
              </Button>
            </div>
          </div>
        </Card>
        <Card title={t("rules.more")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("rules.moreHelp")}</p>
            <div className={cx(styles.actions)}>
              <Button variant="secondary" onPress={() => void navigate("/altro/regole")}>
                {t("rules.open")}
              </Button>
            </div>
          </div>
        </Card>
        <Card title={t("import.more")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("import.moreHelp")}</p>
            <div className={cx(styles.actions)}>
              <Button variant="secondary" onPress={() => void navigate("/importa")}>
                {t("import.open")}
              </Button>
            </div>
          </div>
        </Card>
        <Card title={t("theme.label")} as="section">
          <ThemeSwitcher />
        </Card>
        <ServerStatus />
      </div>
    </>
  );
}

export function NotFoundPage() {
  const navigate = useNavigate();
  return (
    <main className={cx(styles.center)}>
      <div className={cx(styles.narrow)}>
        <EmptyState
          title={t("notFound.title")}
          action={<Button onPress={() => void navigate("/")}>{t("notFound.back")}</Button>}
        />
      </div>
    </main>
  );
}
