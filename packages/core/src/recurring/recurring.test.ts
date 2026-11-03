// Spec 0008: scadenze, abbinamento, suggerimenti, saldi e previsione.
import { describe, expect, it } from "vitest";
import {
  accountBalances,
  accountSchema,
  amountFits,
  autoLinks,
  categorySchema,
  detectFrequency,
  detectRecurring,
  expectedAmountFor,
  forecast,
  linkCandidates,
  linkTransaction,
  matchOccurrences,
  nextDue,
  occurrences,
  occurrenceStatuses,
  paymentFromOccurrence,
  recurrenceFromSuggestion,
  recurrenceIssues,
  recurrenceSchema,
  transactionSchema,
  unlinkTransaction,
  type Account,
  type Recurrence,
  type Transaction,
} from "../index";

const id = (n: number) => `0190c000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const A = id(1);
const B = id(2);
const COMUNE = id(10);
const MIO = id(11);
const RISPARMI = id(12);
const CASA = id(20);
const STIPENDIO = id(21);
const LANDLORD = id(30);
const NETFLIX = id(31);
const audit = { createdAtMs: 1, createdByMemberId: A, updatedAtMs: 1, updatedByMemberId: A };

const account = (accId: string, over: Partial<Account> = {}): Account =>
  accountSchema.parse({
    id: accId,
    name: accId.slice(-3),
    kind: "checking",
    initialBalanceDate: "2026-01-01",
    ...audit,
    ...over,
  });
const FAMILY = { defaultSplit: { kind: "bp" as const, shares: { [A]: 5000, [B]: 5000 } } };
const categories = [
  categorySchema.parse({ id: CASA, name: "Casa", kind: "expense", ...audit }),
  categorySchema.parse({ id: STIPENDIO, name: "Stipendio", kind: "income", ...audit }),
];

let seq = 1000;
function rec(over: Partial<Recurrence> & Pick<Recurrence, "frequency" | "startDate">): Recurrence {
  return recurrenceSchema.parse({
    id: id(++seq),
    name: "Affitto",
    type: "expense",
    accountId: COMUNE,
    categoryId: CASA,
    payeeId: LANDLORD,
    expectedAmountCents: 70000,
    amountToleranceBp: 0,
    ...audit,
    ...over,
  });
}
function tx(over: Partial<Transaction> = {}): Transaction {
  const type = over.type ?? "expense";
  return transactionSchema.parse({
    id: id(++seq),
    type,
    date: "2026-10-05",
    amountCents: 70000,
    accountId: COMUNE,
    categoryId: type === "transfer" ? null : CASA,
    payeeId: LANDLORD,
    split: type === "transfer" ? null : { kind: "bp", source: "default", shares: FAMILY.defaultSplit.shares },
    ...audit,
    ...over,
  });
}
const monthly = (day: number) => ({ unit: "month" as const, interval: 1, dayOfMonth: day });

describe("scadenze (AC-1, AC-2)", () => {
  it("il 31 si ferma all'ultimo giorno del mese e non scivola", () => {
    const r = rec({ frequency: monthly(31), startDate: "2026-01-31" });
    expect(occurrences(r, "2026-01-01", "2026-05-31")).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
      "2026-05-31",
    ]);
  });

  it("senza dayOfMonth usa il giorno di inizio, anche il 30 dopo febbraio", () => {
    const r = rec({ frequency: { unit: "month", interval: 1 }, startDate: "2026-01-30" });
    expect(occurrences(r, "2026-02-01", "2026-03-31")).toEqual(["2026-02-28", "2026-03-30"]);
  });

  it("29 febbraio annuale: 28 negli anni normali, 29 nei bisestili", () => {
    const r = rec({ frequency: { unit: "year", interval: 1 }, startDate: "2024-02-29" });
    expect(occurrences(r, "2024-01-01", "2028-12-31")).toEqual([
      "2024-02-29",
      "2025-02-28",
      "2026-02-28",
      "2027-02-28",
      "2028-02-29",
    ]);
  });

  it("bisestile: febbraio con il 31 nel 2028 va al 29", () => {
    const r = rec({ frequency: monthly(31), startDate: "2028-01-31" });
    expect(occurrences(r, "2028-02-01", "2028-02-29")).toEqual(["2028-02-29"]);
  });

  it("settimanale, ogni due settimane e giornaliera", () => {
    expect(
      occurrences(
        rec({ frequency: { unit: "week", interval: 1 }, startDate: "2026-10-01" }),
        "2026-10-01",
        "2026-10-22",
      ),
    ).toEqual(["2026-10-01", "2026-10-08", "2026-10-15", "2026-10-22"]);
    expect(
      occurrences(
        rec({ frequency: { unit: "week", interval: 2 }, startDate: "2026-10-01" }),
        "2026-10-02",
        "2026-11-30",
      ),
    ).toEqual(["2026-10-15", "2026-10-29", "2026-11-12", "2026-11-26"]);
    expect(
      occurrences(
        rec({ frequency: { unit: "day", interval: 10 }, startDate: "2026-12-25" }),
        "2026-12-01",
        "2027-01-15",
      ),
    ).toEqual(["2026-12-25", "2027-01-04", "2027-01-14"]);
  });

  it("bimestrale, trimestrale e intervallo personalizzato", () => {
    const bi = rec({ frequency: { unit: "month", interval: 2 }, startDate: "2026-01-15" });
    expect(occurrences(bi, "2026-01-01", "2026-08-31")).toEqual([
      "2026-01-15",
      "2026-03-15",
      "2026-05-15",
      "2026-07-15",
    ]);
    const tri = rec({ frequency: { unit: "month", interval: 3, dayOfMonth: 31 }, startDate: "2026-08-31" });
    expect(occurrences(tri, "2026-01-01", "2027-06-30")).toEqual([
      "2026-08-31",
      "2026-11-30",
      "2027-02-28",
      "2027-05-31",
    ]);
  });

  it("count e endDate: vale la prima, le saltate contano", () => {
    const r = rec({
      frequency: { unit: "month", interval: 2, count: 3 },
      startDate: "2026-01-10",
      endDate: "2026-12-31",
      skippedDates: ["2026-03-10"],
    });
    expect(occurrences(r, "2026-01-01", "2027-12-31")).toEqual(["2026-01-10", "2026-03-10", "2026-05-10"]);
    const short = rec({
      frequency: { unit: "month", interval: 2, count: 10 },
      startDate: "2026-01-10",
      endDate: "2026-04-01",
    });
    expect(occurrences(short, "2026-01-01", "2027-12-31")).toEqual(["2026-01-10", "2026-03-10"]);
  });

  it("count conta anche le scadenze prima di from", () => {
    const r = rec({ frequency: { unit: "month", interval: 1, count: 3 }, startDate: "2026-01-05" });
    expect(occurrences(r, "2026-03-01", "2026-12-31")).toEqual(["2026-03-05"]);
  });

  it("dayOfMonth prima del giorno di inizio: la prima data utile è il mese dopo", () => {
    const r = rec({ frequency: monthly(1), startDate: "2026-01-20" });
    expect(occurrences(r, "2026-01-01", "2026-03-31")).toEqual(["2026-02-01", "2026-03-01"]);
  });

  it("niente scadenze dopo l'archiviazione", () => {
    const r = rec({ frequency: monthly(5), startDate: "2026-01-05", archivedAtMs: Date.UTC(2026, 2, 10) });
    expect(occurrences(r, "2026-01-01", "2026-12-31")).toEqual(["2026-01-05", "2026-02-05", "2026-03-05"]);
  });
});

describe("abbinamento e stato (AC-3, AC-4, AC-6)", () => {
  const bolletta = rec({
    name: "Luce",
    frequency: monthly(10),
    startDate: "2026-01-10",
    expectedAmountCents: 8000,
    amountToleranceBp: 2000,
    payeeId: null,
    descriptionMatch: { op: "contains", value: "enel" },
  });

  it("tolleranza: 92 € su 80 € al 20% sì, 120 € no", () => {
    expect(amountFits(bolletta, 9200)).toBe(true);
    expect(amountFits(bolletta, 9600)).toBe(true);
    expect(amountFits(bolletta, 9601)).toBe(false);
    expect(amountFits(rec({ frequency: monthly(1), startDate: "2026-01-01" }), 70001)).toBe(false);
  });

  it("un movimento 3 giorni dopo, nella tolleranza e con la descrizione, chiude la scadenza", () => {
    const paid = tx({
      date: "2026-10-13",
      amountCents: 9200,
      payeeId: null,
      description: "SDD ENEL ENERGIA",
    });
    const wrong = tx({
      date: "2026-10-11",
      amountCents: 12000,
      payeeId: null,
      description: "SDD ENEL ENERGIA",
    });
    const [o] = occurrenceStatuses(bolletta, [paid, wrong], "2026-10-01", "2026-10-31", "2026-10-20");
    expect(o).toMatchObject({
      date: "2026-10-10",
      status: "paid",
      match: "auto",
      transactionId: paid.id,
      amountCents: 9200,
    });
  });

  it("fuori finestra, altro conto, altro tipo, rimborso o già collegato altrove: niente abbinamento", () => {
    const base = { amountCents: 8000, payeeId: null, description: "enel" };
    const txs = [
      tx({ ...base, date: "2026-10-16" }),
      tx({ ...base, date: "2026-10-10", accountId: MIO }),
      tx({ ...base, date: "2026-10-10", type: "income", categoryId: STIPENDIO }),
      tx({ ...base, date: "2026-10-10", isRefund: true }),
      tx({ ...base, date: "2026-10-10", recurrenceId: id(999), recurrenceDueDate: "2026-10-10" }),
    ];
    const [o] = occurrenceStatuses(bolletta, txs, "2026-10-01", "2026-10-31", "2026-10-20");
    expect(o?.status).toBe("missed");
  });

  it("identità: destinatario se c'è, altrimenti categoria", () => {
    const affitto = rec({ frequency: monthly(5), startDate: "2026-01-05" });
    const other = tx({ payeeId: NETFLIX });
    expect(matchOccurrences(affitto, ["2026-10-05"], [other])[0]?.tx).toBeNull();
    const byCategory = rec({ frequency: monthly(5), startDate: "2026-01-05", payeeId: null });
    expect(matchOccurrences(byCategory, ["2026-10-05"], [other])[0]?.tx?.id).toBe(other.id);
  });

  it("due scadenze vicine e un movimento: lo prende la più vicina", () => {
    const weekly = rec({
      frequency: { unit: "week", interval: 1 },
      startDate: "2026-10-01",
      matchWindowDays: 5,
    });
    const t = tx({ date: "2026-10-07" });
    const res = matchOccurrences(weekly, ["2026-10-01", "2026-10-08"], [t]);
    expect(res.map((m) => m.tx?.id ?? null)).toEqual([null, t.id]);
    // La prima in ordine di data sceglie per prima: il movimento più vicino tra i due candidati.
    const a = tx({ date: "2026-10-03" });
    const res2 = matchOccurrences(weekly, ["2026-10-01", "2026-10-08"], [t, a]);
    expect(res2.map((m) => m.tx?.id)).toEqual([a.id, t.id]);
  });

  it("collegato vince sull'automatico e non serve alle altre scadenze", () => {
    const affitto = rec({ frequency: monthly(5), startDate: "2026-01-05" });
    const linked = tx({
      date: "2026-09-30",
      amountCents: 1,
      recurrenceId: affitto.id,
      recurrenceDueDate: "2026-10-05",
    });
    const auto = tx({ date: "2026-10-05" });
    const [o] = occurrenceStatuses(affitto, [linked, auto], "2026-10-01", "2026-10-31", "2026-10-06");
    expect(o).toMatchObject({ status: "paid", match: "linked", transactionId: linked.id });
  });

  it("stati: saltata, non pagata, in arrivo", () => {
    const affitto = rec({ frequency: monthly(5), startDate: "2026-08-05", skippedDates: ["2026-09-05"] });
    const st = occurrenceStatuses(affitto, [], "2026-08-01", "2026-11-30", "2026-10-08");
    expect(st.map((o) => [o.date, o.status])).toEqual([
      ["2026-08-05", "missed"],
      ["2026-09-05", "skipped"],
      ["2026-10-05", "upcoming"],
      ["2026-11-05", "upcoming"],
    ]);
    expect(occurrenceStatuses(affitto, [], "2026-10-01", "2026-10-31", "2026-10-11")[0]?.status).toBe(
      "missed",
    );
  });

  it("prossima scadenza e fine della serie", () => {
    const affitto = rec({ frequency: monthly(5), startDate: "2026-01-05" });
    const paid = tx({ date: "2026-11-04" });
    expect(nextDue(affitto, [paid], "2026-11-03")?.date).toBe("2026-12-05");
    const finished = rec({ frequency: monthly(5), startDate: "2026-01-05", endDate: "2026-02-28" });
    expect(nextDue(finished, [], "2026-11-03")).toBeNull();
  });

  it("importo per la previsione: fisso, oppure media degli ultimi 3 pagamenti", () => {
    const fixed = rec({ frequency: monthly(10), startDate: "2026-01-10" });
    expect(expectedAmountFor(fixed, [], "2026-11-03")).toBe(70000);
    const enel = (date: string, amountCents: number) =>
      tx({ date, amountCents, payeeId: null, description: "enel" });
    const txs = [
      enel("2026-07-10", 7000),
      enel("2026-08-10", 8000),
      enel("2026-09-10", 8500),
      enel("2026-10-10", 9001),
    ];
    expect(expectedAmountFor(bolletta, txs, "2026-11-03")).toBe(Math.round((8000 + 8500 + 9001) / 3));
    expect(expectedAmountFor(bolletta, [], "2026-11-03")).toBe(8000);
  });
});

describe("azioni sulla scadenza (AC-5)", () => {
  const accounts = [
    account(COMUNE),
    account(MIO, { ownerMemberId: A, visibility: "private" }),
    account(RISPARMI),
  ];
  const ctx = { accounts, categories, family: FAMILY };

  it("collega e scollega", () => {
    const t = tx();
    const linked = linkTransaction(t, id(5), "2026-10-05");
    expect(linked).toMatchObject({ recurrenceId: id(5), recurrenceDueDate: "2026-10-05" });
    expect(unlinkTransaction(linked)).toMatchObject({ recurrenceId: null, recurrenceDueDate: null });
  });

  it("candidati per Collega: stesso conto e tipo, entro 31 giorni, liberi, il più vicino prima", () => {
    const affitto = rec({ frequency: monthly(5), startDate: "2026-01-05" });
    const near = tx({ date: "2026-10-06", amountCents: 1 });
    const far = tx({ date: "2026-10-30" });
    const out = [
      tx({ date: "2026-11-10" }),
      tx({ date: "2026-10-05", accountId: MIO }),
      tx({ recurrenceId: id(9), recurrenceDueDate: "2026-10-05" }),
    ];
    expect(linkCandidates(affitto, "2026-10-05", [far, ...out, near]).map((t) => t.id)).toEqual([
      near.id,
      far.id,
    ]);
  });

  it("registra pagamento: movimento collegato con divisione automatica e campi della ricorrenza", () => {
    const affitto = rec({ frequency: monthly(5), startDate: "2026-01-05" });
    const res = paymentFromOccurrence(affitto, "2026-11-05", id(500), ctx);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value).toMatchObject({
      id: id(500),
      date: "2026-11-05",
      amountCents: 70000,
      categoryId: CASA,
      payeeId: LANDLORD,
      visibility: "shared",
      recurrenceId: affitto.id,
      recurrenceDueDate: "2026-11-05",
      split: { kind: "bp", source: "default", shares: FAMILY.defaultSplit.shares },
    });
    expect(transactionSchema.safeParse({ ...res.value, ...audit }).success).toBe(true);
  });

  it("registra pagamento: divisione della ricorrenza, privato sul conto privato, giroconto", () => {
    const split = { kind: "bp" as const, source: "manual" as const, shares: { [A]: 7000, [B]: 3000 } };
    const withSplit = rec({ frequency: monthly(5), startDate: "2026-01-05", split });
    const a = paymentFromOccurrence(withSplit, "2026-11-05", id(501), ctx);
    expect(a.ok && a.value.split).toEqual(split);
    const priv = rec({ frequency: monthly(5), startDate: "2026-01-05", accountId: MIO, split });
    const b = paymentFromOccurrence(priv, "2026-11-05", id(502), ctx);
    expect(b.ok && b.value).toMatchObject({
      visibility: "private",
      ownerMemberId: A,
      split: { shares: { [A]: 10000 } },
    });
    const transfer = rec({
      frequency: monthly(1),
      startDate: "2026-01-01",
      type: "transfer",
      categoryId: null,
      toAccountId: RISPARMI,
    });
    const c = paymentFromOccurrence(transfer, "2026-11-01", id(503), ctx);
    expect(c.ok && c.value).toMatchObject({
      type: "transfer",
      toAccountId: RISPARMI,
      categoryId: null,
      split: null,
    });
    const missing = paymentFromOccurrence({ ...transfer, accountId: id(404) }, "2026-11-01", id(504), ctx);
    expect(missing).toEqual({ ok: false, error: "account" });
  });

  it("collegamenti automatici del passato (Accetta)", () => {
    const affitto = rec({ frequency: monthly(5), startDate: "2026-08-05" });
    const txs = [
      tx({ date: "2026-08-04" }),
      tx({ date: "2026-09-06" }),
      tx({ date: "2026-10-05", amountCents: 1 }),
    ];
    const links = autoLinks(affitto, txs, "2026-11-03");
    expect(links.map((t) => [t.id, t.recurrenceDueDate])).toEqual([
      [txs[0]?.id, "2026-08-05"],
      [txs[1]?.id, "2026-09-05"],
    ]);
  });
});

describe("controlli dell'editor (AC-14)", () => {
  const ctx = {
    accounts: [account(COMUNE), account(RISPARMI)],
    categories,
    payees: [{ id: LANDLORD }],
    activeMemberIds: new Set([A, B]),
  };
  const draft = {
    id: id(700),
    name: "Affitto",
    type: "expense",
    accountId: COMUNE,
    categoryId: CASA,
    payeeId: LANDLORD,
    expectedAmountCents: 70000,
    frequency: monthly(5),
    startDate: "2026-01-05",
  };

  it("valida e riferimenti", () => {
    expect(recurrenceIssues(draft, ctx)).toEqual([]);
    expect(recurrenceIssues({ ...draft, categoryId: STIPENDIO }, ctx)).toEqual([
      "la categoria non è del tipo scelto",
    ]);
    expect(recurrenceIssues({ ...draft, accountId: id(404), payeeId: id(405) }, ctx)).toEqual([
      "il conto non esiste",
      "il destinatario non esiste",
    ]);
    expect(recurrenceIssues({ ...draft, endDate: "2025-01-01" }, ctx)).toEqual([
      "la fine viene prima dell'inizio",
    ]);
  });

  it("forma: giroconto con conto di arrivo, entrate e spese senza", () => {
    expect(recurrenceIssues({ ...draft, toAccountId: RISPARMI }, ctx)).toContain(
      "toAccountId: solo per un giroconto",
    );
    const transfer = { ...draft, type: "transfer", categoryId: null };
    expect(recurrenceIssues(transfer, ctx)).toContain("toAccountId: obbligatorio per un giroconto");
    expect(recurrenceIssues({ ...transfer, toAccountId: RISPARMI }, ctx)).toEqual([]);
    expect(recurrenceIssues({ ...transfer, toAccountId: COMUNE }, ctx)).toContain(
      "toAccountId: deve essere diverso da accountId",
    );
    expect(
      recurrenceIssues({ ...draft, frequency: { unit: "month", interval: 0 } }, ctx).length,
    ).toBeGreaterThan(0);
  });
});

describe("suggerimenti (AC-7, AC-8)", () => {
  const today = "2026-11-03";
  const netflix = (date: string, amountCents = 1299) =>
    tx({ date, amountCents, payeeId: NETFLIX, categoryId: CASA, description: "NETFLIX.COM" });
  const history = ["2026-06-15", "2026-07-15", "2026-08-16", "2026-09-15", "2026-10-15"].map((d) =>
    netflix(d),
  );
  const input = {
    recurrences: [],
    dismissedKeys: new Set<string>(),
    rules: [],
    payees: [{ id: NETFLIX, name: "Netflix" }],
    today,
  };

  it("frequenze riconosciute e regolarità", () => {
    expect(detectFrequency(["2026-01-01", "2026-01-08", "2026-01-15"])?.unit).toBe("week");
    expect(detectFrequency(["2026-01-01", "2026-03-02", "2026-05-01"])).toMatchObject({
      unit: "month",
      interval: 2,
    });
    expect(detectFrequency(["2026-01-01", "2026-04-01", "2026-07-01"])).toMatchObject({
      unit: "month",
      interval: 3,
    });
    expect(detectFrequency(["2025-03-01", "2026-03-01"])).toMatchObject({ unit: "year" });
    expect(detectFrequency(["2026-01-01", "2026-02-01"])).toBeNull();
    expect(detectFrequency(["2026-01-01", "2026-02-01"], true)?.unit).toBe("month");
    expect(detectFrequency(["2026-01-01", "2026-01-11", "2026-02-25", "2026-03-01"])).toBeNull();
  });

  it("Netflix ogni mese diventa un suggerimento mensile con importo fisso", () => {
    const [s, ...rest] = detectRecurring({ ...input, txs: history });
    expect(rest).toEqual([]);
    expect(s).toMatchObject({
      name: "Netflix",
      type: "expense",
      accountId: COMUNE,
      payeeId: NETFLIX,
      categoryId: CASA,
      frequency: { unit: "month", interval: 1 },
      dayOfMonth: 15,
      startDate: "2026-06-15",
      expectedAmountCents: 1299,
      amountToleranceBp: 0,
      fromRule: false,
    });
    expect(s?.key).toMatch(/^[0-9a-f]{32}$/);
    expect(s?.transactionIds).toHaveLength(5);
    const draft = s && recurrenceFromSuggestion(s);
    expect(draft).toMatchObject({
      frequency: { unit: "month", interval: 1, dayOfMonth: 15 },
      expectedAmountCents: 1299,
    });
    expect(recurrenceSchema.safeParse({ ...draft, id: id(800), ...audit }).success).toBe(true);
  });

  it("scartato non torna; chiave stabile", () => {
    const [s] = detectRecurring({ ...input, txs: history });
    expect(detectRecurring({ ...input, txs: history })[0]?.key).toBe(s?.key);
    expect(detectRecurring({ ...input, txs: history, dismissedKeys: new Set([s?.key ?? ""]) })).toEqual([]);
  });

  it("già coperto da una ricorrenza attiva: niente suggerimento", () => {
    const covered = rec({
      frequency: monthly(15),
      startDate: "2026-01-15",
      payeeId: NETFLIX,
      expectedAmountCents: 1299,
    });
    expect(detectRecurring({ ...input, txs: history, recurrences: [covered] })).toEqual([]);
  });

  it("vecchio, irregolare o troppo pochi: niente suggerimento", () => {
    const old = ["2025-01-15", "2025-02-15", "2025-03-15", "2025-04-15"].map((d) => netflix(d));
    expect(detectRecurring({ ...input, txs: old })).toEqual([]);
    expect(detectRecurring({ ...input, txs: history.slice(0, 2) })).toEqual([]);
  });

  it("variabile: tolleranza dalla deviazione, arrotondata al 5%", () => {
    const enel = [8000, 9000, 7600, 8400].map((amountCents, i) =>
      tx({
        date: `2026-0${6 + i}-10`,
        amountCents,
        payeeId: null,
        description: "SDD ENEL ENERGIA 12345",
        categoryId: CASA,
      }),
    );
    const [s] = detectRecurring({ ...input, txs: enel });
    expect(s).toMatchObject({
      name: "Enel Energia",
      payeeId: null,
      descriptionMatch: { op: "contains", value: "enel energia" },
      expectedAmountCents: 8200,
      amountToleranceBp: 1000,
    });
  });

  it("due fasce di importo dallo stesso destinatario restano separate", () => {
    const big = ["2026-07-01", "2026-08-01", "2026-09-01", "2026-10-01"].map((d) => netflix(d, 9999));
    expect(
      detectRecurring({ ...input, txs: [...history, ...big] })
        .map((s) => s.expectedAmountCents)
        .sort(),
    ).toEqual([1299, 9999]);
  });

  it("segnalato da una regola: bastano 2 movimenti", () => {
    const ruleId = id(900);
    const two = ["2026-09-15", "2026-10-15"].map((d) => tx({ ...netflix(d), ruleIds: [ruleId] }));
    const rules = [{ id: ruleId, actions: { recurring: true as const } }];
    expect(detectRecurring({ ...input, txs: two, rules })[0]?.fromRule).toBe(true);
  });
});

describe("saldi e previsione (AC-9, AC-10)", () => {
  const accounts = [
    account(COMUNE, { initialBalanceCents: 100000, initialBalanceDate: "2026-10-01" }),
    account(RISPARMI, { initialBalanceCents: 0, initialBalanceDate: "2026-10-01" }),
    account(MIO, {
      ownerMemberId: A,
      visibility: "private",
      initialBalanceCents: 5000,
      initialBalanceDate: "2026-10-01",
    }),
  ];

  it("saldo di oggi: iniziale, entrate, spese, rimborsi e giroconti; prima dell'inizio e dopo oggi no", () => {
    const txs = [
      tx({ date: "2026-10-02", amountCents: 3000 }),
      tx({ date: "2026-10-03", amountCents: 1000, isRefund: true }),
      tx({ date: "2026-10-04", type: "income", amountCents: 20000, categoryId: STIPENDIO }),
      tx({ date: "2026-10-05", type: "transfer", amountCents: 5000, toAccountId: RISPARMI }),
      tx({ date: "2026-09-30", amountCents: 99999 }),
      tx({ date: "2026-11-04", amountCents: 99999 }),
    ];
    expect(accountBalances(accounts, txs, "2026-11-03")).toEqual({
      [COMUNE]: 100000 - 3000 + 1000 + 20000 - 5000,
      [RISPARMI]: 5000,
      [MIO]: 5000,
    });
  });

  it("saldo 1000 €, affitto 700 € il 5, variabile −200 € al mese", () => {
    const today = "2026-11-03";
    const affitto = rec({ frequency: monthly(5), startDate: "2026-01-05" });
    const vars = ["2026-08-10", "2026-09-10", "2026-10-10"].map((date) =>
      tx({ date, amountCents: 20000, payeeId: null }),
    );
    const base = [account(COMUNE, { initialBalanceCents: 160000, initialBalanceDate: "2026-08-01" })];
    // 1600 − 3 × 200 = 1000 oggi; nessun affitto passato perché la serie è solo la ricorrenza.
    const out = forecast({ accounts: base, txs: vars, recurrences: [affitto], today, months: 2 });
    expect(out.map((m) => m.month)).toEqual(["2026-11", "2026-12", "2027-01"]);
    const [nov, dec] = out;
    expect(nov?.byAccount[COMUNE]).toEqual({
      balanceCents: 100000 - 70000 - 20000,
      recurringInCents: 0,
      recurringOutCents: 70000,
      variableInCents: 0,
      variableOutCents: 20000,
    });
    expect(dec?.byAccount[COMUNE]?.balanceCents).toBe(10000 - 90000);
    expect(nov?.family.balanceCents).toBe(10000);
    expect(nov?.endDate).toBe("2026-11-30");
  });

  it("mese corrente: solo quanto manca della media; i movimenti ricorrenti non contano come variabili", () => {
    const today = "2026-11-20";
    const affitto = rec({ frequency: monthly(5), startDate: "2026-01-05" });
    const txs = [
      ...["2026-08-10", "2026-09-10", "2026-10-10"].map((date) =>
        tx({ date, amountCents: 30000, payeeId: null }),
      ),
      ...["2026-08-05", "2026-09-05", "2026-10-05", "2026-11-05"].map((date) => tx({ date })),
      tx({ date: "2026-11-10", amountCents: 10000, payeeId: null }),
    ];
    const base = [account(COMUNE, { initialBalanceCents: 0, initialBalanceDate: "2026-11-01" })];
    const [nov, dec] = forecast({ accounts: base, txs, recurrences: [affitto], today, months: 1 });
    expect(nov?.byAccount[COMUNE]).toMatchObject({ recurringOutCents: 0, variableOutCents: 20000 });
    expect(dec?.byAccount[COMUNE]).toMatchObject({ recurringOutCents: 70000, variableOutCents: 30000 });
  });

  it("famiglia: solo conti condivisi; giroconto tra condivisi non è entrata né uscita", () => {
    const today = "2026-11-03";
    const risparmio = rec({
      name: "Risparmio",
      frequency: monthly(10),
      startDate: "2026-01-10",
      type: "transfer",
      categoryId: null,
      payeeId: null,
      toAccountId: RISPARMI,
      expectedAmountCents: 10000,
    });
    const stip = rec({
      name: "Stipendio",
      frequency: monthly(27),
      startDate: "2026-01-27",
      type: "income",
      categoryId: STIPENDIO,
      payeeId: null,
      accountId: MIO,
      expectedAmountCents: 200000,
    });
    const [nov] = forecast({ accounts, txs: [], recurrences: [risparmio, stip], today, months: 1 });
    expect(nov?.byAccount[COMUNE]).toMatchObject({ balanceCents: 90000, recurringOutCents: 10000 });
    expect(nov?.byAccount[RISPARMI]).toMatchObject({ balanceCents: 10000, recurringInCents: 10000 });
    expect(nov?.byAccount[MIO]).toMatchObject({ balanceCents: 205000, recurringInCents: 200000 });
    expect(nov?.family).toEqual({
      balanceCents: 100000,
      recurringInCents: 0,
      recurringOutCents: 0,
      variableInCents: 0,
      variableOutCents: 0,
    });
  });

  it("scadenze non pagate del passato e ricorrenze archiviate non pesano; mesi limitati a 1..12", () => {
    const affitto = rec({ frequency: monthly(5), startDate: "2026-01-05" });
    const archived = rec({ frequency: monthly(20), startDate: "2026-01-20", archivedAtMs: 1 });
    const base = [account(COMUNE, { initialBalanceCents: 0, initialBalanceDate: "2026-11-01" })];
    const out = forecast({
      accounts: base,
      txs: [],
      recurrences: [affitto, archived],
      today: "2026-11-15",
      months: 99,
    });
    expect(out).toHaveLength(13);
    expect(out[0]?.byAccount[COMUNE]?.recurringOutCents).toBe(0);
    expect(out[1]?.byAccount[COMUNE]?.recurringOutCents).toBe(70000);
  });

  it("una scadenza appena passata ma ancora nella finestra conta nel mese corrente", () => {
    const affitto = rec({ frequency: monthly(1), startDate: "2026-01-01" });
    const base = [account(COMUNE, { initialBalanceCents: 0, initialBalanceDate: "2026-11-01" })];
    const [nov] = forecast({
      accounts: base,
      txs: [],
      recurrences: [affitto],
      today: "2026-11-03",
      months: 1,
    });
    expect(nov?.byAccount[COMUNE]?.recurringOutCents).toBe(70000);
  });
});
