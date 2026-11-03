// Il piano di un import (spec 0006, AC-9..AC-14): doppioni, movimenti nuovi, giroconti, lotto e
// operazioni di commit. Annullare un lotto: `undoImportOps`.
import { autoSplit } from "../division";
import { fingerprintRows } from "../fingerprint";
import type { IsoDate } from "../ids";
import { accountDefaults } from "../model/invariants";
import { payeeFromName } from "../model/catalog";
import type { WriteDocOf } from "../model/registry";
import type { Account, Category, Family, ImportBatch, Payee, Transaction } from "../model/schemas";
import { findTransferPairs, mergeTransferPair, TRANSFER_MATCH_DAYS, type PairCandidate } from "../transfers";
import type { ParsedRow, ValidRow, InvalidRow } from "./rows";

/** Aggancio per le regole automatiche (feature 12): riceve il movimento con i default, lo restituisce. */
export type ImportHook = (tx: WriteDocOf<"transactions">, row: ValidRow) => WriteDocOf<"transactions">;

/** Le operazioni del piano, con la stessa forma di `CommitOp` del `DataAdapter`. */
export type ImportOp =
  | {
      readonly type: "put";
      readonly collection: "importProfiles";
      readonly doc: WriteDocOf<"importProfiles">;
    }
  | { readonly type: "put"; readonly collection: "importBatches"; readonly doc: WriteDocOf<"importBatches"> }
  | { readonly type: "put"; readonly collection: "payees"; readonly doc: WriteDocOf<"payees"> }
  | { readonly type: "put"; readonly collection: "transactions"; readonly doc: WriteDocOf<"transactions"> }
  | { readonly type: "remove"; readonly collection: "transactions" | "importBatches"; readonly id: string };

export type PlanItem =
  | { readonly status: "error"; readonly row: InvalidRow }
  | { readonly status: "duplicate"; readonly row: ValidRow; readonly fingerprint: string }
  | {
      readonly status: "new";
      readonly row: ValidRow;
      readonly fingerprint: string;
      readonly tx: WriteDocOf<"transactions">;
    }
  | {
      readonly status: "transfer";
      readonly row: ValidRow;
      readonly fingerprint: string;
      /** Il movimento già salvato che diventa il giroconto. */
      readonly other: Transaction;
      readonly tx: WriteDocOf<"transactions">;
    };

export interface PlanCounts {
  readonly rows: number;
  readonly new: number;
  readonly duplicate: number;
  readonly error: number;
  readonly transfer: number;
}

export interface PlanInput {
  readonly rows: readonly ParsedRow[];
  readonly account: Account;
  readonly accounts: readonly Account[];
  readonly family: Pick<Family, "defaultSplit">;
  readonly categories: readonly Category[];
  readonly payees: readonly Pick<Payee, "id" | "normalizedName">[];
  /** I movimenti visibili tra `dateFrom − 3` e `dateTo + 3` delle righe, di tutti i conti. */
  readonly existing: readonly Transaction[];
  readonly batchId: string;
  readonly profileId: string | null;
  readonly fileName: string;
  readonly fileHash: string;
  readonly nowMs: number;
  readonly newId: () => string;
  /** Profilo da salvare nello stesso commit (prima del lotto). */
  readonly profile?: WriteDocOf<"importProfiles">;
  /** Impronte delle righe per cui l'utente ha tolto il giroconto proposto. */
  readonly declinedTransfers?: ReadonlySet<string>;
  readonly hook?: ImportHook;
}

export interface ImportPlan {
  readonly items: PlanItem[];
  readonly counts: PlanCounts;
  /** Null se non c'è niente da importare. */
  readonly batch: WriteDocOf<"importBatches"> | null;
  readonly ops: ImportOp[];
}

const shiftDays = (date: IsoDate, days: number): IsoDate => {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

/** L'intervallo di date da leggere per doppioni e giroconti (null se non ci sono righe valide). */
export function planWindow(
  rows: readonly ParsedRow[],
): { readonly from: IsoDate; readonly to: IsoDate } | null {
  const dates = rows.flatMap((r) => (r.ok ? [r.date] : [])).sort();
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return null;
  return {
    from: shiftDays(first, -TRANSFER_MATCH_DAYS),
    to: shiftDays(last, TRANSFER_MATCH_DAYS),
  };
}

export function planImport(input: PlanInput): ImportPlan {
  const { account } = input;
  const valid = input.rows.filter((r): r is ValidRow => r.ok);
  const fingerprints = fingerprintRows(
    valid.map((r) => ({
      accountId: account.id,
      date: r.date,
      signedAmountCents: r.signedCents,
      description: r.description,
    })),
  );
  const fingerprintOf = new Map(valid.map((r, i) => [r, fingerprints[i] ?? ""]));
  const taken = new Set(input.existing.flatMap((t) => t.importFingerprints));

  const payeeIds = new Map(input.payees.map((p) => [p.normalizedName, p.id]));
  const newPayees: WriteDocOf<"payees">[] = [];
  const payeeFor = (name: string | null): string | null => {
    if (!name) return null;
    const payee = payeeFromName(input.newId(), name);
    if (payee.normalizedName === "") return null;
    const known = payeeIds.get(payee.normalizedName);
    if (known) return known;
    payeeIds.set(payee.normalizedName, payee.id);
    newPayees.push(payee);
    return payee.id;
  };

  const defaults = accountDefaults(account);
  const ctx = { family: input.family, categories: input.categories, accounts: input.accounts };
  const build = (row: ValidRow, fingerprint: string): WriteDocOf<"transactions"> => {
    const type = row.signedCents < 0 ? "expense" : "income";
    const payeeId = payeeFor(row.payee);
    const tx: WriteDocOf<"transactions"> = {
      id: input.newId(),
      type,
      date: row.date,
      amountCents: Math.abs(row.signedCents),
      accountId: account.id,
      categoryId: null,
      payeeId,
      description: row.description,
      split: autoSplit({ type, categoryId: null, accountId: account.id, ...defaults }, ctx),
      provenance: { category: "default", payee: payeeId ? "import" : "default", split: "default" },
      importBatchId: input.batchId,
      importFingerprints: [fingerprint],
      ...defaults,
    };
    return input.hook ? input.hook(tx, row) : tx;
  };

  const drafts = new Map<string, WriteDocOf<"transactions">>();
  const items: PlanItem[] = input.rows.map((row): PlanItem => {
    if (!row.ok) return { status: "error", row };
    const fingerprint = fingerprintOf.get(row) ?? "";
    if (taken.has(fingerprint)) return { status: "duplicate", row, fingerprint };
    const tx = build(row, fingerprint);
    drafts.set(tx.id, tx);
    return { status: "new", row, fingerprint, tx };
  });

  // Giroconti: una riga nuova e un movimento già salvato su un altro conto (spec 0005, AC-9).
  const others = new Map(
    input.existing.filter((t) => t.accountId !== account.id && t.type !== "transfer").map((t) => [t.id, t]),
  );
  const candidate = (t: WriteDocOf<"transactions">, fingerprint: string): PairCandidate => ({
    id: t.id,
    type: t.type,
    date: t.date,
    amountCents: t.amountCents,
    isRefund: t.isRefund ?? false,
    accountId: t.accountId,
    visibility: t.visibility ?? "shared",
    description: t.description ?? "",
    importBatchId: t.importBatchId ?? null,
    importFingerprints: [fingerprint],
  });
  const candidates: PairCandidate[] = [
    ...others.values(),
    ...items.flatMap((item) => (item.status === "new" ? [candidate(item.tx, item.fingerprint)] : [])),
  ];
  const pairs = findTransferPairs(candidates, { accounts: input.accounts }).filter(
    (pair) => drafts.has(pair.out.id) !== drafts.has(pair.in.id),
  );
  const merged = new Map<string, { other: Transaction; tx: WriteDocOf<"transactions"> }>();
  for (const pair of pairs) {
    const mine = drafts.has(pair.out.id) ? pair.out : pair.in;
    const other = others.get(mine === pair.out ? pair.in.id : pair.out.id);
    if (!other || input.declinedTransfers?.has(mine.importFingerprints[0] ?? "")) continue;
    const tx = mergeTransferPair(pair, other.id, input.accounts);
    if (tx)
      merged.set(mine.id, { other, tx: { ...tx, importBatchId: other.importBatchId, notes: other.notes } });
  }
  const finalItems = items.map((item): PlanItem => {
    if (item.status !== "new") return item;
    const m = merged.get(item.tx.id);
    return m
      ? { status: "transfer", row: item.row, fingerprint: item.fingerprint, other: m.other, tx: m.tx }
      : item;
  });

  const count = (status: PlanItem["status"]) => finalItems.filter((i) => i.status === status).length;
  const counts: PlanCounts = {
    rows: input.rows.length,
    new: count("new"),
    duplicate: count("duplicate"),
    error: count("error"),
    transfer: count("transfer"),
  };
  const imported = counts.new + counts.transfer;
  const dates = valid.map((r) => r.date).sort();
  const dateFrom = dates[0];
  const dateTo = dates[dates.length - 1];
  if (imported === 0 || dateFrom === undefined || dateTo === undefined)
    return { items: finalItems, counts, batch: null, ops: [] };

  const batch: WriteDocOf<"importBatches"> = {
    id: input.batchId,
    profileId: input.profileId,
    accountId: account.id,
    fileName: input.fileName.slice(0, 255) || "import.csv",
    fileHash: input.fileHash,
    rowCount: counts.rows,
    importedCount: imported,
    duplicateCount: counts.duplicate,
    dateFrom,
    dateTo,
    importedAtMs: input.nowMs,
  };
  const usedPayees = new Set(
    finalItems.flatMap((i) => (i.status === "new" && i.tx.payeeId ? [i.tx.payeeId] : [])),
  );
  const ops: ImportOp[] = [
    ...(input.profile ? [{ type: "put", collection: "importProfiles", doc: input.profile } as const] : []),
    { type: "put", collection: "importBatches", doc: batch },
    ...newPayees
      .filter((p) => usedPayees.has(p.id))
      .map((doc) => ({ type: "put", collection: "payees", doc }) as const),
    ...finalItems.flatMap((i) =>
      i.status === "new" || i.status === "transfer"
        ? [{ type: "put", collection: "transactions", doc: i.tx } as const]
        : [],
    ),
  ];
  return { items: finalItems, counts, batch, ops };
}

/** Annullare un lotto: via i suoi movimenti (visibili), poi il lotto. */
export function undoImportOps(
  batch: Pick<ImportBatch, "id">,
  transactions: readonly Pick<Transaction, "id" | "importBatchId">[],
): ImportOp[] {
  return [
    ...transactions
      .filter((t) => t.importBatchId === batch.id)
      .map((t) => ({ type: "remove", collection: "transactions", id: t.id }) as const),
    { type: "remove", collection: "importBatches", id: batch.id },
  ];
}
