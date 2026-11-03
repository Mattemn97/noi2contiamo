import { describe, expect, it } from "vitest";
import {
  accountSchema,
  findTransferPairs,
  memberBalances,
  mergeTransferPair,
  settlementAccount,
  settlementPlan,
  settlementTransfer,
  totalsOf,
  transactionSchema,
  type Account,
  type BalanceTx,
  type SettlementPayment,
  type Transaction,
} from "./index";

const A = "0190a000-0000-7000-8000-00000000000a";
const B = "0190a000-0000-7000-8000-00000000000b";
const C = "0190a000-0000-7000-8000-00000000000c";
const COMUNE = "0190a000-0000-7000-8000-000000000201";
const CONTO_A = "0190a000-0000-7000-8000-000000000202";
const CONTO_B = "0190a000-0000-7000-8000-000000000203";
const PRIVATO_A = "0190a000-0000-7000-8000-000000000204";

const account = (id: string, ownerMemberId: string | null, extra: Partial<Account> = {}): Account =>
  accountSchema.parse({
    id,
    name: id.slice(-3),
    kind: "checking",
    ownerMemberId,
    initialBalanceDate: "2026-01-01",
    createdAtMs: 0,
    updatedAtMs: 0,
    createdByMemberId: A,
    updatedByMemberId: A,
    ...extra,
  });
const accounts = [
  account(COMUNE, null),
  account(CONTO_A, A),
  account(CONTO_B, B),
  account(PRIVATO_A, A, { visibility: "private" }),
];
const family = { defaultSplit: { kind: "bp" as const, shares: { [A]: 5000, [B]: 5000 } } };
const ctx = { accounts, family, memberIds: [A, B] };
const half = { kind: "bp" as const, source: "default" as const, shares: { [A]: 5000, [B]: 5000 } };

const base: BalanceTx = {
  type: "expense",
  date: "2026-11-03",
  amountCents: 10000,
  isRefund: false,
  accountId: CONTO_A,
  toAccountId: null,
  payerMemberId: A,
  split: half,
  settlement: null,
  visibility: "shared",
};
const tx = (over: Partial<BalanceTx>): BalanceTx => ({ ...base, ...over });
const transfer = (from: string, to: string, amountCents: number, over: Partial<BalanceTx> = {}) =>
  tx({
    type: "transfer",
    accountId: from,
    toAccountId: to,
    amountCents,
    split: null,
    payerMemberId: null,
    ...over,
  });
const nets = (txs: readonly BalanceTx[], extra = {}) =>
  Object.fromEntries(memberBalances(txs, { ...ctx, ...extra }).rows.map((r) => [r.memberId, r.netCents]));

describe("memberBalances (AC-3, AC-4, AC-5)", () => {
  it("senza movimenti i membri ci sono tutti, a zero", () => {
    expect(nets([])).toEqual({ [A]: 0, [B]: 0 });
  });

  it("spesa di 100,01 € pagata da Anna al 60/40: Bruno deve 40,00 €", () => {
    const split = { kind: "bp" as const, source: "category" as const, shares: { [A]: 6000, [B]: 4000 } };
    expect(nets([tx({ amountCents: 10001, split })])).toEqual({ [A]: 4000, [B]: -4000 });
  });

  it("un rimborso della stessa spesa la annulla", () => {
    expect(nets([tx({}), tx({ isRefund: true })])).toEqual({ [A]: 0, [B]: 0 });
  });

  it("divisione in centesimi: contano gli importi scritti", () => {
    const split = { kind: "cents" as const, source: "manual" as const, shares: { [A]: 1000, [B]: 9000 } };
    expect(nets([tx({ split })])).toEqual({ [A]: 9000, [B]: -9000 });
  });

  it("entrata incassata da Bruno divisa 50/50: Bruno deve metà ad Anna", () => {
    expect(nets([tx({ type: "income", accountId: CONTO_B, payerMemberId: B, amountCents: 3000 })])).toEqual({
      [A]: 1500,
      [B]: -1500,
    });
  });

  it("entrata al 100% del proprietario non cambia nulla", () => {
    const split = { kind: "bp" as const, source: "default" as const, shares: { [B]: 10000 } };
    expect(nets([tx({ type: "income", payerMemberId: B, split })])).toEqual({ [A]: 0, [B]: 0 });
  });

  it("cassa comune 50/50: Anna versa 1000 €, si spendono 1000 € al 50/50 → Bruno deve 500 €", () => {
    const txs = [
      transfer(CONTO_A, COMUNE, 100000),
      tx({ accountId: COMUNE, payerMemberId: null, amountCents: 100000 }),
    ];
    expect(nets(txs)).toEqual({ [A]: 50000, [B]: -50000 });
    // Se anche Bruno versa la sua parte, si torna in pari.
    expect(nets([...txs, transfer(CONTO_B, COMUNE, 100000)])).toEqual({ [A]: 0, [B]: 0 });
  });

  it("spesa dalla cassa comune tutta a Bruno: Bruno deve la parte di Anna", () => {
    const split = { kind: "bp" as const, source: "manual" as const, shares: { [B]: 10000 } };
    expect(nets([tx({ accountId: COMUNE, payerMemberId: null, split, amountCents: 2001 })])).toEqual({
      [A]: 1001,
      [B]: -1001,
    });
  });

  it("giroconto tra membri senza settlement sposta il saldo; tra conti dello stesso membro no", () => {
    expect(nets([transfer(CONTO_A, CONTO_B, 700)])).toEqual({ [A]: 700, [B]: -700 });
    expect(nets([transfer(CONTO_A, PRIVATO_A, 700)])).toEqual({ [A]: 0, [B]: 0 });
  });

  it("settlement decide le parti anche se i conti dicono altro", () => {
    const t = transfer(COMUNE, CONTO_A, 500, { settlement: { fromMemberId: B, toMemberId: A } });
    expect(nets([t])).toEqual({ [A]: -500, [B]: 500 });
  });

  it("i privati non contano: il saldo è lo stesso per chiunque lo guardi", () => {
    const priv = tx({ accountId: PRIVATO_A, visibility: "private", amountCents: 999, split: { ...half } });
    expect(nets([priv])).toEqual({ [A]: 0, [B]: 0 });
  });

  it("un membro che compare solo nelle quote entra nelle righe", () => {
    const split = { kind: "bp" as const, source: "manual" as const, shares: { [A]: 5000, [C]: 5000 } };
    expect(nets([tx({ split })])).toEqual({ [A]: 5000, [B]: 0, [C]: -5000 });
  });

  it("dettaglio: il saldo è la somma con i segni e la somma dei saldi è zero", () => {
    const txs = [
      tx({ amountCents: 10001 }),
      tx({ type: "income", payerMemberId: B, amountCents: 333 }),
      tx({ isRefund: true, amountCents: 77 }),
      transfer(CONTO_B, CONTO_A, 1234),
      tx({ accountId: COMUNE, payerMemberId: null, amountCents: 4567 }),
    ];
    const { rows, totalCents } = memberBalances(txs, ctx);
    expect(totalCents).toBe(0);
    for (const r of rows)
      expect(r.netCents).toBe(
        r.paidCents - r.expenseShareCents - r.receivedCents + r.incomeShareCents + r.transfersCents,
      );
    const a = rows.find((r) => r.memberId === A)!;
    expect(a.paidCents).toBe(10001 - 77 + 2284);
    expect(a.transfersCents).toBe(-1234);
  });

  it("proprietà: con movimenti casuali la somma resta sempre zero al centesimo", () => {
    let seed = 7;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed % n;
    };
    const accs = [COMUNE, CONTO_A, CONTO_B];
    const three = { kind: "bp" as const, shares: { [A]: 3333, [B]: 3333, [C]: 3334 } };
    for (let round = 0; round < 50; round++) {
      const txs = Array.from({ length: 20 }, (): BalanceTx => {
        const kind = rnd(3);
        const amountCents = 1 + rnd(100000);
        if (kind === 2) return transfer(accs[rnd(3)]!, accs[rnd(3)]!, amountCents);
        return tx({
          type: kind === 0 ? "expense" : "income",
          amountCents,
          isRefund: rnd(5) === 0,
          payerMemberId: [A, B, C, null][rnd(4)] ?? null,
          split: { kind: "bp", source: "manual", shares: three.shares },
        });
      });
      const { totalCents } = memberBalances(txs, { accounts, family: { defaultSplit: three } });
      expect(totalCents).toBe(0);
    }
  });

  it("un giroconto non tocca entrate, uscite e netto (AC-2)", () => {
    const txs = [tx({}), transfer(CONTO_A, CONTO_B, 5000)];
    expect(totalsOf(txs)).toEqual({ ...totalsOf([tx({})]), count: 2 });
  });
});

describe("saldo a una data e per periodo (AC-6)", () => {
  const txs = [
    tx({ date: "2026-10-15" }),
    tx({ date: "2026-11-02", amountCents: 2000 }),
    tx({ date: "2026-11-20" }),
  ];

  it("fino a una data comprende tutto prima, compreso quel giorno", () => {
    expect(nets(txs, { range: { from: null, to: "2026-11-02" } })).toEqual({ [A]: 6000, [B]: -6000 });
  });

  it("nel periodo conta solo ciò che si è mosso lì", () => {
    expect(nets(txs, { range: { from: "2026-11-01", to: "2026-11-30" } })).toEqual({ [A]: 6000, [B]: -6000 });
    expect(nets(txs, { range: { from: "2026-11-03", to: "2026-11-30" } })).toEqual({ [A]: 5000, [B]: -5000 });
  });
});

const apply = (balance: Record<string, number>, plan: readonly SettlementPayment[]) => {
  const next = { ...balance };
  for (const p of plan) {
    next[p.fromMemberId] = (next[p.fromMemberId] ?? 0) + p.amountCents;
    next[p.toMemberId] = (next[p.toMemberId] ?? 0) - p.amountCents;
  }
  return next;
};

describe("settlementPlan (AC-7)", () => {
  it("in pari: nessun pagamento", () => {
    expect(settlementPlan({ [A]: 0, [B]: 0 })).toEqual([]);
  });

  it("due membri: un solo pagamento dal debitore al creditore", () => {
    expect(settlementPlan({ [A]: 4000, [B]: -4000 })).toEqual([
      { fromMemberId: B, toMemberId: A, amountCents: 4000 },
    ]);
  });

  it("una coppia a somma zero dentro quattro membri: 2 pagamenti, non 3", () => {
    const D = "0190a000-0000-7000-8000-00000000000d";
    // Il greedy farebbe 3 pagamenti (700 → 500 e resto); i gruppi {A,C} e {B,D} ne vogliono 2.
    const balance = { [A]: 700, [B]: 500, [C]: -700, [D]: -500 };
    const plan = settlementPlan(balance);
    expect(plan).toEqual([
      { fromMemberId: C, toMemberId: A, amountCents: 700 },
      { fromMemberId: D, toMemberId: B, amountCents: 500 },
    ]);
    expect(Object.values(apply(balance, plan)).every((v) => v === 0)).toBe(true);
  });

  it("tre membri senza sottogruppi: due pagamenti che azzerano tutto", () => {
    const balance = { [A]: 1000, [B]: -300, [C]: -700 };
    const plan = settlementPlan(balance);
    expect(plan).toHaveLength(2);
    expect(Object.values(apply(balance, plan)).every((v) => v === 0)).toBe(true);
  });

  it("molti membri: greedy, al più n − 1 pagamenti, sempre a zero", () => {
    const ids = Array.from({ length: 14 }, (_, i) => `m${String(i).padStart(2, "0")}`);
    const balance = Object.fromEntries(
      ids.map((id, i) => [id, i < 13 ? (i % 2 ? 1 : -1) * (i + 1) * 100 : 0]),
    );
    balance[ids[13]!] = -Object.values(balance).reduce((s, v) => s + v, 0);
    const plan = settlementPlan(balance);
    expect(plan.length).toBeLessThanOrEqual(13);
    expect(Object.values(apply(balance, plan)).every((v) => v === 0)).toBe(true);
  });

  it("saldi che non sommano a zero sono un bug", () => {
    expect(() => settlementPlan({ [A]: 1 })).toThrow(RangeError);
  });
});

describe("settlementTransfer (AC-8)", () => {
  const payment = { fromMemberId: B, toMemberId: A, amountCents: 4000 };

  it("dal conto condiviso del debitore a quello del creditore, con settlement, e il saldo torna a zero", () => {
    const built = settlementTransfer(payment, {
      id: "0190a000-0000-7000-8000-000000000301",
      date: "2026-11-03",
      accounts,
    });
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    const doc = transactionSchema.parse({
      ...built.value,
      createdAtMs: 0,
      updatedAtMs: 0,
      createdByMemberId: A,
      updatedByMemberId: A,
    });
    expect(doc).toMatchObject({
      type: "transfer",
      accountId: CONTO_B,
      toAccountId: CONTO_A,
      settlement: { fromMemberId: B, toMemberId: A },
      visibility: "shared",
    });
    const split = { kind: "bp" as const, source: "category" as const, shares: { [A]: 6000, [B]: 4000 } };
    expect(nets([tx({ amountCents: 10001, split }), doc])).toEqual({ [A]: 0, [B]: 0 });
  });

  it("senza conti propri usa la cassa comune; conti scelti a mano vincono", () => {
    expect(settlementAccount(C, accounts)).toBe(COMUNE);
    const built = settlementTransfer(payment, {
      id: "0190a000-0000-7000-8000-000000000302",
      date: "2026-11-03",
      accounts,
      fromAccountId: COMUNE,
      toAccountId: PRIVATO_A,
    });
    expect(built.ok && built.value.accountId).toBe(COMUNE);
  });

  it("errori attesi: importo, stesso membro, un solo conto", () => {
    const base = { id: "x", date: "2026-11-03", accounts };
    expect(settlementTransfer({ ...payment, amountCents: 0 }, base)).toEqual({ ok: false, error: "amount" });
    expect(settlementTransfer({ ...payment, fromMemberId: A }, base)).toEqual({
      ok: false,
      error: "same_member",
    });
    expect(settlementTransfer(payment, { ...base, accounts: [account(COMUNE, null)] })).toEqual({
      ok: false,
      error: "no_accounts",
    });
  });
});

describe("findTransferPairs e mergeTransferPair (AC-9)", () => {
  let n = 0;
  const cand = (over: Partial<Transaction>) =>
    ({
      id: `0190a000-0000-7000-8000-${String(++n).padStart(12, "0")}`,
      type: "expense",
      date: "2026-11-03",
      amountCents: 5000,
      isRefund: false,
      accountId: CONTO_A,
      visibility: "shared",
      description: "",
      importBatchId: null,
      importFingerprints: [],
      ...over,
    }) as Transaction;

  it("stesso importo, conti diversi, entro 3 giorni: una coppia", () => {
    const out = cand({ description: "Bonifico a Bruno", importFingerprints: ["a".repeat(32)] });
    const inc = cand({
      type: "income",
      accountId: CONTO_B,
      date: "2026-11-05",
      importFingerprints: ["b".repeat(32)],
    });
    const pairs = findTransferPairs([out, inc], { accounts });
    expect(pairs).toEqual([{ out, in: inc, days: 2 }]);
    const merged = mergeTransferPair(pairs[0]!, "0190a000-0000-7000-8000-000000000999", accounts);
    expect(merged).toMatchObject({
      type: "transfer",
      accountId: CONTO_A,
      toAccountId: CONTO_B,
      date: "2026-11-03",
      description: "Bonifico a Bruno",
      importFingerprints: ["a".repeat(32), "b".repeat(32)],
      split: null,
      categoryId: null,
    });
  });

  it("niente coppia fuori finestra, stesso conto, importo diverso, rimborsi, privati o conti sconosciuti", () => {
    const out = cand({});
    const others = [
      cand({ type: "income", accountId: CONTO_B, date: "2026-11-07" }),
      cand({ type: "income", accountId: CONTO_A }),
      cand({ type: "income", accountId: CONTO_B, amountCents: 5001 }),
      cand({ type: "income", accountId: CONTO_B, isRefund: true }),
      cand({ type: "income", accountId: PRIVATO_A, visibility: "private" }),
      cand({ type: "income", accountId: "0190a000-0000-7000-8000-000000000777" }),
    ];
    expect(findTransferPairs([out, ...others], { accounts })).toEqual([]);
  });

  it("ogni movimento in una sola coppia, prima le date più vicine", () => {
    const out1 = cand({ date: "2026-11-01" });
    const out2 = cand({ date: "2026-11-03" });
    const inc = cand({ type: "income", accountId: CONTO_B, date: "2026-11-03" });
    const pairs = findTransferPairs([out1, out2, inc], { accounts });
    expect(pairs.map((p) => [p.out.id, p.in.id])).toEqual([[out2.id, inc.id]]);
  });

  it("maxDays si può cambiare", () => {
    const pairs = findTransferPairs(
      [cand({}), cand({ type: "income", accountId: CONTO_B, date: "2026-11-10" })],
      { accounts, maxDays: 7 },
    );
    expect(pairs).toHaveLength(1);
  });
});
