// Suite di contract test condivisa: ogni adapter deve passarla (spec 0002, AC-4, AC-5, AC-6, AC-7, AC-8).
import {
  accountBalance,
  AUDIT_KEYS,
  autoSplit,
  memberAmounts,
  memberBalances,
  settlementPlan,
  settlementTransfer,
  reapplySplits,
  defaultCategories,
  filterTransactions,
  newId,
  periodRange,
  SUMMARY_DIMENSIONS,
  sumRows,
  summarize,
  totalsOf,
  type Result,
} from "@noi2contiamo/core";
import { describe, expect, it } from "vitest";
import type { CommitOp, Cursor, DataAdapter, DocOf, Page, WriteDocOf } from "../index";

const PASSWORD = "password-di-prova";

function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`atteso ok, ricevuto ${JSON.stringify(result.error)}`);
  return result.value;
}

function errorOf<T, E>(result: Result<T, E>): E {
  if (result.ok) throw new Error("atteso un errore, ricevuto ok");
  return result.error;
}

const account = (patch: Partial<WriteDocOf<"accounts">> = {}): WriteDocOf<"accounts"> => ({
  id: newId(),
  name: "Conto comune",
  kind: "checking",
  initialBalanceDate: "2026-01-01",
  ...patch,
});

/** Una famiglia con proprietario e partner (entrato con un invito), un conto comune e uno privato del proprietario. */
async function setup(adapter: DataAdapter) {
  const ownerUser = await adapter.auth.signUp("anna@example.com", PASSWORD);
  const familyId = newId();
  const ownerId = newId();
  unwrap(
    await adapter.membership.createFamily({
      family: { id: familyId, name: "Casa" },
      ownerMember: { id: ownerId, displayName: "Anna" },
      defaults: { categories: [{ id: newId(), name: "Spesa", kind: "expense" }] },
    }),
  );
  const { token } = unwrap(await adapter.membership.createInvite(familyId, { id: newId() }));
  await adapter.auth.signUp("bruno@example.com", PASSWORD);
  unwrap(await adapter.membership.acceptInvite(token, "Bruno"));
  const members = unwrap(await adapter.list(familyId, "members")).docs;
  const partnerId = members.find((m) => m.displayName === "Bruno")!.id;
  const shared = account();
  const mine = account({ name: "Personale Anna", visibility: "private", ownerMemberId: ownerId });
  const category = unwrap(await adapter.list(familyId, "categories")).docs[0]!;
  await adapter.auth.signIn("anna@example.com", PASSWORD);
  unwrap(await adapter.put(familyId, "accounts", shared));
  unwrap(await adapter.put(familyId, "accounts", mine));

  const expense = (patch: Partial<WriteDocOf<"transactions">> = {}): WriteDocOf<"transactions"> => ({
    id: newId(),
    type: "expense",
    date: "2026-11-03",
    amountCents: 10001,
    accountId: shared.id,
    categoryId: category.id,
    split: { kind: "bp", source: "category", shares: { [ownerId]: 6000, [partnerId]: 4000 } },
    ...patch,
  });
  const privateExpense = (patch: Partial<WriteDocOf<"transactions">> = {}) =>
    expense({
      accountId: mine.id,
      visibility: "private",
      ownerMemberId: ownerId,
      split: { kind: "bp", source: "manual", shares: { [ownerId]: 10000 } },
      ...patch,
    });
  const as = (who: "owner" | "partner") =>
    adapter.auth.signIn(who === "owner" ? "anna@example.com" : "bruno@example.com", PASSWORD);
  return { adapter, familyId, ownerId, partnerId, ownerUser, shared, mine, category, expense, privateExpense, as };
}

/** Gruppi della suite: un adapter può saltare quelli delle slice che non ha ancora (con un motivo). */
export type SuiteGroup =
  | "filo"
  | "documents"
  | "queries"
  | "commit"
  | "isolation"
  | "personal"
  | "fingerprint"
  | "membership"
  | "invites"
  | "catalog"
  | "register"
  | "split"
  | "balance"
  | "export";

export interface SuiteOptions {
  readonly skip?: readonly SuiteGroup[];
}

export function runContractSuite(name: string, makeAdapter: () => DataAdapter, options: SuiteOptions = {}) {
  const group = (id: SuiteGroup, title: string, body: () => void) =>
    (options.skip?.includes(id) ? describe.skip : describe)(title, body);

  describe(`contratto DataAdapter: ${name}`, () => {
    group("filo", "filo base: accesso, famiglia, primo movimento (feature 5)", () => {
      it("registrati, crea la famiglia con conto e categorie, aggiungi una spesa e vedila nel registro", async () => {
        const adapter = makeAdapter();
        const user = await adapter.auth.signUp("filo@example.com", PASSWORD);
        expect(await adapter.auth.currentUser()).toEqual(user);
        const familyId = newId();
        const ownerId = newId();
        const categories = defaultCategories();
        unwrap(
          await adapter.membership.createFamily({
            family: { id: familyId, name: "Casa Filo" },
            ownerMember: { id: ownerId, displayName: "Filo" },
            defaults: { categories },
          }),
        );
        const [summary] = unwrap(await adapter.membership.myFamilies());
        expect(summary).toMatchObject({ memberId: ownerId, role: "owner", family: { id: familyId, name: "Casa Filo" } });
        const listed = unwrap(await adapter.list(familyId, "categories", { orderBy: "order_asc" })).docs;
        expect(listed.map((c) => c.name).sort()).toEqual(categories.map((c) => c.name).sort());

        const shared = unwrap(await adapter.put(familyId, "accounts", account()));
        const spesa = listed.find((c) => c.name === "Spesa Alimentare")!;
        const tx = unwrap(
          await adapter.put(familyId, "transactions", {
            id: newId(),
            type: "expense",
            date: "2026-11-03",
            amountCents: 4250,
            accountId: shared.id,
            categoryId: spesa.id,
            description: "Supermercato",
            split: { kind: "bp", source: "default", shares: summary!.family.defaultSplit.shares },
          }),
        );
        expect(unwrap(await adapter.list(familyId, "transactions")).docs).toEqual([tx]);

        await adapter.auth.signOut();
        expect(await adapter.auth.currentUser()).toBeNull();
        await adapter.auth.signIn("filo@example.com", PASSWORD);
        expect(unwrap(await adapter.get(familyId, "transactions", tx.id))).toEqual(tx);
      });

      it("l'utente di un'altra famiglia non legge né modifica i dati", async () => {
        const adapter = makeAdapter();
        await adapter.auth.signUp("casa1@example.com", PASSWORD);
        const familyId = newId();
        const categories = defaultCategories();
        unwrap(
          await adapter.membership.createFamily({
            family: { id: familyId, name: "Casa Uno" },
            ownerMember: { id: newId(), displayName: "Uno" },
            defaults: { categories },
          }),
        );
        const shared = unwrap(await adapter.put(familyId, "accounts", account()));
        const [summary] = unwrap(await adapter.membership.myFamilies());
        const tx = unwrap(
          await adapter.put(familyId, "transactions", {
            id: newId(),
            type: "income",
            date: "2026-11-01",
            amountCents: 160000,
            accountId: shared.id,
            categoryId: categories.find((c) => c.kind === "income")!.id,
            split: { kind: "bp", source: "default", shares: summary!.family.defaultSplit.shares },
          }),
        );

        await adapter.auth.signUp("casa2@example.com", PASSWORD);
        unwrap(
          await adapter.membership.createFamily({
            family: { id: newId(), name: "Casa Due" },
            ownerMember: { id: newId(), displayName: "Due" },
          }),
        );
        expect(errorOf(await adapter.list(familyId, "transactions")).code).toBe("not_found");
        expect(errorOf(await adapter.get(familyId, "transactions", tx.id)).code).toBe("not_found");
        expect(errorOf(await adapter.put(familyId, "transactions", { ...tx, amountCents: 1 })).code).toBe("not_found");
        expect(errorOf(await adapter.remove(familyId, "transactions", tx.id)).code).toBe("not_found");
        expect(errorOf(await adapter.list(familyId, "accounts")).code).toBe("not_found");
        expect(unwrap(await adapter.membership.myFamilies()).map((f) => f.family.name)).toEqual(["Casa Due"]);

        await adapter.auth.signIn("casa1@example.com", PASSWORD);
        expect(unwrap(await adapter.get(familyId, "transactions", tx.id))).toEqual(tx);
      });
    });

    group("documents", "documenti (AC-4)", () => {
      it("salva con audit, legge, elenca e cancella", async () => {
        const { adapter, familyId, ownerId, expense } = await setup(makeAdapter());
        const tx = expense();
        const saved = unwrap(await adapter.put(familyId, "transactions", tx));
        expect(saved).toMatchObject({ ...tx, createdByMemberId: ownerId, updatedByMemberId: ownerId, isRefund: false });
        expect(unwrap(await adapter.get(familyId, "transactions", tx.id))).toEqual(saved);
        expect(unwrap(await adapter.list(familyId, "transactions")).docs).toEqual([saved]);
        unwrap(await adapter.remove(familyId, "transactions", tx.id));
        expect(errorOf(await adapter.get(familyId, "transactions", tx.id))).toEqual({ code: "not_found" });
      });

      it("riscrivere un documento mantiene chi l'ha creato", async () => {
        const { adapter, familyId, ownerId, partnerId, expense, as } = await setup(makeAdapter());
        const tx = expense();
        const first = unwrap(await adapter.put(familyId, "transactions", tx));
        await as("partner");
        const second = unwrap(await adapter.put(familyId, "transactions", { ...tx, description: "corretta" }));
        expect(second.createdByMemberId).toBe(ownerId);
        expect(second.createdAtMs).toBe(first.createdAtMs);
        expect(second.updatedByMemberId).toBe(partnerId);
      });

      it("rifiuta documenti non validi con un errore come valore (AC-1, AC-2)", async () => {
        const { adapter, familyId, expense, shared } = await setup(makeAdapter());
        expect(errorOf(await adapter.put(familyId, "transactions", expense({ amountCents: 10.5 }))).code).toBe(
          "invalid",
        );
        expect(
          errorOf(
            await adapter.put(familyId, "transactions", expense({ type: "transfer", toAccountId: shared.id, split: null })),
          ).code,
        ).toBe("invalid");
        expect(errorOf(await adapter.put(familyId, "transactions", expense({ accountId: newId() }))).code).toBe(
          "invalid",
        );
      });

      it("un conto usato da un movimento non si cancella", async () => {
        const { adapter, familyId, shared, expense } = await setup(makeAdapter());
        unwrap(await adapter.put(familyId, "transactions", expense()));
        expect(errorOf(await adapter.remove(familyId, "accounts", shared.id))).toEqual({
          code: "conflict",
          reason: "in_use",
        });
      });
    });

    group("queries", "query (AC-4)", () => {
      it("uguaglianza, intervallo di date inclusivo, ordine date decrescente poi id", async () => {
        const { adapter, familyId, expense, mine, privateExpense } = await setup(makeAdapter());
        const dates = ["2026-10-30", "2026-11-01", "2026-11-01", "2026-11-05"];
        const txs = dates.map((date) => expense({ date }));
        for (const tx of txs) unwrap(await adapter.put(familyId, "transactions", tx));
        unwrap(await adapter.put(familyId, "transactions", privateExpense({ date: "2026-11-02" })));

        const range = unwrap(
          await adapter.list(familyId, "transactions", { dateFrom: "2026-11-01", dateTo: "2026-11-05" }),
        ).docs;
        const sameDay = [txs[1]!.id, txs[2]!.id].sort().reverse();
        expect(range.map((t) => t.date)).toEqual(["2026-11-05", "2026-11-02", "2026-11-01", "2026-11-01"]);
        expect(range.slice(2).map((t) => t.id)).toEqual(sameDay);

        const onMine = unwrap(await adapter.list(familyId, "transactions", { where: { accountId: mine.id } })).docs;
        expect(onMine.map((t) => t.date)).toEqual(["2026-11-02"]);
        expect(unwrap(await adapter.list(familyId, "transactions", { scope: "shared" })).docs).toHaveLength(4);
        expect(unwrap(await adapter.list(familyId, "transactions", { scope: "mine" })).docs).toHaveLength(1);
      });

      it("limit e cursore scorrono tutto senza doppioni né buchi", async () => {
        const { adapter, familyId, expense } = await setup(makeAdapter());
        const ops: CommitOp[] = Array.from({ length: 7 }, (_, i) => ({
          type: "put",
          collection: "transactions",
          doc: expense({ date: `2026-11-0${(i % 3) + 1}` }),
        }));
        unwrap(await adapter.commit(familyId, ops));
        const all = unwrap(await adapter.list(familyId, "transactions")).docs.map((t) => t.id);
        const seen: string[] = [];
        let page = unwrap(await adapter.list(familyId, "transactions", { limit: 3 }));
        seen.push(...page.docs.map((t) => t.id));
        while (page.next) {
          page = unwrap(await adapter.list(familyId, "transactions", { limit: 3, after: page.next }));
          seen.push(...page.docs.map((t) => t.id));
        }
        expect(seen).toEqual(all);
        expect(all).toHaveLength(7);
      });

      it("ordine per order e cursore anche sui conti", async () => {
        const { adapter, familyId } = await setup(makeAdapter());
        for (const order of [3, 1, 2]) unwrap(await adapter.put(familyId, "accounts", account({ name: `C${order}`, order })));
        const first = unwrap(await adapter.list(familyId, "accounts", { orderBy: "order_asc", limit: 2 }));
        const rest = unwrap(await adapter.list(familyId, "accounts", { orderBy: "order_asc", after: first.next! }));
        expect([...first.docs, ...rest.docs].map((a) => a.order)).toEqual([0, 0, 1, 2, 3]);
        expect(rest.next).toBeNull();
      });

      it("rifiuta le query non dichiarate", async () => {
        const { adapter, familyId } = await setup(makeAdapter());
        expect(errorOf(await adapter.list(familyId, "transactions", { limit: 501 })).code).toBe("invalid_query");
        expect(errorOf(await adapter.list(familyId, "transactions", { limit: 0 })).code).toBe("invalid_query");
        // @ts-expect-error: `description` non è un campo indicizzato.
        const where = await adapter.list(familyId, "transactions", { where: { description: "x" } });
        expect(errorOf(where).code).toBe("invalid_query");
        // @ts-expect-error: i conti non hanno `date`.
        const dated = await adapter.list(familyId, "accounts", { dateFrom: "2026-01-01" });
        expect(errorOf(dated).code).toBe("invalid_query");
      });
    });

    group("commit", "commit (AC-4)", () => {
      it("è atomico: se un'operazione fallisce non scrive niente", async () => {
        const { adapter, familyId, expense } = await setup(makeAdapter());
        const old = expense();
        unwrap(await adapter.put(familyId, "transactions", old));
        const result = await adapter.commit(familyId, [
          { type: "put", collection: "transactions", doc: expense() },
          { type: "remove", collection: "transactions", id: old.id },
          { type: "put", collection: "transactions", doc: expense({ amountCents: -1 }) },
        ]);
        expect(errorOf(result).code).toBe("invalid");
        expect(unwrap(await adapter.list(familyId, "transactions")).docs.map((t) => t.id)).toEqual([old.id]);
      });

      it("applica put e remove insieme e rifiuta oltre 500 operazioni", async () => {
        const { adapter, familyId, expense } = await setup(makeAdapter());
        const old = expense();
        const next = expense();
        unwrap(await adapter.put(familyId, "transactions", old));
        unwrap(
          await adapter.commit(familyId, [
            { type: "put", collection: "transactions", doc: next },
            { type: "remove", collection: "transactions", id: old.id },
          ]),
        );
        expect(unwrap(await adapter.list(familyId, "transactions")).docs.map((t) => t.id)).toEqual([next.id]);
        const many: CommitOp[] = Array.from({ length: 501 }, () => ({ type: "remove", collection: "payees", id: newId() }));
        expect(errorOf(await adapter.commit(familyId, many)).code).toBe("invalid");
      });
    });

    group("isolation", "isolamento (AC-5)", () => {
      it("chi non è membro riceve un rifiuto su ogni collezione", async () => {
        const { adapter, familyId, shared } = await setup(makeAdapter());
        await adapter.auth.signUp("estraneo@example.com", PASSWORD);
        const collections = [
          "members",
          "invites",
          "accounts",
          "categories",
          "payees",
          "transactions",
          "rules",
          "importProfiles",
          "importBatches",
          "recurrences",
          "recurrenceDismissals",
          "memberSettings",
          "reminders",
        ] as const;
        for (const collection of collections) {
          expect((await adapter.list(familyId, collection)).ok, collection).toBe(false);
          expect((await adapter.get(familyId, collection, shared.id)).ok, collection).toBe(false);
          expect((await adapter.remove(familyId, collection, shared.id)).ok, collection).toBe(false);
        }
        expect((await adapter.put(familyId, "accounts", account())).ok).toBe(false);
        expect((await adapter.commit(familyId, [])).ok).toBe(false);
        expect(unwrap(await adapter.membership.myFamilies())).toEqual([]);
        await adapter.auth.signOut();
        expect(errorOf(await adapter.list(familyId, "accounts")).code).toBe("unauthenticated");
      });

      it("i dati di una famiglia non compaiono in un'altra", async () => {
        const { adapter, familyId, expense } = await setup(makeAdapter());
        unwrap(await adapter.put(familyId, "transactions", expense()));
        const otherId = newId();
        unwrap(
          await adapter.membership.createFamily({
            family: { id: otherId, name: "Altra" },
            ownerMember: { id: newId(), displayName: "Anna" },
          }),
        );
        expect(unwrap(await adapter.list(otherId, "transactions")).docs).toEqual([]);
        expect(unwrap(await adapter.list(otherId, "accounts")).docs).toEqual([]);
        expect(unwrap(await adapter.membership.myFamilies()).map((f) => f.family.id).sort()).toEqual(
          [familyId, otherId].sort(),
        );
      });

      it("il partner non legge né scrive il conto privato e i movimenti privati", async () => {
        const { adapter, familyId, mine, partnerId, privateExpense, as } = await setup(makeAdapter());
        const priv = privateExpense();
        unwrap(await adapter.put(familyId, "transactions", priv));
        await as("partner");
        expect(errorOf(await adapter.get(familyId, "accounts", mine.id)).code).toBe("not_found");
        expect(errorOf(await adapter.get(familyId, "transactions", priv.id)).code).toBe("not_found");
        expect(unwrap(await adapter.list(familyId, "accounts")).docs.map((a) => a.id)).not.toContain(mine.id);
        expect(unwrap(await adapter.list(familyId, "transactions")).docs).toEqual([]);
        expect(unwrap(await adapter.list(familyId, "transactions", { where: { accountId: mine.id } })).docs).toEqual([]);
        expect((await adapter.put(familyId, "transactions", { ...priv, description: "presa" })).ok).toBe(false);
        expect((await adapter.remove(familyId, "transactions", priv.id)).ok).toBe(false);
        const stolen = privateExpense({ ownerMemberId: partnerId, split: { kind: "bp", source: "manual", shares: { [partnerId]: 10000 } } });
        expect((await adapter.put(familyId, "transactions", stolen)).ok).toBe(false);
      });

      (options.skip?.includes("personal") ? it.skip : it)("impostazioni e promemoria li vede solo il membro a cui appartengono", async () => {
        const { adapter, familyId, ownerId, as } = await setup(makeAdapter());
        unwrap(await adapter.put(familyId, "memberSettings", { id: ownerId }));
        unwrap(
          await adapter.put(familyId, "reminders", {
            id: newId(),
            memberId: ownerId,
            kind: "settlement",
            fireAtMs: 1,
            title: "Pareggio",
            dedupKey: "settlement||2026-11",
          }),
        );
        await as("partner");
        expect(unwrap(await adapter.list(familyId, "memberSettings")).docs).toEqual([]);
        expect(unwrap(await adapter.list(familyId, "reminders")).docs).toEqual([]);
        expect((await adapter.put(familyId, "memberSettings", { id: ownerId })).ok).toBe(false);
      });
    });

    group("fingerprint", "impronta di import (AC-6)", () => {
      it("una seconda riga con la stessa impronta viene rifiutata", async () => {
        const { adapter, familyId, expense } = await setup(makeAdapter());
        const fingerprint = "0123456789abcdef0123456789abcdef";
        unwrap(await adapter.put(familyId, "transactions", expense({ importFingerprints: [fingerprint] })));
        expect(errorOf(await adapter.put(familyId, "transactions", expense({ importFingerprints: [fingerprint] })))).toEqual({
          code: "conflict",
          reason: "duplicate_fingerprint",
        });
      });
    });

    group("membership", "membri e inviti (AC-7)", () => {
      it("creare una famiglia scrive famiglia, proprietario, accesso e categorie insieme", async () => {
        const adapter = makeAdapter();
        await adapter.auth.signUp("carla@example.com", PASSWORD);
        const familyId = newId();
        const ownerId = newId();
        const broken = await adapter.membership.createFamily({
          family: { id: familyId, name: "Casa" },
          ownerMember: { id: ownerId, displayName: "Carla" },
          defaults: { categories: [{ id: newId(), name: "", kind: "expense" }] },
        });
        expect(errorOf(broken).code).toBe("invalid");
        expect(unwrap(await adapter.membership.myFamilies())).toEqual([]);
        unwrap(
          await adapter.membership.createFamily({
            family: { id: familyId, name: "Casa" },
            ownerMember: { id: ownerId, displayName: "Carla" },
          }),
        );
        const [summary] = unwrap(await adapter.membership.myFamilies());
        expect(summary).toMatchObject({ memberId: ownerId, role: "owner" });
        expect(summary!.family.defaultSplit).toEqual({ kind: "bp", shares: { [ownerId]: 10000 } });
      });

      it("accettare un invito crea l'accesso e segna l'invito come usato", async () => {
        const { adapter, familyId, partnerId, as } = await setup(makeAdapter());
        await as("partner");
        const [summary] = unwrap(await adapter.membership.myFamilies());
        expect(summary).toMatchObject({ memberId: partnerId, role: "member" });
        const [invite] = unwrap(await adapter.list(familyId, "invites")).docs;
        expect(invite!.usedAtMs).not.toBeNull();
      });

      it("un invito usato, scaduto, revocato o inesistente viene rifiutato", async () => {
        const { adapter, familyId, as } = await setup(makeAdapter());
        const used = unwrap(await adapter.membership.createInvite(familyId, { id: newId() })).token;
        const expired = unwrap(await adapter.membership.createInvite(familyId, { id: newId(), expiresAtMs: 1 })).token;
        const revokedId = newId();
        const revoked = unwrap(await adapter.membership.createInvite(familyId, { id: revokedId })).token;
        const invite = unwrap(await adapter.get(familyId, "invites", revokedId));
        unwrap(await adapter.put(familyId, "invites", { ...invite, revokedAtMs: 5 }));
        await adapter.auth.signUp("dario@example.com", PASSWORD);
        unwrap(await adapter.membership.acceptInvite(used, "Dario"));
        await adapter.auth.signUp("elena@example.com", PASSWORD);
        expect(errorOf(await adapter.membership.acceptInvite(used, "Elena")).code).toBe("used");
        expect(errorOf(await adapter.membership.acceptInvite(expired, "Elena")).code).toBe("expired");
        expect(errorOf(await adapter.membership.acceptInvite(revoked, "Elena")).code).toBe("revoked");
        expect(errorOf(await adapter.membership.acceptInvite("nonesiste", "Elena")).code).toBe("not_found");
        expect(unwrap(await adapter.membership.myFamilies())).toEqual([]);
        await as("partner");
        expect(errorOf(await adapter.membership.createInvite(familyId, { id: newId() })).code).toBe("forbidden");
      });

      it("un invito legato a un membro segnaposto gli collega l'account", async () => {
        const { adapter, familyId } = await setup(makeAdapter());
        const placeholder = newId();
        unwrap(await adapter.put(familyId, "members", { id: placeholder, displayName: "Nonna", role: "member", joinedAtMs: 1 }));
        const { token } = unwrap(await adapter.membership.createInvite(familyId, { id: newId(), memberId: placeholder }));
        await adapter.auth.signUp("nonna@example.com", PASSWORD);
        expect(unwrap(await adapter.membership.acceptInvite(token, "Ignorato"))).toBe(familyId);
        expect(unwrap(await adapter.membership.myFamilies())[0]).toMatchObject({ memberId: placeholder });
      });

      it("l'ultimo proprietario non può uscire; un membro esce e perde l'accesso", async () => {
        const { adapter, familyId, partnerId, as } = await setup(makeAdapter());
        expect(errorOf(await adapter.membership.leaveFamily(familyId))).toEqual({ code: "conflict", reason: "last_owner" });
        await as("partner");
        unwrap(await adapter.membership.leaveFamily(familyId));
        expect((await adapter.list(familyId, "accounts")).ok).toBe(false);
        await as("owner");
        const partner = unwrap(await adapter.get(familyId, "members", partnerId));
        expect(partner.leftAtMs).not.toBeNull();
      });

      it("un membro non si promuove a proprietario da solo", async () => {
        const { adapter, familyId, partnerId, as } = await setup(makeAdapter());
        await as("partner");
        const me = unwrap(await adapter.get(familyId, "members", partnerId));
        expect(errorOf(await adapter.put(familyId, "members", { ...me, role: "owner" })).code).toBe("forbidden");
        unwrap(await adapter.put(familyId, "members", { ...me, color: "#336699" }));
      });
    });

    group("invites", "inviti, ruoli e uscita (feature 6)", () => {
      it("il partner entrato con l'invito vede i movimenti comuni del proprietario", async () => {
        const { adapter, familyId, expense, privateExpense, as } = await setup(makeAdapter());
        const shared = unwrap(await adapter.put(familyId, "transactions", expense()));
        unwrap(await adapter.put(familyId, "transactions", privateExpense()));
        await as("partner");
        const seen = unwrap(await adapter.list(familyId, "transactions")).docs;
        expect(seen.map((tx) => tx.id)).toEqual([shared.id]);
        const members = unwrap(await adapter.list(familyId, "members")).docs;
        expect(members.map((m) => m.displayName).sort()).toEqual(["Anna", "Bruno"]);
      });

      it("il proprietario cambia i ruoli; l'ultimo proprietario non si declassa; un membro non cambia ruoli", async () => {
        const { adapter, familyId, ownerId, partnerId, as } = await setup(makeAdapter());
        expect(errorOf(await adapter.membership.setMemberRole(familyId, ownerId, "member"))).toEqual({
          code: "conflict",
          reason: "last_owner",
        });
        unwrap(await adapter.membership.setMemberRole(familyId, partnerId, "owner"));
        await as("partner");
        expect(unwrap(await adapter.membership.myFamilies())[0]).toMatchObject({ role: "owner" });
        unwrap(await adapter.membership.createInvite(familyId, { id: newId() }));
        unwrap(await adapter.membership.setMemberRole(familyId, partnerId, "member"));
        expect(errorOf(await adapter.membership.setMemberRole(familyId, ownerId, "member")).code).toBe("forbidden");
        expect(errorOf(await adapter.membership.removeMember(familyId, ownerId)).code).toBe("forbidden");
      });

      it("il proprietario toglie un membro, che perde l'accesso ma resta nello storico", async () => {
        const { adapter, familyId, partnerId, as } = await setup(makeAdapter());
        unwrap(await adapter.membership.removeMember(familyId, partnerId));
        expect(unwrap(await adapter.get(familyId, "members", partnerId)).leftAtMs).not.toBeNull();
        await as("partner");
        expect(unwrap(await adapter.membership.myFamilies())).toEqual([]);
        expect(errorOf(await adapter.list(familyId, "transactions")).code).toBe("not_found");
      });

      it("chi è uscito rientra con un nuovo invito e ritrova lo stesso membro", async () => {
        const { adapter, familyId, partnerId, as } = await setup(makeAdapter());
        await as("partner");
        unwrap(await adapter.membership.leaveFamily(familyId));
        await as("owner");
        const { token } = unwrap(await adapter.membership.createInvite(familyId, { id: newId() }));
        await as("partner");
        expect(unwrap(await adapter.membership.acceptInvite(token, "Bruno di nuovo"))).toBe(familyId);
        expect(unwrap(await adapter.membership.myFamilies())[0]).toMatchObject({ memberId: partnerId, role: "member" });
        const { token: again } = await (async () => {
          await as("owner");
          return unwrap(await adapter.membership.createInvite(familyId, { id: newId() }));
        })();
        await as("partner");
        expect(errorOf(await adapter.membership.acceptInvite(again, "Bruno"))).toEqual({
          code: "conflict",
          reason: "already_member",
        });
      });

      it("un invito usato non torna valido riscrivendolo; si può solo revocare", async () => {
        const { adapter, familyId } = await setup(makeAdapter());
        const [used] = unwrap(await adapter.list(familyId, "invites")).docs;
        expect(errorOf(await adapter.put(familyId, "invites", { ...used!, usedAtMs: null, usedByUserId: null })).code).toBe(
          "forbidden",
        );
        const id = newId();
        unwrap(await adapter.membership.createInvite(familyId, { id }));
        const pending = unwrap(await adapter.get(familyId, "invites", id));
        const revoked = unwrap(await adapter.put(familyId, "invites", { ...pending, revokedAtMs: 10 }));
        expect(revoked.revokedAtMs).toBe(10);
      });
    });

    group("catalog", "conti, categorie e destinatari (feature 7)", () => {
      it("crea, rinomina e archivia un conto; il nome è unico tra i conti attivi", async () => {
        const { adapter, familyId, shared } = await setup(makeAdapter());
        const savings = unwrap(
          await adapter.put(familyId, "accounts", account({ name: "Risparmi", kind: "savings", initialBalanceCents: -500 })),
        );
        expect(savings).toMatchObject({ initialBalanceCents: -500, visibility: "shared", ownerMemberId: null });
        const renamed = unwrap(await adapter.put(familyId, "accounts", { ...savings, name: "Fondo casa" }));
        expect(renamed.name).toBe("Fondo casa");
        expect(errorOf(await adapter.put(familyId, "accounts", account({ name: " conto  COMUNE " })))).toEqual({
          code: "conflict",
          reason: "duplicate",
        });
        const archived = unwrap(await adapter.put(familyId, "accounts", { ...renamed, archivedAtMs: 1 }));
        expect(archived.archivedAtMs).toBe(1);
        unwrap(await adapter.put(familyId, "accounts", account({ name: "Fondo casa" })));
        const names = unwrap(await adapter.list(familyId, "accounts")).docs.map((a) => a.name);
        expect(names).toContain(shared.name);
        expect(names.filter((n) => n === "Fondo casa")).toHaveLength(2);
      });

      it("categorie su un solo livello, dello stesso tipo, con nome unico per tipo e genitore", async () => {
        const { adapter, familyId, category } = await setup(makeAdapter());
        const child = unwrap(
          await adapter.put(familyId, "categories", {
            id: newId(),
            name: "Frutta",
            kind: "expense",
            parentId: category.id,
            color: "series-3",
            defaultSplit: { kind: "bp", shares: { [category.createdByMemberId]: 10000 } },
          }),
        );
        expect(child).toMatchObject({ parentId: category.id, color: "series-3" });
        expect(child.defaultSplit?.shares).toEqual({ [category.createdByMemberId]: 10000 });
        const grandchild = { id: newId(), name: "Mele", kind: "expense" as const, parentId: child.id };
        expect(errorOf(await adapter.put(familyId, "categories", grandchild)).code).toBe("invalid");
        const wrongKind = { id: newId(), name: "Bonus", kind: "income" as const, parentId: category.id };
        expect(errorOf(await adapter.put(familyId, "categories", wrongKind)).code).toBe("invalid");
        expect(errorOf(await adapter.put(familyId, "categories", { ...category, parentId: child.id })).code).toBe("invalid");
        const twin = { id: newId(), name: "frutta", kind: "expense" as const, parentId: category.id };
        expect(errorOf(await adapter.put(familyId, "categories", twin))).toEqual({ code: "conflict", reason: "duplicate" });
        unwrap(await adapter.put(familyId, "categories", { ...twin, parentId: null }));
        expect(errorOf(await adapter.remove(familyId, "categories", category.id))).toEqual({
          code: "conflict",
          reason: "in_use",
        });
        unwrap(await adapter.put(familyId, "categories", { ...child, name: "Frutta e verdura", archivedAtMs: 7 }));
      });

      it("destinatari: nome normalizzato unico, usati nei movimenti, non cancellabili se usati", async () => {
        const { adapter, familyId, expense } = await setup(makeAdapter());
        const payee = unwrap(
          await adapter.put(familyId, "payees", { id: newId(), name: "Caffè Roma", normalizedName: "caffe roma" }),
        );
        const twin = { id: newId(), name: "CAFFE  roma", normalizedName: "caffe roma" };
        expect(errorOf(await adapter.put(familyId, "payees", twin))).toEqual({ code: "conflict", reason: "duplicate" });
        const tx = unwrap(await adapter.put(familyId, "transactions", expense({ payeeId: payee.id })));
        expect(tx.payeeId).toBe(payee.id);
        expect(errorOf(await adapter.put(familyId, "transactions", expense({ payeeId: newId() }))).code).toBe("invalid");
        expect(errorOf(await adapter.remove(familyId, "payees", payee.id))).toEqual({ code: "conflict", reason: "in_use" });
        const renamed = unwrap(
          await adapter.put(familyId, "payees", { ...payee, name: "Bar Roma", normalizedName: "bar roma", archivedAtMs: 3 }),
        );
        expect(renamed).toMatchObject({ name: "Bar Roma", archivedAtMs: 3 });
        const listed = unwrap(await adapter.list(familyId, "payees", { where: { normalizedName: "bar roma" } })).docs;
        expect(listed.map((p) => p.id)).toEqual([payee.id]);
      });

      it("il saldo del conto, calcolato in core, torna con saldo iniziale, entrate, spese, rimborsi e giroconti", async () => {
        const { adapter, familyId, shared, expense } = await setup(makeAdapter());
        const savings = unwrap(
          await adapter.put(familyId, "accounts", account({ name: "Risparmi", initialBalanceCents: 100000, initialBalanceDate: "2026-02-01" })),
        );
        const salaryCategory = unwrap(
          await adapter.put(familyId, "categories", { id: newId(), name: "Stipendio", kind: "income" }),
        );
        const plain = (patch: Partial<WriteDocOf<"transactions">>) => expense({ accountId: savings.id, ...patch });
        unwrap(await adapter.put(familyId, "transactions", plain({ amountCents: 2550 })));
        unwrap(await adapter.put(familyId, "transactions", plain({ amountCents: 1000, isRefund: true })));
        unwrap(
          await adapter.put(familyId, "transactions", plain({ type: "income", categoryId: salaryCategory.id, amountCents: 200000 })),
        );
        unwrap(await adapter.put(familyId, "transactions", plain({ date: "2026-01-15", amountCents: 99999 })));
        unwrap(
          await adapter.put(familyId, "transactions", {
            id: newId(),
            type: "transfer",
            date: "2026-11-03",
            amountCents: 30000,
            accountId: savings.id,
            toAccountId: shared.id,
          }),
        );
        const txs = unwrap(await adapter.list(familyId, "transactions")).docs;
        // 1000,00 − 25,50 + 10,00 + 2000,00 − 300,00 (la spesa di gennaio è prima del saldo iniziale)
        expect(accountBalance(savings, txs)).toBe(100000 - 2550 + 1000 + 200000 - 30000);
        const common = unwrap(await adapter.get(familyId, "accounts", shared.id));
        expect(accountBalance(common, txs)).toBe(30000);
      });
    });

    group("register", "registro movimenti (feature 8)", () => {
      it("il periodo si legge con l'intervallo di date e tutte le pagine; filtri e riassunti di core tornano col totale", async () => {
        const { adapter, familyId, ownerId, shared, mine, expense, privateExpense } = await setup(makeAdapter());
        const dates = ["2026-10-31", "2026-11-01", "2026-11-15", "2026-11-30", "2026-12-01"];
        const ops: CommitOp[] = dates.map((date, i) => ({
          type: "put",
          collection: "transactions",
          doc: expense({ date, amountCents: 1000 * (i + 1), payerMemberId: i % 2 === 0 ? ownerId : null }),
        }));
        ops.push({ type: "put", collection: "transactions", doc: privateExpense({ date: "2026-11-10", amountCents: 7 }) });
        unwrap(await adapter.commit(familyId, ops));

        const range = periodRange("thisMonth", "2026-11-20");
        const txs: DocOf<"transactions">[] = [];
        let cursor: Cursor | null = null;
        do {
          const page: Page<"transactions"> = unwrap(
            await adapter.list(familyId, "transactions", {
              dateFrom: range.from!,
              dateTo: range.to!,
              limit: 2,
              ...(cursor ? { after: cursor } : {}),
            }),
          );
          txs.push(...page.docs);
          cursor = page.next;
        } while (cursor);
        expect(txs.map((t) => t.date)).toEqual(["2026-11-30", "2026-11-15", "2026-11-10", "2026-11-01"]);
        expect(totalsOf(txs)).toMatchObject({ count: 4, expenseCents: 2000 + 3000 + 4000 + 7 });
        for (const dimension of SUMMARY_DIMENSIONS) expect(sumRows(summarize(txs, dimension))).toEqual(totalsOf(txs));
        expect(filterTransactions(txs, { accountId: mine.id }).map((t) => t.amountCents)).toEqual([7]);
        expect(filterTransactions(txs, { accountId: shared.id, memberId: "none" })).toHaveLength(2);
      });

      it("modificare un movimento lo sposta di periodo e di conto; cancellarlo lo toglie dai totali", async () => {
        const { adapter, familyId, ownerId, mine, expense, as } = await setup(makeAdapter());
        const tx = unwrap(await adapter.put(familyId, "transactions", expense({ description: "prima" })));
        const moved = unwrap(
          await adapter.put(familyId, "transactions", {
            ...expense({ id: tx.id }),
            date: "2026-12-24",
            description: "dopo",
            accountId: mine.id,
            visibility: "private",
            ownerMemberId: ownerId,
            split: { kind: "bp", source: "manual", shares: { [ownerId]: 10000 } },
          }),
        );
        expect(moved).toMatchObject({ id: tx.id, description: "dopo", createdAtMs: tx.createdAtMs });
        const november = unwrap(
          await adapter.list(familyId, "transactions", { dateFrom: "2026-11-01", dateTo: "2026-11-30" }),
        ).docs;
        expect(november).toEqual([]);
        await as("partner");
        expect(unwrap(await adapter.list(familyId, "transactions")).docs).toEqual([]);
        expect((await adapter.remove(familyId, "transactions", tx.id)).ok).toBe(false);
        await as("owner");
        unwrap(await adapter.remove(familyId, "transactions", tx.id));
        expect(totalsOf(unwrap(await adapter.list(familyId, "transactions")).docs).count).toBe(0);
      });
    });

    group("split", "divisione spese (feature 9, spec 0004)", () => {
      it("ogni membro cambia la divisione della famiglia; chiavi non membri o somma sbagliata rifiutate", async () => {
        const { adapter, familyId, ownerId, partnerId, as } = await setup(makeAdapter());
        await as("partner");
        const split = { kind: "bp" as const, shares: { [ownerId]: 5000, [partnerId]: 5000 } };
        unwrap(await adapter.membership.setDefaultSplit(familyId, split));
        const mine = unwrap(await adapter.membership.myFamilies()).find((f) => f.family.id === familyId);
        expect(mine?.family.defaultSplit).toEqual(split);
        expect(
          errorOf(await adapter.membership.setDefaultSplit(familyId, { kind: "bp", shares: { [newId()]: 10000 } })).code,
        ).toBe("invalid");
        expect(
          errorOf(await adapter.membership.setDefaultSplit(familyId, { kind: "bp", shares: { [ownerId]: 9999 } })).code,
        ).toBe("invalid");
      });

      it("chi non è membro riceve not_found", async () => {
        const { adapter, familyId, ownerId } = await setup(makeAdapter());
        await adapter.auth.signUp("carla@example.com", PASSWORD);
        expect(
          errorOf(await adapter.membership.setDefaultSplit(familyId, { kind: "bp", shares: { [ownerId]: 10000 } }))
            .code,
        ).toBe("not_found");
      });

      it("fotografia e riapplica: la quota salvata resta finché non si riapplica; manuale e centesimi restano", async () => {
        const { adapter, familyId, ownerId, partnerId, category, expense } = await setup(makeAdapter());
        const auto = unwrap(
          await adapter.put(
            familyId,
            "transactions",
            expense({ split: { kind: "bp", source: "default", shares: { [ownerId]: 10000 } } }),
          ),
        );
        const manual = unwrap(
          await adapter.put(
            familyId,
            "transactions",
            expense({ split: { kind: "cents", source: "manual", shares: { [ownerId]: 1, [partnerId]: 10000 } } }),
          ),
        );
        expect(
          errorOf(
            await adapter.put(
              familyId,
              "transactions",
              expense({ split: { kind: "cents", source: "manual", shares: { [ownerId]: 1, [partnerId]: 1 } } }),
            ),
          ).code,
        ).toBe("invalid");
        const rent = { kind: "bp" as const, shares: { [ownerId]: 6000, [partnerId]: 4000 } };
        unwrap(await adapter.put(familyId, "categories", { ...category, defaultSplit: rent }));
        const categories = unwrap(await adapter.list(familyId, "categories")).docs;
        const accounts = unwrap(await adapter.list(familyId, "accounts")).docs;
        const family = unwrap(await adapter.membership.myFamilies()).find((f) => f.family.id === familyId)!.family;
        const ctx = { family, categories, accounts };
        expect(unwrap(await adapter.get(familyId, "transactions", auto.id)).split).toEqual(auto.split);
        const txs = unwrap(await adapter.list(familyId, "transactions")).docs;
        const changed = reapplySplits(txs, ctx);
        expect(changed.map((t) => t.id)).toEqual([auto.id]);
        const audit: readonly string[] = AUDIT_KEYS;
        const doc = Object.fromEntries(
          Object.entries(changed[0]!).filter(([key]) => !audit.includes(key)),
        ) as WriteDocOf<"transactions">;
        unwrap(await adapter.commit(familyId, [{ type: "put", collection: "transactions", doc }]));
        const saved = unwrap(await adapter.get(familyId, "transactions", auto.id));
        expect(saved.split).toEqual({ ...rent, source: "category" });
        expect(memberAmounts(saved.amountCents, saved.split!)).toEqual({ [ownerId]: 6001, [partnerId]: 4000 });
        expect(unwrap(await adapter.get(familyId, "transactions", manual.id)).split?.source).toBe("manual");
        expect(autoSplit(saved, ctx).source).toBe("category");
      });
    });

    group("balance", "giroconti e saldo tra i membri (feature 10, spec 0005)", () => {
      it("un giroconto non cambia i totali; il pareggio salvato come giroconto porta il saldo a zero", async () => {
        const { adapter, familyId, ownerId, partnerId, shared, expense, as } = await setup(makeAdapter());
        const annas = unwrap(await adapter.put(familyId, "accounts", account({ name: "Conto Anna", ownerMemberId: ownerId })));
        const brunos = unwrap(await adapter.put(familyId, "accounts", account({ name: "Conto Bruno", ownerMemberId: partnerId })));
        unwrap(await adapter.put(familyId, "transactions", expense({ accountId: annas.id, payerMemberId: ownerId })));
        const before = totalsOf(unwrap(await adapter.list(familyId, "transactions")).docs);
        unwrap(
          await adapter.put(familyId, "transactions", {
            id: newId(),
            type: "transfer",
            date: "2026-11-03",
            amountCents: 2500,
            accountId: annas.id,
            toAccountId: shared.id,
          }),
        );
        const withTransfer = unwrap(await adapter.list(familyId, "transactions")).docs;
        expect(totalsOf(withTransfer)).toEqual({ ...before, count: before.count + 1 });

        const family = unwrap(await adapter.membership.myFamilies()).find((f) => f.family.id === familyId)!.family;
        const accounts = unwrap(await adapter.list(familyId, "accounts")).docs;
        const ctx = { accounts, family, memberIds: [ownerId, partnerId] };
        const nets = (txs: typeof withTransfer) =>
          Object.fromEntries(memberBalances(txs, ctx).rows.map((r) => [r.memberId, r.netCents]));
        const start = nets(withTransfer);
        expect(start[ownerId]).toBeGreaterThan(0);
        expect(start[ownerId]! + start[partnerId]!).toBe(0);
        const [payment] = settlementPlan(start);
        expect(payment).toMatchObject({ fromMemberId: partnerId, toMemberId: ownerId });

        await as("partner");
        const doc = settlementTransfer(payment!, { id: newId(), date: "2026-11-04", accounts, description: "Pareggio" });
        if (!doc.ok) throw new Error(doc.error);
        expect(doc.value).toMatchObject({ accountId: brunos.id, toAccountId: annas.id });
        const saved = unwrap(await adapter.put(familyId, "transactions", doc.value));
        expect(saved.settlement).toEqual({ fromMemberId: partnerId, toMemberId: ownerId });
        const after = unwrap(await adapter.list(familyId, "transactions")).docs;
        expect(nets(after)).toEqual({ [ownerId]: 0, [partnerId]: 0 });
        expect(totalsOf(after).netCents).toBe(before.netCents);
      });

      it("un pareggio con lo stesso membro dalle due parti è rifiutato", async () => {
        const { adapter, familyId, ownerId, shared, mine } = await setup(makeAdapter());
        const result = await adapter.put(familyId, "transactions", {
          id: newId(),
          type: "transfer",
          date: "2026-11-03",
          amountCents: 100,
          accountId: mine.id,
          toAccountId: shared.id,
          settlement: { fromMemberId: ownerId, toMemberId: ownerId },
        });
        expect(errorOf(result).code).toBe("invalid");
      });
    });

    group("export", "export e import v1 (AC-8)", () => {
      it("un export reimportato in un altro adapter dà documenti identici, con userId null finché non si reclamano", async () => {
        const { adapter, familyId, ownerId, expense, privateExpense } = await setup(makeAdapter());
        unwrap(await adapter.put(familyId, "transactions", expense()));
        unwrap(await adapter.put(familyId, "transactions", privateExpense()));
        const file = unwrap(await adapter.membership.exportFamily(familyId));
        expect(file).toMatchObject({ format: "noi2contiamo-export", version: 1 });
        expect(file.users.map((u) => u.email).sort()).toEqual(["anna@example.com", "bruno@example.com"]);

        const target = makeAdapter();
        await target.auth.signUp("anna@example.com", PASSWORD);
        expect(unwrap(await target.membership.importFamily(JSON.parse(JSON.stringify(file)) as typeof file))).toBe(
          familyId,
        );
        expect((await target.list(familyId, "accounts")).ok).toBe(false);
        unwrap(await target.membership.claimMember(familyId, ownerId));

        const again = unwrap(await target.membership.exportFamily(familyId));
        const members = again.collections.members;
        expect(members.find((m) => m.id === ownerId)!.userId).not.toBeNull();
        expect(members.filter((m) => m.id !== ownerId).every((m) => m.userId === null)).toBe(true);
        const strip = (f: typeof file) => ({
          ...f.collections,
          members: f.collections.members.map((m) => ({ ...m, userId: null })),
        });
        expect(strip(again)).toEqual(strip(file));
        expect(again.family).toEqual(file.family);
      });

      it("solo l'utente con la stessa email reclama un membro importato", async () => {
        const { adapter, familyId, partnerId } = await setup(makeAdapter());
        const file = unwrap(await adapter.membership.exportFamily(familyId));
        const target = makeAdapter();
        await target.auth.signUp("anna@example.com", PASSWORD);
        unwrap(await target.membership.importFamily(file));
        expect((await target.membership.claimMember(familyId, partnerId)).ok).toBe(false);
        await target.auth.signUp("bruno@example.com", PASSWORD);
        unwrap(await target.membership.claimMember(familyId, partnerId));
      });
    });
  });
}
