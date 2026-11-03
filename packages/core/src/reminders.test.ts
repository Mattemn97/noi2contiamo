// Feature 19: promemoria calcolati, stabili e senza doppioni.
import { describe, expect, it } from "vitest";
import { isUuidV7 } from "./ids";
import type { MatchTx, RecurrenceLike } from "./recurring";
import {
  computeReminders,
  DEFAULT_REMINDER_SETTINGS,
  reminderId,
  remindersToUpload,
  visibleReminders,
  type ReminderInput,
  type ReminderMessages,
} from "./reminders";

const ME = "0190a000-0000-7000-8000-000000000001";
const messages: ReminderMessages = {
  recurringDue: (i) => ({ title: `${i.name} ${i.date}`, body: `tra ${i.daysLeft}` }),
  settlement: (i) => ({ title: "saldo", body: String(i.owedCents) }),
  importReminder: (i) => ({ title: "import", body: String(i.days) }),
};
const rent: RecurrenceLike = {
  id: "0190a000-0000-7000-8000-0000000000a1",
  name: "Affitto",
  type: "expense",
  accountId: "0190a000-0000-7000-8000-0000000000b1",
  toAccountId: null,
  categoryId: null,
  payeeId: null,
  expectedAmountCents: 80000,
  amountToleranceBp: 0,
  split: null,
  frequency: { unit: "month", interval: 1, dayOfMonth: 10 },
  startDate: "2026-01-10",
  endDate: null,
  matchWindowDays: 3,
  descriptionMatch: null,
  skippedDates: [],
  archivedAtMs: null,
};
const today = "2026-11-08";
const nowMs = Date.parse("2026-11-08T12:00:00Z");
const base: ReminderInput = {
  memberId: ME,
  settings: DEFAULT_REMINDER_SETTINGS,
  today,
  nowMs,
  recurrences: [rent],
  txs: [],
  netCents: null,
  lastImportMs: null,
  messages,
};

describe("computeReminders", () => {
  it("avvisa della scadenza ricorrente con l'anticipo scelto", () => {
    const [first] = computeReminders(base);
    expect(first).toMatchObject({
      kind: "recurringDue",
      refId: rent.id,
      dedupKey: `recurringDue|${rent.id}|2026-11-10`,
    });
    expect(first?.fireAtMs).toBe(Date.parse("2026-11-08T08:00:00Z"));
    expect(isUuidV7(first?.id ?? "")).toBe(true);
  });

  it("con anticipo maggiore scatta prima; spento non c'è", () => {
    const early = computeReminders({
      ...base,
      settings: { ...base.settings, recurringDue: { enabled: true, leadDays: 5 } },
    });
    expect(early[0]?.fireAtMs).toBe(Date.parse("2026-11-05T08:00:00Z"));
    const off = computeReminders({
      ...base,
      settings: { ...base.settings, recurringDue: { enabled: false, leadDays: 2 } },
    });
    expect(off).toEqual([]);
  });

  it("non avvisa di una scadenza già pagata", () => {
    const tx: MatchTx = {
      id: "0190a000-0000-7000-8000-0000000000c1",
      type: "expense",
      date: "2026-11-09",
      amountCents: 80000,
      accountId: rent.accountId,
      toAccountId: null,
      categoryId: null,
      payeeId: null,
      description: "Affitto",
      recurrenceId: rent.id,
      recurrenceDueDate: "2026-11-10",
    } as MatchTx;
    const keys = computeReminders({ ...base, txs: [tx] }).map((r) => r.dedupKey);
    expect(keys).not.toContain(`recurringDue|${rent.id}|2026-11-10`);
  });

  it("saldo da pareggiare solo oltre la soglia e solo per chi deve", () => {
    const settings = { ...base.settings, settlement: { enabled: true, thresholdCents: 5000 } };
    const kinds = (netCents: number) =>
      computeReminders({ ...base, recurrences: [], settings, netCents }).map((r) => r.kind);
    expect(kinds(-4999)).toEqual([]);
    expect(kinds(-5000)).toEqual(["settlement"]);
    expect(kinds(9000)).toEqual([]);
  });

  it("import da fare dopo N giorni dall'ultimo, una volta sola per scadenza", () => {
    const settings = { ...base.settings, importReminder: { enabled: true, everyDays: 30 } };
    const run = (lastImportMs: number | null) =>
      computeReminders({ ...base, recurrences: [], settings, lastImportMs }).map((r) => r.dedupKey);
    expect(run(Date.parse("2026-10-20T10:00:00Z"))).toEqual([]);
    expect(run(Date.parse("2026-10-09T10:00:00Z"))).toEqual(["importReminder||2026-11-08"]);
    expect(run(null)).toEqual([]);
  });

  it("è deterministico: stesso input, stessi id", () => {
    expect(computeReminders(base)).toEqual(computeReminders(base));
    expect(reminderId(ME, "a")).not.toBe(reminderId(ME, "b"));
  });
});

describe("visibleReminders e remindersToUpload", () => {
  const weekly = { ...rent, frequency: { unit: "week" as const, interval: 1 }, startDate: "2026-11-02" };
  const all = computeReminders({ ...base, recurrences: [weekly] });

  it("mostra solo i promemoria già scattati e non archiviati", () => {
    expect(all.length).toBeGreaterThan(1);
    expect(visibleReminders(all, [], nowMs)).toHaveLength(1);
    expect(visibleReminders(all, [], nowMs).every((r) => r.fireAtMs <= nowMs)).toBe(true);
    const first = all[0];
    if (!first) throw new Error("atteso almeno un promemoria");
    expect(
      visibleReminders(all, [{ dedupKey: first.dedupKey, status: "dismissed" }], nowMs),
    ).not.toContainEqual(first);
    expect(visibleReminders(all, [{ dedupKey: first.dedupKey, status: "sent" }], nowMs)).toContainEqual(
      first,
    );
  });

  it("carica sul server solo quelli che non conosce", () => {
    const first = all[0];
    if (!first) throw new Error("atteso almeno un promemoria");
    expect(remindersToUpload(all, [{ dedupKey: first.dedupKey, status: "sent" }])).toHaveLength(
      all.length - 1,
    );
    expect(
      remindersToUpload(
        all,
        all.map((r) => ({ dedupKey: r.dedupKey, status: "pending" as const })),
      ),
    ).toEqual([]);
  });
});
