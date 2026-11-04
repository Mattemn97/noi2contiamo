import { expect, it } from "vitest";
import { defaultCategories } from "./defaults";
import { parseDoc } from "./registry";

it("le categorie iniziali sono quelle del prototipo, valide e con id distinti", () => {
  const categories = defaultCategories();
  expect(categories.filter((c) => c.kind === "income").map((c) => c.name)).toEqual([
    "Stipendio",
    "Rimborsi / Varie",
  ]);
  expect(categories.filter((c) => c.kind === "expense")).toHaveLength(7);
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
