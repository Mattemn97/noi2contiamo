// Categorie iniziali di ogni famiglia nuova, scelte per una coppia italiana.
import { newId } from "../ids";
import { normalize } from "../normalize";
import type { WriteDocOf } from "./registry";
import type { Category } from "./schemas";

export const DEFAULT_CATEGORY_NAMES = {
  income: [
    "Stipendio",
    "Rimborsi / Varie",
    "Tredicesima / Premi",
    "Lavoro autonomo / Fatture",
    "Pensione",
    "Affitti percepiti",
    "Interessi / Dividendi",
    "Bonus / Assegni familiari",
    "Regali ricevuti",
    "Vendite usato",
  ],
  expense: [
    "Spesa Alimentare",
    "Casa / Affitto / Mutuo",
    "Bollette / Utenze",
    "Trasporti / Auto / Moto",
    "Svago / Hobby / Uscite",
    "Salute / Farmacia",
    "Tecnologia / Software",
    "Ristoranti / Bar / Delivery",
    "Abbigliamento / Cura persona",
    "Viaggi / Vacanze",
    "Assicurazioni / Tasse",
    "Regali / Donazioni",
  ],
} as const;

/** Documenti delle categorie iniziali, con id nuovi e l'ordine dell'elenco. */
export function defaultCategories(makeId: () => string = newId): WriteDocOf<"categories">[] {
  return (["income", "expense"] as const).flatMap((kind) =>
    DEFAULT_CATEGORY_NAMES[kind].map((name, order) => ({ id: makeId(), name, kind, order })),
  );
}

/**
 * Le categorie suggerite che una famiglia esistente non ha ancora: stesso tipo e stesso nome normalizzato
 * (anche archiviata) contano come già presenti. Le nuove vanno in fondo all'elenco del loro tipo.
 */
export function missingDefaultCategories(
  existing: readonly {
    readonly name: string;
    readonly kind: Category["kind"];
    readonly order?: number | undefined;
  }[],
  makeId: () => string = newId,
): WriteDocOf<"categories">[] {
  return (["income", "expense"] as const).flatMap((kind) => {
    const mine = existing.filter((c) => c.kind === kind);
    const taken = new Set(mine.map((c) => normalize(c.name)));
    const start = mine.reduce((max, c) => Math.max(max, (c.order ?? 0) + 1), 0);
    return DEFAULT_CATEGORY_NAMES[kind]
      .filter((name) => !taken.has(normalize(name)))
      .map((name, i) => ({ id: makeId(), name, kind, order: start + i }));
  });
}
