import { describe, expect, it } from "vitest";
import { DEFAULT_CATEGORY_NAMES, defaultCategories, missingDefaultCategories } from "./defaults";
import { parseDoc } from "./registry";

describe("categorie iniziali", () => {
  it("una decina di entrate e di uscite, valide, con id distinti e i nomi di sempre in testa", () => {
    const categories = defaultCategories();
    const income = categories.filter((c) => c.kind === "income");
    const expense = categories.filter((c) => c.kind === "expense");
    expect(income).toHaveLength(10);
    expect(expense).toHaveLength(12);
    expect(income.slice(0, 2).map((c) => c.name)).toEqual(["Stipendio", "Rimborsi / Varie"]);
    expect(expense[0]!.name).toBe("Spesa Alimentare");
    expect(expense.map((c) => c.order)).toEqual(expense.map((_, i) => i));
    expect(new Set(categories.map((c) => c.id)).size).toBe(categories.length);
    const audit = { createdAtMs: 1, updatedAtMs: 1 };
    for (const category of categories) {
      const parsed = parseDoc("categories", {
        ...category,
        ...audit,
        createdByMemberId: category.id,
        updatedByMemberId: category.id,
      });
      expect(parsed.ok, category.name).toBe(true);
    }
  });
});

describe("categorie suggerite mancanti", () => {
  it("aggiunge solo quelle che mancano, in fondo all'elenco del loro tipo", () => {
    const missing = missingDefaultCategories([
      { name: "stipendio", kind: "income", order: 0 },
      { name: "Spesa  alimentare", kind: "expense", order: 4 },
      { name: "Palestra", kind: "expense", order: 9 },
      // Stesso nome ma tipo diverso: non conta.
      { name: "Pensione", kind: "expense", order: 1 },
    ]);
    const names = missing.map((c) => c.name);
    expect(names).not.toContain("Stipendio");
    expect(names).not.toContain("Spesa Alimentare");
    expect(names).toContain("Pensione");
    expect(missing.filter((c) => c.kind === "income")).toHaveLength(9);
    expect(missing.filter((c) => c.kind === "expense")).toHaveLength(11);
    expect(missing.find((c) => c.kind === "income")!.order).toBe(1);
    expect(missing.find((c) => c.kind === "expense")!.order).toBe(10);
  });

  it("non aggiunge niente a una famiglia che le ha già tutte", () => {
    const all = defaultCategories();
    expect(missingDefaultCategories(all)).toEqual([]);
    expect(missingDefaultCategories([]).length).toBe(
      DEFAULT_CATEGORY_NAMES.income.length + DEFAULT_CATEGORY_NAMES.expense.length,
    );
  });
});
