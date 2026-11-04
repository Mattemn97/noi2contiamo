import { describe, expect, it } from "vitest";
import { accountBalance, balanceEffect, checkCategory, nameTaken, payeeFromName, pickable } from "./catalog";
import type { Category } from "./schemas";

const tx = (patch: Partial<Parameters<typeof balanceEffect>[0]>) => ({
  type: "expense" as const,
  date: "2026-03-01",
  amountCents: 1000,
  isRefund: false,
  accountId: "a",
  toAccountId: null,
  ...patch,
});

describe("saldo del conto", () => {
  it("entrate +, spese −, rimborsi al contrario, giroconti tra i due conti", () => {
    expect(balanceEffect(tx({ type: "income" }), "a")).toBe(1000);
    expect(balanceEffect(tx({}), "a")).toBe(-1000);
    expect(balanceEffect(tx({ isRefund: true }), "a")).toBe(1000);
    expect(balanceEffect(tx({ type: "income", isRefund: true }), "a")).toBe(-1000);
    expect(balanceEffect(tx({ type: "transfer", toAccountId: "b" }), "a")).toBe(-1000);
    expect(balanceEffect(tx({ type: "transfer", toAccountId: "b" }), "b")).toBe(1000);
    expect(balanceEffect(tx({}), "b")).toBe(0);
  });

  it("parte dal saldo iniziale e conta solo i movimenti dal giorno del saldo iniziale", () => {
    const account = { id: "a", initialBalanceCents: -2500, initialBalanceDate: "2026-03-01" };
    const list = [
      tx({ date: "2026-02-28", amountCents: 99999 }),
      tx({ amountCents: 1 }),
      tx({ type: "income", amountCents: 10001 }),
    ];
    expect(accountBalance(account, list)).toBe(-2500 - 1 + 10001);
    expect(accountBalance(account, [])).toBe(-2500);
  });
});

const category = (patch: Partial<Category>): Category =>
  ({ id: "c", name: "Casa", kind: "expense", parentId: null, archivedAtMs: null, ...patch }) as Category;

describe("nomi unici", () => {
  it("conti: normalizzati, solo tra i non archiviati", () => {
    const others = [{ id: "x", name: "Conto Comune", archivedAtMs: null }];
    expect(nameTaken("accounts", { id: "y", name: " conto  comune" }, others)).toBe(true);
    expect(nameTaken("accounts", { id: "x", name: "conto comune" }, others)).toBe(false);
    expect(nameTaken("accounts", { id: "y", name: "conto comune", archivedAtMs: 1 }, others)).toBe(false);
    expect(
      nameTaken("accounts", { id: "y", name: "conto comune" }, [{ ...others[0]!, archivedAtMs: 1 }]),
    ).toBe(false);
  });

  it("categorie: per tipo e genitore", () => {
    const others = [category({ id: "x", name: "Varie" })];
    expect(nameTaken("categories", category({ id: "y", name: "varie" }), others)).toBe(true);
    expect(nameTaken("categories", category({ id: "y", name: "varie", kind: "income" }), others)).toBe(false);
    expect(nameTaken("categories", category({ id: "y", name: "varie", parentId: "p" }), others)).toBe(false);
  });
});

describe("un solo livello di categorie", () => {
  const parent = category({ id: "p" });
  it("accetta una sottocategoria dello stesso tipo", () => {
    expect(checkCategory(category({ id: "c", parentId: "p" }), [parent]).ok).toBe(true);
    expect(checkCategory(parent, [parent]).ok).toBe(true);
  });

  it("rifiuta nipoti, tipo diverso, sé stessa, genitore inesistente e chi ha figli", () => {
    const child = category({ id: "c", parentId: "p" });
    const fail = (c: Category, all: Category[]) => {
      const result = checkCategory(c, all);
      return result.ok ? [] : result.error;
    };
    expect(fail(category({ id: "n", parentId: "c" }), [parent, child])).toHaveLength(1);
    expect(fail(category({ id: "n", parentId: "p", kind: "income" }), [parent])).toHaveLength(1);
    expect(fail(category({ id: "p", parentId: "p" }), [parent])).toHaveLength(1);
    expect(fail(category({ id: "n", parentId: "zz" }), [parent])).toHaveLength(1);
    expect(fail({ ...parent, parentId: "q" }, [parent, child, category({ id: "q" })])).toHaveLength(1);
  });
});

describe("destinatari e liste di scelta", () => {
  it("il nome normalizzato viene dal nome", () => {
    expect(payeeFromName("1", "  Caffè   Roma ")).toEqual({
      id: "1",
      name: "Caffè Roma",
      normalizedName: "caffe roma",
    });
  });

  it("le liste mostrano i non archiviati e quello già scelto", () => {
    const items = [
      { id: "a", archivedAtMs: null },
      { id: "b", archivedAtMs: 5 },
    ];
    expect(pickable(items).map((i) => i.id)).toEqual(["a"]);
    expect(pickable(items, "b").map((i) => i.id)).toEqual(["a", "b"]);
  });
});
