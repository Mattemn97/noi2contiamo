// Formato `noi2contiamo-export` v1 (AC-8): funzioni pure sopra i documenti, l'IO sta nell'adapter.
import { z } from "zod";
import { err, ok, type Result } from "../result";
import {
  COLLECTION_NAMES,
  parseDoc,
  zodIssues,
  type CollectionName,
  type DocOf,
  type ValidationIssue,
} from "./registry";
import { epochMsSchema, familySchema, type Family } from "./schemas";

export const EXPORT_FORMAT = "noi2contiamo-export";
export const EXPORT_VERSION = 1;

export type ExportCollections = { readonly [C in CollectionName]: readonly DocOf<C>[] };

export interface ExportFile {
  readonly format: typeof EXPORT_FORMAT;
  readonly version: typeof EXPORT_VERSION;
  readonly exportedAtMs: number;
  readonly sourceBackend: "memory" | "firebase" | "http";
  readonly family: Family;
  readonly users: readonly {
    readonly userId: string;
    readonly email: string;
    readonly displayName: string;
  }[];
  readonly collections: ExportCollections;
}

const envelopeSchema = z.strictObject({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAtMs: epochMsSchema,
  sourceBackend: z.enum(["memory", "firebase", "http"]),
  family: familySchema,
  users: z.array(
    z.strictObject({ userId: z.string().min(1), email: z.email(), displayName: z.string().min(1).max(60) }),
  ),
  collections: z.record(z.string(), z.array(z.unknown())),
});

/** Costruisce il file di export. Ordina i documenti per id, così due export uguali sono identici. */
export function buildExport(input: Omit<ExportFile, "format" | "version">): ExportFile {
  const sorted = Object.fromEntries(
    COLLECTION_NAMES.map((name) => [
      name,
      [...input.collections[name]].sort((a, b) => (a.id < b.id ? -1 : 1)),
    ]),
  ) as unknown as ExportCollections;
  return { format: EXPORT_FORMAT, version: EXPORT_VERSION, ...input, collections: sorted };
}

/**
 * Legge un file di export e lo prepara all'import: valida ogni documento e scollega i membri
 * dagli account (`userId: null`), che si ricollegano con `claimMember`.
 */
export function readExport(input: unknown): Result<ExportFile, ValidationIssue[]> {
  const envelope = envelopeSchema.safeParse(input);
  if (!envelope.success) return err(zodIssues(envelope.error));
  const issues: ValidationIssue[] = [];
  const unknownNames = Object.keys(envelope.data.collections).filter(
    (n) => !COLLECTION_NAMES.includes(n as never),
  );
  for (const name of unknownNames)
    issues.push({ path: `collections.${name}`, message: "collezione sconosciuta" });
  const collections = Object.fromEntries(
    COLLECTION_NAMES.map((name) => {
      const docs = (envelope.data.collections[name] ?? []).flatMap((raw, index) => {
        const parsed = parseDoc(name, raw);
        if (parsed.ok) return [parsed.value];
        issues.push(...parsed.error.map((i) => ({ ...i, path: `collections.${name}.${index}.${i.path}` })));
        return [];
      });
      return [name, name === "members" ? docs.map((m) => ({ ...m, userId: null })) : docs];
    }),
  ) as unknown as ExportCollections;
  if (issues.length > 0) return err(issues);
  return ok({ ...envelope.data, format: EXPORT_FORMAT, version: EXPORT_VERSION, collections });
}
