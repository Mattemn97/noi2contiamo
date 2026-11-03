// Spec 0007: motore delle regole automatiche.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountSchema,
  applyRules,
  categorySchema,
  conditionsMatch,
  decodeBytes,
  descriptionMatches,
  evaluateRules,
  fileHash,
  guessSettings,
  nextRuleOrder,
  payeeNameFromDescription,
  planApplyRules,
  planImport,
  previewRule,
  readRows,
  reorderRules,
  ruleFromTransaction,
  ruleImportHook,
  ruleIssues,
  ruleMissingRefs,
  ruleSchema,
  suggestFromRules,
  transactionSchema,
  wildcardMatch,
  type Account,
  type RuleContext,
  type RuleLike,
  type Transaction,
  type WriteDocOf,
} from "../index";

const id = (n: number) => `0190c000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const A = id(1);
const B = id(2);
const COMUNE = id(10);
const REVOLUT = id(11);
const SPESA = id(20);
const SVAGO = id(21);
const STIPENDIO = id(22);
const ESSELUNGA = id(30);
const AMAZON = id(31);
const audit = { createdAtMs: 1, createdByMemberId: A, updatedAtMs: 1, updatedByMemberId: A };

const account = (accId: string, ownerMemberId: string | null): Account =>
  accountSchema.parse({
    id: accId,
    name: accId.slice(-3),
    kind: "checking",
    ownerMemberId,
    initialBalanceDate: "2026-01-01",
    ...audit,
  });
const category = (catId: string, kind: "income" | "expense", defaultSplit: unknown = null) =>
  categorySchema.parse({ id: catId, name: catId.slice(-3), kind, defaultSplit, ...audit });
const FAMILY = { defaultSplit: { kind: "bp" as const, shares: { [A]: 5000, [B]: 5000 } } };
const S6040 = { kind: "bp" as const, shares: { [A]: 6000, [B]: 4000 } };
const S7030 = { kind: "bp" as const, shares: { [A]: 7000, [B]: 3000 } };

const categories = [
  category(SPESA, "expense"),
  category(SVAGO, "expense", S7030),
  category(STIPENDIO, "income"),
];
const ctx: RuleContext = {
  family: FAMILY,
  categories,
  payees: [{ id: ESSELUNGA }, { id: AMAZON }],
  accounts: [account(COMUNE, null), account(REVOLUT, A)],
  activeMemberIds: new Set([A, B]),
};

let seq = 100;
type RuleInput = Partial<WriteDocOf<"rules">> & Pick<WriteDocOf<"rules">, "conditions" | "actions">;
function rule(over: RuleInput): RuleLike {
  return ruleSchema.parse({ id: id(++seq), name: "r", ...audit, ...over });
}
function tx(over: Partial<Transaction> = {}): Transaction {
  return transactionSchema.parse({
    id: id(++seq),
    type: "expense",
    date: "2026-10-01",
    amountCents: 4530,
    accountId: COMUNE,
    description: "PAGAMENTO POS ESSELUNGA 1234 MILANO",
    split: { kind: "bp", source: "default", shares: FAMILY.defaultSplit.shares },
    provenance: { category: "default", payee: "default", split: "default" },
    ...audit,
    ...over,
  });
}

describe("condizioni (AC-1, AC-2, AC-3)", () => {
  it("descrizione normalizzata: contains, startsWith, equals", () => {
    const d = "Pagamento POS  CAFFÈ Centrale";
    expect(descriptionMatches(d, { op: "contains", value: "caffe" })).toBe(true);
    expect(descriptionMatches(d, { op: "startsWith", value: "PAGAMENTO pos" })).toBe(true);
    expect(descriptionMatches(d, { op: "equals", value: "pagamento pos caffè centrale" })).toBe(true);
    expect(descriptionMatches(d, { op: "equals", value: "pagamento" })).toBe(false);
  });

  it("pattern con * e ? copre tutto il testo, il resto è letterale", () => {
    const d = "PAGAMENTO POS ESSELUNGA 1234 MILANO";
    expect(descriptionMatches(d, { op: "pattern", value: "pos * esselunga*" })).toBe(false);
    expect(descriptionMatches(d, { op: "pattern", value: "pagamento pos esselunga*" })).toBe(true);
    expect(descriptionMatches(d, { op: "pattern", value: "*esselunga ????*" })).toBe(true);
    expect(descriptionMatches(d, { op: "pattern", value: "esselunga" })).toBe(false);
    expect(descriptionMatches("a.b", { op: "pattern", value: "a.b" })).toBe(true);
    expect(descriptionMatches("axb", { op: "pattern", value: "a.b" })).toBe(false);
    expect(descriptionMatches("(a+)+$", { op: "pattern", value: "(a+)+$" })).toBe(true);
  });

  it("wildcard lineare anche con tante stelle su un testo lungo", () => {
    const text = "a".repeat(500);
    const start = Date.now();
    expect(wildcardMatch(text, "*a*a*a*a*a*a*a*a*a*a*a*a*b")).toBe(false);
    expect(Date.now() - start).toBeLessThan(200);
    expect(wildcardMatch("", "*")).toBe(true);
    expect(wildcardMatch("abc", "a*c")).toBe(true);
    expect(wildcardMatch("abc", "a?c")).toBe(true);
    expect(wildcardMatch("abc", "a?")).toBe(false);
  });

  it("tipo, conto (anche di arrivo), destinatario, membro e intervallo di importo", () => {
    const t = {
      type: "expense" as const,
      amountCents: 5000,
      accountId: COMUNE,
      toAccountId: null,
      payeeId: ESSELUNGA,
      payerMemberId: A,
    };
    const m = (c: object) => conditionsMatch(ruleSchema.shape.conditions.parse(c), t);
    expect(m({ types: ["expense"] })).toBe(true);
    expect(m({ types: ["income"] })).toBe(false);
    expect(m({ accountIds: [COMUNE] })).toBe(true);
    expect(
      conditionsMatch(ruleSchema.shape.conditions.parse({ accountIds: [REVOLUT] }), {
        ...t,
        type: "transfer",
        toAccountId: REVOLUT,
      }),
    ).toBe(true);
    expect(m({ payeeIds: [AMAZON] })).toBe(false);
    expect(m({ memberIds: [A] })).toBe(true);
    expect(
      conditionsMatch(ruleSchema.shape.conditions.parse({ memberIds: [A] }), { ...t, payerMemberId: null }),
    ).toBe(false);
    expect(m({ amountMinCents: 5000, amountMaxCents: 5000 })).toBe(true);
    expect(m({ amountMinCents: 5001 })).toBe(false);
    expect(m({ amountMaxCents: 4999 })).toBe(false);
  });

  it("all contro any", () => {
    const t = { type: "expense" as const, amountCents: 100, accountId: COMUNE };
    const c = { types: ["income"], accountIds: [COMUNE] };
    expect(conditionsMatch(ruleSchema.shape.conditions.parse(c), t)).toBe(false);
    expect(conditionsMatch(ruleSchema.shape.conditions.parse({ ...c, match: "any" }), t)).toBe(true);
  });

  it("schema: almeno una condizione e un'azione, min ≤ max, giroconto senza categoria", () => {
    const base = { id: id(900), name: "x", ...audit };
    expect(
      ruleSchema.safeParse({ ...base, conditions: { match: "any" }, actions: { payeeId: AMAZON } }).success,
    ).toBe(false);
    expect(ruleSchema.safeParse({ ...base, conditions: { types: ["expense"] }, actions: {} }).success).toBe(
      false,
    );
    expect(
      ruleSchema.safeParse({
        ...base,
        conditions: { amountMinCents: 10, amountMaxCents: 5 },
        actions: { payeeId: AMAZON },
      }).success,
    ).toBe(false);
    expect(
      ruleSchema.safeParse({
        ...base,
        conditions: { types: ["expense"] },
        actions: { transferAccountId: REVOLUT, categoryId: SPESA },
      }).success,
    ).toBe(false);
    expect(
      ruleSchema.safeParse({ ...base, conditions: { types: ["expense"] }, actions: { recurring: true } })
        .success,
    ).toBe(true);
  });

  it("una regola disabilitata non si applica", () => {
    const r = rule({ enabled: false, conditions: { types: ["expense"] }, actions: { categoryId: SPESA } });
    expect(applyRules(tx(), [r], ctx).categoryId).toBeNull();
  });
});

describe("azioni e ordine (AC-4..AC-7)", () => {
  const esselunga = rule({
    order: 0,
    conditions: { description: { op: "contains", value: "esselunga" } },
    actions: { categoryId: SPESA, payeeId: ESSELUNGA, split: S6040 },
  });

  it("categoria, destinatario e divisione con provenienza rule e ruleIds", () => {
    const out = applyRules(tx(), [esselunga], ctx);
    expect(out.categoryId).toBe(SPESA);
    expect(out.payeeId).toBe(ESSELUNGA);
    expect(out.split).toEqual({ kind: "bp", source: "rule", shares: S6040.shares });
    expect(out.provenance).toEqual({ category: "rule", payee: "rule", split: "rule" });
    expect(out.ruleIds).toEqual([esselunga.id]);
  });

  it("per ogni campo vince la prima; le altre impostano i campi liberi", () => {
    const later = rule({
      order: 5,
      conditions: { types: ["expense"] },
      actions: { categoryId: SVAGO, payeeId: AMAZON },
    });
    const generic = rule({ order: 9, conditions: { accountIds: [COMUNE] }, actions: { split: S7030 } });
    const first = rule({ order: 1, conditions: { types: ["expense"] }, actions: { categoryId: SPESA } });
    const out = applyRules(tx(), [generic, later, first], ctx);
    expect(out.categoryId).toBe(SPESA);
    expect(out.payeeId).toBe(AMAZON);
    expect(out.split?.shares).toEqual(S7030.shares);
    expect(out.ruleIds).toEqual([first.id, later.id, generic.id]);
  });

  it("a parità di order vince l'id più piccolo", () => {
    const r1 = rule({ order: 0, conditions: { types: ["expense"] }, actions: { categoryId: SPESA } });
    const r2 = rule({ order: 0, conditions: { types: ["expense"] }, actions: { categoryId: SVAGO } });
    expect(applyRules(tx(), [r2, r1], ctx).categoryId).toBe(SPESA);
  });

  it("le condizioni si valutano sui valori originali (niente concatenazione)", () => {
    const setsPayee = rule({ order: 0, conditions: { types: ["expense"] }, actions: { payeeId: AMAZON } });
    const onPayee = rule({ order: 1, conditions: { payeeIds: [AMAZON] }, actions: { categoryId: SVAGO } });
    expect(applyRules(tx(), [setsPayee, onPayee], ctx).categoryId).toBeNull();
  });

  it("azione non applicabile saltata: la regola dopo mette la sua (AC-6)", () => {
    const wrongKind = rule({
      order: 0,
      conditions: { types: ["expense"] },
      actions: { categoryId: STIPENDIO },
    });
    const missing = rule({
      order: 1,
      conditions: { types: ["expense"] },
      actions: { payeeId: id(999), split: { kind: "bp", shares: { [A]: 5000, [id(998)]: 5000 } } },
    });
    const ok = rule({
      order: 2,
      conditions: { types: ["expense"] },
      actions: { categoryId: SPESA, payeeId: ESSELUNGA },
    });
    const out = applyRules(tx(), [wrongKind, missing, ok], ctx);
    expect(out.categoryId).toBe(SPESA);
    expect(out.payeeId).toBe(ESSELUNGA);
    expect(out.split?.source).toBe("default");
    expect(out.ruleIds).toEqual([ok.id]);
  });

  it("privato: la divisione della regola si salta", () => {
    const r = rule({ conditions: { types: ["expense"] }, actions: { split: S6040 } });
    const priv = tx({
      visibility: "private",
      ownerMemberId: A,
      accountId: REVOLUT,
      split: { kind: "bp", source: "default", shares: { [A]: 10000 } },
    });
    expect(applyRules(priv, [r], ctx)).toBe(priv);
  });

  it("manuale mai sovrascritto (AC-7)", () => {
    const manual = tx({
      categoryId: SVAGO,
      provenance: { category: "manual", payee: "import", split: "manual" },
      split: { kind: "cents", source: "manual", shares: { [A]: 4530 } },
    });
    const out = applyRules(manual, [esselunga], ctx);
    expect(out.categoryId).toBe(SVAGO);
    expect(out.split?.source).toBe("manual");
    expect(out.payeeId).toBe(ESSELUNGA);
    expect(out.provenance).toEqual({ category: "manual", payee: "rule", split: "manual" });
  });

  it("categoria senza divisione di regola: la divisione segue la categoria", () => {
    const r = rule({ conditions: { types: ["expense"] }, actions: { categoryId: SVAGO } });
    const out = applyRules(tx(), [r], ctx);
    expect(out.split).toEqual({ kind: "bp", source: "category", shares: S7030.shares });
    expect(out.provenance.split).toBe("default");
  });

  it("giroconto: spesa da questo conto verso quello, entrata al contrario (AC-4)", () => {
    const r = rule({
      conditions: { description: { op: "contains", value: "revolut" } },
      actions: { transferAccountId: REVOLUT },
    });
    const out = applyRules(tx({ description: "GIROCONTO VERSO REVOLUT" }), [r], ctx);
    expect(out).toMatchObject({
      type: "transfer",
      accountId: COMUNE,
      toAccountId: REVOLUT,
      categoryId: null,
      split: null,
      visibility: "shared",
    });
    expect(transactionSchema.safeParse(out).success).toBe(true);
    const back = rule({ conditions: { types: ["income"] }, actions: { transferAccountId: REVOLUT } });
    const inc = applyRules(tx({ type: "income", description: "x" }), [back], ctx);
    expect(inc).toMatchObject({ type: "transfer", accountId: REVOLUT, toAccountId: COMUNE });
    expect(applyRules(tx({ accountId: REVOLUT }), [r], ctx).type).toBe("expense");
    expect(applyRules(tx({ description: "revolut", isRefund: true }), [r], ctx).type).toBe("expense");
  });

  it("recurring si somma e finisce in ruleIds", () => {
    const r1 = rule({ order: 0, conditions: { types: ["expense"] }, actions: { recurring: true } });
    const r2 = rule({
      order: 1,
      conditions: { types: ["expense"] },
      actions: { recurring: true, payeeId: AMAZON },
    });
    const out = evaluateRules(tx(), [r1, r2], ctx);
    expect(out.recurring).toEqual([r1.id, r2.id]);
    expect(applyRules(tx(), [r1, r2], ctx).ruleIds).toEqual([r2.id, r1.id]);
  });

  it("i giroconti non si toccano", () => {
    const transfer = tx({ type: "transfer", toAccountId: REVOLUT, split: null });
    expect(applyRules(transfer, [esselunga], ctx)).toBe(transfer);
  });
});

describe("import con le regole (AC-8)", () => {
  const file = new Uint8Array(
    readFileSync(join(import.meta.dirname, "..", "import", "fixtures", "revolut.csv")),
  );
  const settings = guessSettings(file);
  const read = readRows(decodeBytes(file, settings.encoding), settings);
  if (!read.ok) throw new Error("fixture");
  let n = 500;
  const newId = () => id(++n);
  const run = (rules: RuleLike[]) =>
    planImport({
      rows: read.value.rows,
      account: ctx.accounts[1]!,
      accounts: ctx.accounts,
      family: FAMILY,
      categories,
      payees: [],
      existing: [],
      batchId: newId(),
      profileId: null,
      fileName: "revolut.csv",
      fileHash: fileHash(file),
      nowMs: 1,
      newId,
      hook: ruleImportHook(rules, ctx),
    });

  it("la fixture esce con categoria, destinatario e giroconto dalle regole", () => {
    const rules = [
      rule({
        order: 0,
        conditions: { description: { op: "contains", value: "esselunga" } },
        actions: { categoryId: SPESA, payeeId: ESSELUNGA },
      }),
      rule({
        order: 1,
        conditions: { description: { op: "pattern", value: "to bruno*" } },
        actions: { transferAccountId: COMUNE },
      }),
      rule({ order: 2, enabled: false, conditions: { types: ["expense"] }, actions: { categoryId: SVAGO } }),
    ];
    const items = run(rules).items.flatMap((i) => (i.status === "new" ? [i.tx] : []));
    const ess = items.find((t) => t.description === "Esselunga");
    expect(ess).toMatchObject({ categoryId: SPESA, payeeId: ESSELUNGA, ruleIds: [rules[0]!.id] });
    const bruno = items.find((t) => t.description === "To Bruno Bianchi");
    expect(bruno).toMatchObject({
      type: "transfer",
      accountId: REVOLUT,
      toAccountId: COMUNE,
      categoryId: null,
      split: null,
    });
    const amazon = items.find((t) => t.description === "Amazon, Inc.");
    expect(amazon?.categoryId).toBeNull();
    for (const t of items) expect(transactionSchema.safeParse({ ...t, ...audit }).success).toBe(true);
  });

  it("senza regole l'import non cambia", () => {
    const plain = run([]).items.flatMap((i) => (i.status === "new" ? [i.tx.categoryId] : []));
    expect(plain.every((c) => c === null)).toBe(true);
  });
});

describe("applica ai movimenti esistenti e anteprima (AC-10, AC-11)", () => {
  const r = rule({
    conditions: { description: { op: "contains", value: "esselunga" } },
    actions: { categoryId: SPESA, payeeId: ESSELUNGA },
  });

  it("salta i campi manuali, cambia solo il resto, ed è idempotente", () => {
    const manual = tx({
      categoryId: SVAGO,
      provenance: { category: "manual", payee: "import", split: "default" },
      payeeId: AMAZON,
    });
    const fresh = tx();
    const other = tx({ description: "altro" });
    const done = tx({ categoryId: SPESA, payeeId: ESSELUNGA });
    const changes = planApplyRules([manual, fresh, other, done], [r], ctx);
    expect(changes.map((c) => [c.before.id, c.fields])).toEqual([
      [manual.id, ["payee"]],
      [fresh.id, ["category", "payee"]],
    ]);
    expect(changes[0]!.after.categoryId).toBe(SVAGO);
    const again = planApplyRules(
      changes.map((c) => c.after),
      [r],
      ctx,
    );
    expect(again).toEqual([]);
  });

  it("un campo messo da una regola che ora non corrisponde resta com'è", () => {
    const old = tx({
      description: "altro",
      categoryId: SVAGO,
      provenance: { category: "rule", payee: "default", split: "default" },
    });
    expect(planApplyRules([old], [r], ctx)).toEqual([]);
  });

  it("giroconto sui vecchi solo se nessun campo è manuale", () => {
    const t = rule({ conditions: { types: ["expense"] }, actions: { transferAccountId: REVOLUT } });
    const manual = tx({
      provenance: { category: "manual", payee: "default", split: "default" },
      categoryId: SPESA,
    });
    const auto = tx();
    expect(planApplyRules([manual, auto], [t], ctx).map((c) => [c.before.id, c.fields])).toEqual([
      [auto.id, ["transfer"]],
    ]);
  });

  it("anteprima: corrispondenze con esito e campi lasciati a mano", () => {
    const manual = tx({
      categoryId: SVAGO,
      provenance: { category: "manual", payee: "manual", split: "default" },
    });
    const fresh = tx();
    const preview = previewRule({ ...r, enabled: false }, [manual, fresh, tx({ description: "no" })], ctx);
    expect(preview).toHaveLength(2);
    expect(preview[0]).toMatchObject({ after: null, keptManual: ["category", "payee"] });
    expect(preview[1]!.fields).toEqual(["category", "payee"]);
  });
});

describe("suggerimenti nel modulo (AC-9)", () => {
  const r = rule({
    name: "Spesa",
    conditions: { description: { op: "contains", value: "esselunga" } },
    actions: { categoryId: SPESA, payeeId: ESSELUNGA, split: S6040, transferAccountId: undefined },
  });
  const t = rule({
    conditions: { types: ["expense"] },
    actions: { transferAccountId: REVOLUT, recurring: true },
  });

  it("propone i campi non toccati e mai il giroconto", () => {
    const s = suggestFromRules(
      { type: "expense", amountCents: 100, accountId: COMUNE, description: "esselunga" },
      [r, t],
      ctx,
    );
    expect(s.categoryId).toEqual({ value: SPESA, ruleId: r.id });
    expect(s.payeeId?.value).toBe(ESSELUNGA);
    expect(s.split?.value).toEqual(S6040);
    expect(s.recurring).toEqual([t.id]);
    expect("transferAccountId" in s).toBe(false);
    const touched = suggestFromRules(
      { type: "expense", amountCents: 100, accountId: COMUNE, description: "esselunga" },
      [r],
      ctx,
      new Set(["category"]),
    );
    expect(touched.categoryId).toBeUndefined();
    expect(touched.payeeId?.value).toBe(ESSELUNGA);
  });
});

describe("scrivere regole (AC-12..AC-15)", () => {
  it("destinatario dalla descrizione", () => {
    expect(payeeNameFromDescription("PAGAMENTO POS ESSELUNGA 1234 MILANO")).toBe("Esselunga");
    expect(payeeNameFromDescription("Pagamento POS · COOP CAFFÈ CENTRALE MILANO")).toBe(
      "Coop Caffè Centrale",
    );
    expect(payeeNameFromDescription("ADDEBITO SDD ENEL ENERGIA SPA MANDATO 123")).toBe("Enel Energia Spa");
    expect(payeeNameFromDescription("CARTA 1234 12/10 AMAZON*MKTPLACE")).toBe("Amazon Mktplace");
    expect(payeeNameFromDescription("BONIFICO A FAVORE DI MARIO ROSSI")).toBe("Mario Rossi");
    expect(payeeNameFromDescription("POS 1234 12/10/2026")).toBeNull();
    expect(payeeNameFromDescription("")).toBeNull();
  });

  it("regola dal movimento con destinatario nuovo e divisione manuale", () => {
    const t = tx({ categoryId: SPESA, split: { kind: "bp", source: "manual", shares: S6040.shares } });
    const made = ruleFromTransaction(t, []);
    expect(made.newPayeeName).toBe("Esselunga");
    expect(made.rule).toMatchObject({
      name: "Esselunga",
      conditions: { types: ["expense"], description: { op: "contains", value: "esselunga" } },
      actions: { categoryId: SPESA, split: S6040 },
    });
    const known = ruleFromTransaction(tx(), [
      { id: ESSELUNGA, name: "Esselunga", normalizedName: "esselunga" },
    ]);
    expect(known.newPayeeName).toBeNull();
    expect(known.rule.actions.payeeId).toBe(ESSELUNGA);
    const empty = ruleFromTransaction(tx({ description: "", payeeId: AMAZON }), [
      { id: AMAZON, name: "Amazon", normalizedName: "amazon" },
    ]);
    expect(empty.rule.conditions).toEqual({ types: ["expense"], payeeIds: [AMAZON] });
  });

  it("riordino e ordine di una regola nuova (AC-14)", () => {
    const list = [0, 1, 2, 3].map((o) => ({ id: id(700 + o), order: o * 10 }));
    expect(reorderRules(list, 3, 0).map((r) => [r.id, r.order])).toEqual([
      [id(703), 0],
      [id(700), 1],
      [id(701), 2],
      [id(702), 3],
    ]);
    expect(
      reorderRules(
        [
          { id: "a", order: 0 },
          { id: "b", order: 1 },
        ],
        0,
        1,
      ),
    ).toEqual([
      { id: "b", order: 0 },
      { id: "a", order: 1 },
    ]);
    expect(reorderRules(list, 1, 1)).toEqual([]);
    expect(reorderRules(list, 0, 9)).toEqual([]);
    expect(nextRuleOrder([])).toBe(0);
    expect(nextRuleOrder(list)).toBe(31);
  });

  it("controlli in italiano e riferimenti mancanti", () => {
    const good: RuleInput = {
      id: id(800),
      name: "ok",
      conditions: { types: ["expense"] },
      actions: { categoryId: SPESA },
    };
    expect(ruleIssues(good, ctx)).toEqual([]);
    expect(ruleIssues({ ...good, actions: { categoryId: STIPENDIO } }, ctx)).toEqual([
      "la categoria non è del tipo dei movimenti scelti",
    ]);
    expect(
      ruleIssues({ ...good, conditions: { memberIds: [id(5)] }, actions: { payeeId: id(6) } }, ctx),
    ).toEqual(["un membro della condizione non è attivo", "il destinatario non esiste"]);
    expect(ruleIssues({ ...good, actions: {} }, ctx)).toEqual(["serve almeno un'azione"]);
    expect(
      ruleMissingRefs(rule({ conditions: { types: ["expense"] }, actions: { categoryId: id(404) } }), ctx),
    ).toBe(true);
    expect(ruleMissingRefs(rule(good), ctx)).toBe(false);
  });
});
