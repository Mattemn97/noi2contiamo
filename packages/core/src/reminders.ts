// Promemoria (feature 19): calcolati dal browser, mai dal server. Funzioni pure: stesso input, stessi promemoria,
// con id e `dedupKey` stabili, così lo stesso promemoria non viene mai consegnato due volte.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Id, IsoDate, MemberId } from "./ids";
import type { MemberSettings, Reminder } from "./model/schemas";
import { isoFromMs, occurrenceStatuses, shiftDays, type MatchTx, type RecurrenceLike } from "./recurring";

export type ReminderSettings = MemberSettings["notifications"];

/** Impostazioni di chi non le ha ancora salvate (come i default dello schema). */
export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = {
  recurringDue: { enabled: true, leadDays: 2 },
  settlement: { enabled: false, thresholdCents: 0 },
  importReminder: { enabled: false, everyDays: 30 },
};

/** Quanti giorni oltre l'anticipo si caricano in anticipo sul server (modalità Python). */
export const UPLOAD_HORIZON_DAYS = 14;
const MS_PER_DAY = 86_400_000;
const SEND_HOUR_UTC = 8;

export type PendingReminder = Pick<
  Reminder,
  "id" | "memberId" | "kind" | "refId" | "fireAtMs" | "title" | "body" | "dedupKey"
>;

interface Text {
  readonly title: string;
  readonly body: string;
}

/** I testi arrivano dal catalogo dell'interfaccia: il dominio non li conosce. */
export interface ReminderMessages {
  recurringDue(info: { name: string; date: IsoDate; amountCents: number; daysLeft: number }): Text;
  settlement(info: { owedCents: number }): Text;
  importReminder(info: { days: number }): Text;
}

export interface ReminderInput {
  readonly memberId: MemberId;
  readonly settings: ReminderSettings;
  readonly today: IsoDate;
  readonly nowMs: number;
  readonly recurrences: readonly RecurrenceLike[];
  readonly txs: readonly MatchTx[];
  /** Saldo del membro (negativo = deve soldi agli altri); `null` se non calcolabile. */
  readonly netCents: number | null;
  /** Istante dell'ultimo import, `null` se non ce n'è mai stato. */
  readonly lastImportMs: number | null;
  readonly messages: ReminderMessages;
}

/** Id in forma UUIDv7 e stabile: stessa chiave, stesso id. */
export function reminderId(memberId: MemberId, dedupKey: string): Id {
  const h = bytesToHex(sha256(utf8ToBytes(`${memberId}|${dedupKey}`)));
  const variant = ((parseInt(h.slice(16, 17), 16) & 3) | 8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-7${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const at8 = (date: IsoDate): number => Date.parse(`${date}T0${SEND_HOUR_UTC}:00:00Z`);

/** Tutti i promemoria del membro, anche quelli che scattano più avanti, in ordine di `fireAtMs`. */
export function computeReminders(input: ReminderInput): PendingReminder[] {
  const { memberId, settings, today, nowMs, messages } = input;
  const out: PendingReminder[] = [];
  const add = (
    kind: PendingReminder["kind"],
    refId: string | null,
    fireAtMs: number,
    dedupKey: string,
    text: Text,
  ) => out.push({ id: reminderId(memberId, dedupKey), memberId, kind, refId, fireAtMs, dedupKey, ...text });

  const due = settings.recurringDue;
  if (due.enabled)
    for (const rec of input.recurrences) {
      if (rec.archivedAtMs !== null) continue;
      const to = shiftDays(today, due.leadDays + UPLOAD_HORIZON_DAYS);
      for (const occ of occurrenceStatuses(rec, input.txs, today, to, today)) {
        if (occ.status !== "upcoming" || occ.date < today) continue;
        const daysLeft = Math.round((at8(occ.date) - at8(today)) / MS_PER_DAY);
        add(
          "recurringDue",
          rec.id,
          at8(shiftDays(occ.date, -due.leadDays)),
          `recurringDue|${rec.id}|${occ.date}`,
          messages.recurringDue({ name: rec.name, date: occ.date, amountCents: occ.amountCents, daysLeft }),
        );
      }
    }

  const { settlement } = settings;
  if (settlement.enabled && input.netCents !== null && input.netCents < 0) {
    const owed = -input.netCents;
    if (owed >= Math.max(settlement.thresholdCents, 1))
      add(
        "settlement",
        null,
        nowMs,
        `settlement||${today.slice(0, 7)}`,
        messages.settlement({ owedCents: owed }),
      );
  }

  const reminder = settings.importReminder;
  if (reminder.enabled && input.lastImportMs !== null) {
    const dueDate = shiftDays(isoFromMs(input.lastImportMs), reminder.everyDays);
    if (today >= dueDate)
      add(
        "importReminder",
        null,
        nowMs,
        `importReminder||${dueDate}`,
        messages.importReminder({ days: reminder.everyDays }),
      );
  }
  return out.sort((a, b) => a.fireAtMs - b.fireAtMs || a.dedupKey.localeCompare(b.dedupKey));
}

type Stored = Pick<Reminder, "dedupKey" | "status">;

/** Quelli da mostrare ora: già scattati e non archiviati dall'utente. */
export function visibleReminders(
  computed: readonly PendingReminder[],
  stored: readonly Stored[],
  nowMs: number,
): PendingReminder[] {
  const dismissed = new Set(stored.filter((s) => s.status === "dismissed").map((s) => s.dedupKey));
  return computed.filter((r) => r.fireAtMs <= nowMs && !dismissed.has(r.dedupKey));
}

/** Quelli che il server non conosce ancora: si caricano una volta sola. */
export function remindersToUpload(
  computed: readonly PendingReminder[],
  stored: readonly Stored[],
): PendingReminder[] {
  const known = new Set(stored.map((s) => s.dedupKey));
  return computed.filter((r) => !known.has(r.dedupKey));
}
