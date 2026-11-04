// Registro delle collezioni di famiglia: schema, campi interrogabili, ordini e visibilità (spec 0002).
import type { z } from "zod";
import { err, ok, type Result } from "../result";
import {
  accountSchema,
  categorySchema,
  importBatchSchema,
  importProfileSchema,
  inviteSchema,
  memberSchema,
  memberSettingsSchema,
  payeeSchema,
  recurrenceDismissalSchema,
  recurrenceSchema,
  reminderSchema,
  ruleSchema,
  transactionSchema,
  type AuditKey,
} from "./schemas";

export type OrderBy = "date_desc" | "order_asc" | "id_asc";

interface CollectionDef {
  readonly schema: z.ZodType;
  /** Campi ammessi in `where` (uguaglianza). */
  readonly indexed: readonly string[];
  /** Ordini ammessi; il primo è quello di default. */
  readonly orderBy: readonly OrderBy[];
  /** La collezione ha un campo `date` (ammette `dateFrom`/`dateTo`). */
  readonly hasDate: boolean;
  /** Ha `visibility` e `ownerMemberId`: l'adapter aggiunge da solo il vincolo di visibilità. */
  readonly scoped: boolean;
}

export const COLLECTIONS = {
  members: {
    schema: memberSchema,
    indexed: ["userId", "role"],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
  invites: {
    schema: inviteSchema,
    indexed: ["memberId"],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
  accounts: {
    schema: accountSchema,
    indexed: ["ownerMemberId", "kind"],
    orderBy: ["order_asc", "id_asc"],
    hasDate: false,
    scoped: true,
  },
  categories: {
    schema: categorySchema,
    indexed: ["kind", "parentId"],
    orderBy: ["order_asc", "id_asc"],
    hasDate: false,
    scoped: false,
  },
  payees: {
    schema: payeeSchema,
    indexed: ["normalizedName"],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
  transactions: {
    schema: transactionSchema,
    indexed: ["accountId", "recurrenceId", "importBatchId"],
    orderBy: ["date_desc", "id_asc"],
    hasDate: true,
    scoped: true,
  },
  rules: {
    schema: ruleSchema,
    indexed: ["enabled"],
    orderBy: ["order_asc", "id_asc"],
    hasDate: false,
    scoped: false,
  },
  importProfiles: {
    schema: importProfileSchema,
    indexed: ["headerSignature"],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
  importBatches: {
    schema: importBatchSchema,
    indexed: ["accountId"],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
  recurrences: {
    schema: recurrenceSchema,
    indexed: ["accountId"],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
  recurrenceDismissals: {
    schema: recurrenceDismissalSchema,
    indexed: [],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
  memberSettings: {
    schema: memberSettingsSchema,
    indexed: [],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
  reminders: {
    schema: reminderSchema,
    indexed: ["memberId", "status"],
    orderBy: ["id_asc"],
    hasDate: false,
    scoped: false,
  },
} as const satisfies Record<string, CollectionDef>;

type Registry = typeof COLLECTIONS;
export type CollectionName = keyof Registry;
export const COLLECTION_NAMES = Object.keys(COLLECTIONS) as CollectionName[];

/** Documento come si legge (default applicati). */
export type DocOf<C extends CollectionName> = z.output<Registry[C]["schema"]>;
/** Documento come si scrive: i campi con default sono opzionali, l'audit lo mette l'adapter. */
export type WriteDocOf<C extends CollectionName> = Omit<z.input<Registry[C]["schema"]>, AuditKey>;
export type IndexedField<C extends CollectionName> = Registry[C]["indexed"][number];
export type OrderByOf<C extends CollectionName> = Registry[C]["orderBy"][number];
export type DateCollection = {
  [C in CollectionName]: Registry[C]["hasDate"] extends true ? C : never;
}[CollectionName];
export type ScopedCollection = {
  [C in CollectionName]: Registry[C]["scoped"] extends true ? C : never;
}[CollectionName];

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export function zodIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join("."), message: issue.message }));
}

/** Valida e completa (default) un documento di una collezione. Errore come valore (AC-1). */
export function parseDoc<C extends CollectionName>(
  collection: C,
  input: unknown,
): Result<DocOf<C>, ValidationIssue[]> {
  const parsed = COLLECTIONS[collection].schema.safeParse(input);
  return parsed.success ? ok(parsed.data as DocOf<C>) : err(zodIssues(parsed.error));
}

export const isCollectionName = (value: string): value is CollectionName => Object.hasOwn(COLLECTIONS, value);
