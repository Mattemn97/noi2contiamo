// Pagine piccole del filo base: impostazioni (account, tema, promemoria, server, diagnostica), 404.
import { useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useAdapter } from "../../data/AdapterContext";
import { isDebugEnabled, logInfo, setDebugEnabled } from "../../debug/log";
import { useResetAfterAuth, useSession } from "../../data/queries";
import { t } from "../../i18n/it";
import {
  AccentPicker,
  Button,
  Card,
  EmptyState,
  PageHeader,
  StatusBadge,
  Switch,
  ThemeSwitcher,
  type Status,
} from "../../ui";
import { cx } from "../../ui/cx";
import styles from "../layout.module.css";

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

function DebugSettings() {
  const [enabled, setEnabled] = useState(isDebugEnabled);
  return (
    <Card title={t("debug.title")} as="section">
      <div className={cx(styles.stack)}>
        <p className={cx(styles.muted)}>{t("debug.help")}</p>
        <Switch
          isSelected={enabled}
          onChange={(next) => {
            setDebugEnabled(next);
            setEnabled(next);
            if (next) logInfo("debug.on", { version: import.meta.env.VITE_APP_VERSION ?? "dev" });
          }}
        >
          {t("debug.toggle")}
        </Switch>
        <p className={cx(styles.muted)}>{t("debug.hint")}</p>
      </div>
    </Card>
  );
}

/**
 * Impostazioni (ex "Altro"): account, aspetto, promemoria, server e diagnostica. Le altre pagine si
 * raggiungono dal menù laterale.
 */
export function SettingsPage() {
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
      <PageHeader title={t("settings.title")} subtitle={t("settings.subtitle")} />
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
        <Card title={t("theme.appearance")} as="section">
          <div className={cx(styles.stack)}>
            <ThemeSwitcher />
            <AccentPicker />
          </div>
        </Card>
        <Card title={t("rem.more")} as="section">
          <div className={cx(styles.stack)}>
            <p className={cx(styles.muted)}>{t("rem.moreHelp")}</p>
            <div className={cx(styles.actions)}>
              <Button variant="secondary" onPress={() => void navigate("/altro/promemoria")}>
                {t("rem.openSettings")}
              </Button>
            </div>
          </div>
        </Card>
        <ServerStatus />
        <DebugSettings />
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
