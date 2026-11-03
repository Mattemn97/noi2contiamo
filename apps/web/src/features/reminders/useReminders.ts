// Promemoria nel browser (feature 19): si calcolano all'apertura con `core`, uguali nei due backend.
// Solo con il server Python e un canale esterno acceso, i nuovi si caricano perché il server li invii.
import {
  AUDIT_KEYS,
  computeReminders,
  DEFAULT_REMINDER_SETTINGS,
  memberBalances,
  remindersToUpload,
  visibleReminders,
  type MemberSettings,
  type PendingReminder,
  type ReminderMessages,
} from "@noi2contiamo/core";
import type { FamilySummary, WriteDocOf } from "@noi2contiamo/data";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef } from "react";
import { useAdapter } from "../../data/AdapterContext";
import { keys, unwrap, useAllDocs, useCollection } from "../../data/queries";
import { t } from "../../i18n/it";
import { euro, todayIso } from "../recurring/useRecurring";
import { notifyOnce } from "./browserNotify";

export const isHttpBackend = import.meta.env.VITE_BACKEND === "http";

const whenText = (daysLeft: number): string =>
  daysLeft <= 0
    ? t("rem.when.today")
    : daysLeft === 1
      ? t("rem.when.tomorrow")
      : t("rem.when.days", { days: String(daysLeft) });

export const reminderMessages: ReminderMessages = {
  recurringDue: ({ name, date, amountCents, daysLeft }) => ({
    title: t("rem.msg.due", { name, when: whenText(daysLeft) }),
    body: t("rem.msg.dueBody", { amount: euro(amountCents), date }),
  }),
  settlement: ({ owedCents }) => ({
    title: t("rem.msg.settlement"),
    body: t("rem.msg.settlementBody", { amount: euro(owedCents) }),
  }),
  importReminder: ({ days }) => ({
    title: t("rem.msg.import"),
    body: t("rem.msg.importBody", { days: String(days) }),
  }),
};

const audit: ReadonlySet<string> = new Set(AUDIT_KEYS);
const stripAudit = (doc: object) =>
  Object.fromEntries(Object.entries(doc).filter(([key]) => !audit.has(key)));

export interface ReminderState {
  readonly ready: boolean;
  readonly settings: MemberSettings;
  readonly visible: readonly PendingReminder[];
  readonly dismiss: (reminder: PendingReminder) => void;
  readonly saveSettings: (next: Pick<MemberSettings, "notifications" | "channels">) => Promise<void>;
}

export function useReminders(summary: FamilySummary): ReminderState {
  const adapter = useAdapter();
  const client = useQueryClient();
  const familyId = summary.family.id;
  const me = summary.memberId;
  const members = useCollection(familyId, "members");
  const accounts = useCollection(familyId, "accounts");
  const txs = useAllDocs(familyId, "transactions");
  const recurrences = useCollection(familyId, "recurrences");
  const batches = useCollection(familyId, "importBatches");
  const storedSettings = useCollection(familyId, "memberSettings");
  const stored = useCollection(familyId, "reminders");

  const settings = useMemo(
    (): MemberSettings =>
      storedSettings.data?.find((s) => s.id === me) ?? {
        id: me,
        notifications: DEFAULT_REMINDER_SETTINGS,
        channels: { inApp: true, webPush: false, email: false, telegram: false },
        defaultView: "family",
        createdAtMs: 0,
        createdByMemberId: me,
        updatedAtMs: 0,
        updatedByMemberId: me,
      },
    [storedSettings.data, me],
  );

  const computed = useMemo((): PendingReminder[] => {
    if (!members.data || !accounts.data || !txs.data || !recurrences.data || !batches.data) return [];
    const net = memberBalances(txs.data, {
      accounts: accounts.data,
      family: summary.family,
      memberIds: members.data.filter((m) => m.leftAtMs === null).map((m) => m.id),
    }).rows.find((r) => r.memberId === me)?.netCents;
    return computeReminders({
      memberId: me,
      settings: settings.notifications,
      today: todayIso(),
      nowMs: Date.now(),
      recurrences: recurrences.data,
      txs: txs.data,
      netCents: net ?? null,
      lastImportMs: batches.data.reduce<number | null>(
        (max, b) => (max === null || b.createdAtMs > max ? b.createdAtMs : max),
        null,
      ),
      messages: reminderMessages,
    });
  }, [members.data, accounts.data, txs.data, recurrences.data, batches.data, settings, summary.family, me]);

  const ready = Boolean(
    members.data &&
    accounts.data &&
    txs.data &&
    recurrences.data &&
    batches.data &&
    storedSettings.data &&
    stored.data,
  );
  const visible = useMemo(
    () => (ready && settings.channels.inApp ? visibleReminders(computed, stored.data ?? [], Date.now()) : []),
    [ready, computed, stored.data, settings.channels.inApp],
  );

  useEffect(() => {
    notifyOnce(visible);
  }, [visible]);

  const uploaded = useRef(new Set<string>());
  useEffect(() => {
    if (!ready || !isHttpBackend || !(settings.channels.email || settings.channels.telegram)) return;
    const fresh = remindersToUpload(computed, stored.data ?? []).filter(
      (r) => !uploaded.current.has(r.dedupKey),
    );
    if (fresh.length === 0) return;
    fresh.forEach((r) => uploaded.current.add(r.dedupKey));
    void adapter
      .commit(
        familyId,
        fresh.map((doc) => ({ type: "put" as const, collection: "reminders" as const, doc })),
      )
      .then(() => client.invalidateQueries({ queryKey: keys.collection(familyId, "reminders") }));
  }, [ready, computed, stored.data, settings.channels, adapter, client, familyId]);

  const dismiss = useMutation({
    mutationFn: async (reminder: PendingReminder) => {
      const doc: WriteDocOf<"reminders"> = { ...reminder, status: "dismissed" };
      unwrap(await adapter.put(familyId, "reminders", doc));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.collection(familyId, "reminders") }),
  });
  const save = useMutation({
    mutationFn: async (next: Pick<MemberSettings, "notifications" | "channels">) => {
      const doc = { ...stripAudit(settings), ...next, id: me } as WriteDocOf<"memberSettings">;
      unwrap(await adapter.put(familyId, "memberSettings", doc));
    },
    onSuccess: () => client.invalidateQueries({ queryKey: keys.collection(familyId, "memberSettings") }),
  });

  return {
    ready,
    settings,
    visible,
    dismiss: (reminder) => {
      dismiss.mutate(reminder);
    },
    saveSettings: async (next) => {
      await save.mutateAsync(next);
    },
  };
}
