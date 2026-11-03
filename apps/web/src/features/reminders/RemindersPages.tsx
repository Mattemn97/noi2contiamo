// `/promemoria` (elenco) e `/altro/promemoria` (impostazioni): feature 19.
import type { MemberSettings } from "@noi2contiamo/core";
import { useState } from "react";
import { t } from "../../i18n/it";
import { Button, Card, EmptyState, PageHeader, Skeleton, Switch, TextField, useToast } from "../../ui";
import { cx } from "../../ui/cx";
import list from "../catalog/catalog.module.css";
import { useFamily } from "../guards";
import styles from "../layout.module.css";
import {
  browserNotifyEnabled,
  browserPermission,
  disableBrowserNotify,
  enableBrowserNotify,
  type BrowserPermission,
} from "./browserNotify";
import { isHttpBackend, useReminders } from "./useReminders";

export function RemindersPage() {
  const { family, memberId, role } = useFamily();
  const { ready, visible, dismiss } = useReminders({ family, memberId, role });
  if (!ready) return <Skeleton lines={4} />;
  return (
    <>
      <PageHeader title={t("rem.title")} subtitle={family.name} />
      <div className={cx(styles.stack)}>
        {visible.length === 0 ? (
          <EmptyState title={t("rem.empty")} description={t("rem.emptyBody")} />
        ) : (
          <Card as="section" title={t("rem.list")}>
            <ul className={cx(list.list)}>
              {visible.map((r) => (
                <li key={r.id} className={cx(list.row)}>
                  <span>
                    <strong>{r.title}</strong>
                    <br />
                    <span className={cx(styles.muted)}>{r.body}</span>
                  </span>
                  <Button
                    variant="secondary"
                    onPress={() => {
                      dismiss(r);
                    }}
                  >
                    {t("rem.dismiss")}
                  </Button>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <p className={cx(styles.muted)}>{t("rem.computedOnOpen")}</p>
      </div>
    </>
  );
}

const toNumber = (text: string): number | null => {
  const value = Number(text.replace(",", "."));
  return text.trim() !== "" && Number.isFinite(value) && value >= 0 ? value : null;
};

export function ReminderSettingsPage() {
  const { family, memberId, role } = useFamily();
  const { ready, settings, saveSettings } = useReminders({ family, memberId, role });
  const toast = useToast();
  const [permission, setPermission] = useState<BrowserPermission>(browserPermission());
  const [browserOn, setBrowserOn] = useState(browserNotifyEnabled());
  const [draft, setDraft] = useState<Record<string, string>>({});
  if (!ready) return <Skeleton lines={6} />;

  const { notifications, channels } = settings;
  const save = (next: Pick<MemberSettings, "notifications" | "channels">) => {
    saveSettings(next).then(
      () => {
        toast.show({ message: t("rem.saved") });
      },
      () => {
        toast.show({ message: t("rem.error.save") });
      },
    );
  };
  const field = (name: string, current: number) => draft[name] ?? String(current);
  const commit = (name: string, apply: (value: number) => MemberSettings["notifications"]) => {
    const value = toNumber(draft[name] ?? "");
    setDraft(Object.fromEntries(Object.entries(draft).filter(([key]) => key !== name)));
    if (value !== null) save({ notifications: apply(value), channels });
  };

  const toggleBrowser = async (on: boolean) => {
    if (!on) {
      disableBrowserNotify();
      setBrowserOn(false);
      return;
    }
    const result = await enableBrowserNotify();
    setPermission(result);
    setBrowserOn(result === "granted");
  };

  return (
    <>
      <PageHeader title={t("rem.settings.title")} subtitle={family.name} />
      <div className={cx(styles.stack)}>
        <Card as="section" title={t("rem.channels")}>
          <div className={cx(styles.stack)}>
            <Switch
              isSelected={channels.inApp}
              onChange={(inApp) => {
                save({ notifications, channels: { ...channels, inApp } });
              }}
            >
              {t("rem.channel.inApp")}
            </Switch>
            {permission === "unsupported" ? (
              <p className={cx(styles.muted)}>{t("rem.browser.unsupported")}</p>
            ) : (
              <>
                <Switch
                  isSelected={browserOn}
                  isDisabled={permission === "denied"}
                  onChange={(on) => void toggleBrowser(on)}
                >
                  {t("rem.channel.browser")}
                </Switch>
                <p className={cx(styles.muted)}>
                  {permission === "denied" ? t("rem.browser.denied") : t("rem.browser.help")}
                </p>
              </>
            )}
            <Switch
              isSelected={channels.email}
              isDisabled={!isHttpBackend}
              onChange={(email) => {
                save({ notifications, channels: { ...channels, email } });
              }}
            >
              {t("rem.channel.email")}
            </Switch>
            <Switch
              isSelected={channels.telegram}
              isDisabled={!isHttpBackend}
              onChange={(telegram) => {
                save({ notifications, channels: { ...channels, telegram } });
              }}
            >
              {t("rem.channel.telegram")}
            </Switch>
            <p className={cx(styles.muted)}>
              {isHttpBackend ? t("rem.limit.http") : t("rem.limit.firebase")}
            </p>
          </div>
        </Card>
        <Card as="section" title={t("rem.types")}>
          <div className={cx(styles.stack)}>
            <Switch
              isSelected={notifications.recurringDue.enabled}
              onChange={(enabled) => {
                save({
                  notifications: {
                    ...notifications,
                    recurringDue: { ...notifications.recurringDue, enabled },
                  },
                  channels,
                });
              }}
            >
              {t("rem.type.recurringDue")}
            </Switch>
            <TextField
              label={t("rem.lead")}
              type="number"
              inputMode="numeric"
              value={field("lead", notifications.recurringDue.leadDays)}
              onChange={(value) => {
                setDraft({ ...draft, lead: value });
              }}
              onBlur={() => {
                commit("lead", (v) => ({
                  ...notifications,
                  recurringDue: { ...notifications.recurringDue, leadDays: Math.min(60, Math.round(v)) },
                }));
              }}
            />
            <Switch
              isSelected={notifications.settlement.enabled}
              onChange={(enabled) => {
                save({
                  notifications: { ...notifications, settlement: { ...notifications.settlement, enabled } },
                  channels,
                });
              }}
            >
              {t("rem.type.settlement")}
            </Switch>
            <TextField
              label={t("rem.threshold")}
              inputMode="decimal"
              value={field("threshold", notifications.settlement.thresholdCents / 100)}
              onChange={(value) => {
                setDraft({ ...draft, threshold: value });
              }}
              onBlur={() => {
                commit("threshold", (v) => ({
                  ...notifications,
                  settlement: { ...notifications.settlement, thresholdCents: Math.round(v * 100) },
                }));
              }}
            />
            <Switch
              isSelected={notifications.importReminder.enabled}
              onChange={(enabled) => {
                save({
                  notifications: {
                    ...notifications,
                    importReminder: { ...notifications.importReminder, enabled },
                  },
                  channels,
                });
              }}
            >
              {t("rem.type.importReminder")}
            </Switch>
            <TextField
              label={t("rem.every")}
              type="number"
              inputMode="numeric"
              value={field("every", notifications.importReminder.everyDays)}
              onChange={(value) => {
                setDraft({ ...draft, every: value });
              }}
              onBlur={() => {
                commit("every", (v) => ({
                  ...notifications,
                  importReminder: {
                    ...notifications.importReminder,
                    everyDays: Math.max(1, Math.min(365, Math.round(v))),
                  },
                }));
              }}
            />
          </div>
        </Card>
      </div>
    </>
  );
}
