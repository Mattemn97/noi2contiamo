// Demo nel browser (sito del progetto): adapter in memoria con una famiglia inventata e l'accesso già fatto.
// Gli stessi utenti e la stessa password del demo Python (`npm run demo`); i dati si rigenerano a ogni avvio.
import { defaultCategories, newId, normalize } from "@noi2contiamo/core";
import type { DataAdapter, FamilyId } from "@noi2contiamo/data";
import { createMemoryAdapter } from "@noi2contiamo/data/memory";
import { DEMO_EMAILS, DEMO_PASSWORD } from "./credentials";

/** Mesi di storico generati prima di oggi, mese in corso compreso. */
const MONTHS = 6;

const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** Primo giorno del mese a `back` mesi da oggi, più `day - 1` giorni (UTC, per non cambiare data col fuso). */
function dayOf(today: Date, back: number, day: number): number {
  return Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - back, day);
}

/** Generatore pseudocasuale con seme fisso: la demo ha sempre gli stessi importi. */
function seededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: unknown }, what: string): T {
  if (!result.ok) throw new Error(`Demo: ${what} non riuscito: ${JSON.stringify(result.error)}`);
  return result.value;
}

/** Adapter in memoria con la famiglia "Casa Demo", sei mesi di movimenti e Giulia già collegata. */
export async function createDemoAdapter(now: Date = new Date()): Promise<DataAdapter> {
  const adapter = createMemoryAdapter();
  await seedDemo(adapter, now);
  return adapter;
}

/** Riempie `adapter` con i dati demo e lascia collegata Giulia. Restituisce l'id della famiglia. */
export async function seedDemo(adapter: DataAdapter, now: Date): Promise<FamilyId> {
  const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const todayMs = today.getTime();
  const random = seededRandom(2026);
  const between = (min: number, max: number) => Math.round(min + random() * (max - min));

  await adapter.auth.signUp(DEMO_EMAILS.owner, DEMO_PASSWORD);
  const familyId = newId();
  const giulia = newId();
  const categories = defaultCategories();
  unwrap(
    await adapter.membership.createFamily({
      family: { id: familyId, name: "Casa Demo" },
      ownerMember: { id: giulia, displayName: "Giulia", color: "#2f6fed" },
      defaults: { categories },
    }),
    "famiglia",
  );
  const invite = unwrap(await adapter.membership.createInvite(familyId, { id: newId() }), "invito");
  await adapter.auth.signUp(DEMO_EMAILS.partner, DEMO_PASSWORD);
  unwrap(await adapter.membership.acceptInvite(invite.token, "Marco"), "ingresso di Marco");
  await adapter.auth.signIn(DEMO_EMAILS.owner, DEMO_PASSWORD);

  const members = unwrap(await adapter.list(familyId, "members"), "membri").docs;
  const marco = members.find((m) => m.displayName === "Marco")?.id;
  if (!marco) throw new Error("Demo: Marco non trovato");
  const marcoMember = members.find((m) => m.id === marco);
  if (marcoMember)
    unwrap(await adapter.put(familyId, "members", { ...marcoMember, color: "#d9480f" }), "colore");
  const half = { [giulia]: 5000, [marco]: 5000 };
  unwrap(await adapter.membership.setDefaultSplit(familyId, { kind: "bp", shares: half }), "divisione");

  const category = (name: string) => {
    const found = categories.find((c) => c.name === name);
    if (!found) throw new Error(`Demo: categoria ${name} mancante`);
    return found.id;
  };

  const start = isoDate(dayOf(today, MONTHS, 1));
  const accounts = {
    comune: newId(),
    giulia: newId(),
    marco: newId(),
    risparmi: newId(),
  };
  for (const account of [
    { id: accounts.comune, name: "Conto comune", kind: "checking", initialBalanceCents: 150_000, order: 0 },
    { id: accounts.giulia, name: "Conto Giulia", kind: "checking", ownerMemberId: giulia, order: 1 },
    { id: accounts.marco, name: "Carta Marco", kind: "card", ownerMemberId: marco, order: 2 },
    {
      id: accounts.risparmi,
      name: "Risparmi di Giulia",
      kind: "savings",
      ownerMemberId: giulia,
      visibility: "private",
      initialBalanceCents: 820_000,
      order: 3,
    },
  ] as const)
    unwrap(
      await adapter.put(familyId, "accounts", {
        initialBalanceCents: 0,
        ...account,
        initialBalanceDate: start,
      }),
      "conto",
    );

  const payeeNames = [
    "Esselunga",
    "Coop",
    "Enel Energia",
    "Proprietario di casa",
    "Eni",
    "Netflix",
    "Farmacia Centrale",
    "Trattoria da Gino",
    "Fastweb",
  ] as const;
  const payees = Object.fromEntries(payeeNames.map((name) => [name, newId()])) as Record<
    (typeof payeeNames)[number],
    string
  >;
  for (const name of payeeNames)
    unwrap(
      await adapter.put(familyId, "payees", { id: payees[name], name, normalizedName: normalize(name) }),
      "destinatario",
    );

  unwrap(
    await adapter.put(familyId, "rules", {
      id: newId(),
      name: "Spesa al supermercato",
      order: 0,
      conditions: { match: "any", description: { op: "contains", value: "esselunga" } },
      actions: { categoryId: category("Spesa Alimentare"), payeeId: payees.Esselunga },
    }),
    "regola",
  );
  unwrap(
    await adapter.put(familyId, "rules", {
      id: newId(),
      name: "Carburante",
      order: 1,
      conditions: { match: "any", description: { op: "contains", value: "eni" } },
      actions: { categoryId: category("Trasporti / Auto / Moto"), payeeId: payees.Eni },
    }),
    "regola",
  );

  const shared = { kind: "bp", source: "default", shares: half } as const;
  const rentId = newId();
  const netflixId = newId();
  for (const recurrence of [
    {
      id: rentId,
      name: "Affitto",
      categoryId: category("Casa / Affitto / Mutuo"),
      payeeId: payees["Proprietario di casa"],
      expectedAmountCents: 78_000,
      frequency: { unit: "month", interval: 1, dayOfMonth: 1 },
    },
    {
      id: netflixId,
      name: "Netflix",
      categoryId: category("Svago / Hobby / Uscite"),
      payeeId: payees.Netflix,
      expectedAmountCents: 1_399,
      frequency: { unit: "month", interval: 1, dayOfMonth: 12 },
    },
  ] as const)
    unwrap(
      await adapter.put(familyId, "recurrences", {
        ...recurrence,
        type: "expense",
        accountId: accounts.comune,
        split: shared,
        startDate: start,
      }),
      "ricorrenza",
    );

  type Tx = Parameters<typeof adapter.put<"transactions">>[2];
  const txs: Tx[] = [];
  const at = (back: number, day: number) => {
    const ms = dayOf(today, back, day);
    return ms <= todayMs ? isoDate(ms) : null;
  };
  const expense = (
    date: string | null,
    cents: number,
    name: string,
    description: string,
    payer: string,
    extra: Partial<Tx> = {},
  ) => {
    if (!date) return;
    const accountId = payer === giulia ? accounts.giulia : accounts.marco;
    txs.push({
      id: newId(),
      type: "expense",
      date,
      amountCents: cents,
      accountId,
      categoryId: category(name),
      description,
      payerMemberId: payer,
      split: shared,
      ...extra,
    });
  };

  for (let back = MONTHS; back >= 0; back--) {
    for (const [member, account, cents, label] of [
      [giulia, accounts.giulia, 210_000, "Stipendio Giulia"],
      [marco, accounts.marco, 190_000, "Stipendio Marco"],
    ] as const) {
      const date = at(back, 1);
      if (!date) continue;
      txs.push({
        id: newId(),
        type: "income",
        date,
        amountCents: cents,
        accountId: account,
        categoryId: category("Stipendio"),
        description: label,
        split: { kind: "bp", source: "manual", shares: { [member]: 10000 } },
      });
    }
    for (const [from, cents] of [
      [accounts.giulia, 90_000],
      [accounts.marco, 80_000],
    ] as const) {
      const date = at(back, 2);
      if (date)
        txs.push({
          id: newId(),
          type: "transfer",
          date,
          amountCents: cents,
          accountId: from,
          toAccountId: accounts.comune,
          description: "Versamento sul conto comune",
        });
    }

    const rentDate = at(back, 1);
    if (rentDate)
      txs.push({
        id: newId(),
        type: "expense",
        date: rentDate,
        amountCents: 78_000,
        accountId: accounts.comune,
        categoryId: category("Casa / Affitto / Mutuo"),
        payeeId: payees["Proprietario di casa"],
        description: "Affitto",
        split: shared,
        recurrenceId: rentId,
        recurrenceDueDate: rentDate,
      });
    const netflixDate = at(back, 12);
    if (netflixDate)
      txs.push({
        id: newId(),
        type: "expense",
        date: netflixDate,
        amountCents: 1_399,
        accountId: accounts.comune,
        categoryId: category("Svago / Hobby / Uscite"),
        payeeId: payees.Netflix,
        description: "Netflix",
        split: shared,
        recurrenceId: netflixId,
        recurrenceDueDate: netflixDate,
      });

    for (const day of [3, 8, 14, 19, 24, 29]) {
      const payer = day % 2 === 0 ? marco : giulia;
      const store = day % 3 === 0 ? "Coop" : "Esselunga";
      expense(
        at(back, day),
        between(3_500, 12_500),
        "Spesa Alimentare",
        `${store.toUpperCase()} SPA`,
        payer,
        {
          payeeId: payees[store],
        },
      );
    }
    if (back % 2 === 0) {
      expense(at(back, 16), between(9_000, 16_000), "Bollette / Utenze", "Luce e gas", giulia, {
        payeeId: payees["Enel Energia"],
      });
    }
    expense(at(back, 20), 2_990, "Bollette / Utenze", "Internet casa", marco, { payeeId: payees.Fastweb });
    expense(at(back, 10), between(4_500, 7_000), "Trasporti / Auto / Moto", "ENI STATION", marco, {
      payeeId: payees.Eni,
    });
    expense(at(back, 21), between(4_000, 9_000), "Ristoranti / Bar / Delivery", "Cena fuori", giulia, {
      payeeId: payees["Trattoria da Gino"],
    });
    if (back % 3 === 1)
      expense(at(back, 7), between(1_200, 3_500), "Salute / Farmacia", "Farmacia", marco, {
        payeeId: payees["Farmacia Centrale"],
      });
    expense(at(back, 25), between(2_000, 6_000), "Abbigliamento / Cura persona", "Parrucchiere", giulia, {
      split: { kind: "bp", source: "manual", shares: { [giulia]: 10000 } },
    });
  }

  // Una spesa privata: la vede solo Giulia.
  expense(at(1, 18), 6_500, "Regali / Donazioni", "Regalo di compleanno per Marco", giulia, {
    accountId: accounts.risparmi,
    visibility: "private",
    ownerMemberId: giulia,
    split: { kind: "bp", source: "manual", shares: { [giulia]: 10000 } },
  });
  // Un giroconto verso i risparmi, uno dei viaggi pianificati.
  const savingsDate = at(2, 28);
  if (savingsDate)
    txs.push({
      id: newId(),
      type: "transfer",
      date: savingsDate,
      amountCents: 30_000,
      accountId: accounts.giulia,
      toAccountId: accounts.risparmi,
      description: "Accantono per le vacanze",
    });
  expense(at(3, 9), 64_000, "Viaggi / Vacanze", "Weekend in Liguria", marco, {
    split: { kind: "bp", source: "manual", shares: { [giulia]: 6000, [marco]: 4000 } },
  });

  for (const tx of txs)
    unwrap(await adapter.put(familyId, "transactions", tx), `movimento ${tx.description}`);
  return familyId;
}
