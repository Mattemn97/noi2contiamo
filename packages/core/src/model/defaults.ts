// Categorie iniziali di ogni famiglia nuova, scelte per una coppia italiana.
import { newId } from "../ids";
import type { WriteDocOf } from "./registry";

export const DEFAULT_CATEGORY_NAMES = {
  income: ["Stipendio", "Rimborsi / Varie"],
  expense: [
    "Spesa Alimentare",
    "Casa / Affitto / Mutuo",
    "Bollette / Utenze",
    "Trasporti / Auto / Moto",
    "Svago / Hobby / Uscite",
    "Salute / Farmacia",
    "Tecnologia / Software",
  ],
} as const;

/** Documenti delle categorie iniziali, con id nuovi e l'ordine dell'elenco. */
export function defaultCategories(makeId: () => string = newId): WriteDocOf<"categories">[] {
  return (["income", "expense"] as const).flatMap((kind) =>
    DEFAULT_CATEGORY_NAMES[kind].map((name, order) => ({ id: makeId(), name, kind, order })),
  );
}
