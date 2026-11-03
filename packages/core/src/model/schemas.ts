// Schemi zod di tutte le collezioni (spec 0002). Stessa forma JSON in Firestore e nel server.
import { z } from "zod";
import { isIsoDate, isUuidV7 } from "../ids";
import { normalize } from "../normalize";
import { FULL_BP } from "../split";

// ---- Tipi di base -------------------------------------------------------------------------

export const idSchema = z.string().refine(isUuidV7, "id non UUIDv7");
export const userIdSchema = z.string().min(1).max(128);
export const isoDateSchema = z.string().refine(isIsoDate, "data non YYYY-MM-DD");
export const epochMsSchema = z.int().nonnegative();
/** Centesimi interi con segno (`Number.isSafeInteger`). */
export const centsSchema = z.int();
export const positiveCentsSchema = z.int().positive();
export const bpSchema = z.int().min(0).max(FULL_BP);
const nullableId = idSchema.nullable().default(null);
const nullableMs = epochMsSchema.nullable().default(null);
const nameSchema = z.string().trim().min(1).max(60);

export const auditShape = {
  createdAtMs: epochMsSchema,
  createdByMemberId: idSchema,
  updatedAtMs: epochMsSchema,
  updatedByMemberId: idSchema,
};
export const AUDIT_KEYS = ["createdAtMs", "createdByMemberId", "updatedAtMs", "updatedByMemberId"] as const;
export type AuditKey = (typeof AUDIT_KEYS)[number];

const sumOf = (shares: Record<string, number>) => Object.values(shares).reduce((a, b) => a + b, 0);

export const splitSpecSchema = z
  .strictObject({ kind: z.literal("bp"), shares: z.record(idSchema, bpSchema) })
  .refine((s) => sumOf(s.shares) === FULL_BP, "le quote devono sommare a 10000");

export const transactionSplitSchema = z
  .strictObject({
    kind: z.enum(["bp", "cents"]),
    source: z.enum(["default", "category", "rule", "manual"]),
    shares: z.record(idSchema, z.int().nonnegative()),
  })
  .refine((s) => Object.keys(s.shares).length > 0, "servono quote per almeno un membro")
  .refine((s) => s.kind !== "bp" || sumOf(s.shares) === FULL_BP, "le quote devono sommare a 10000");

export const transactionTypeSchema = z.enum(["income", "expense", "transfer"]);
export const descriptionMatchSchema = z.strictObject({
  op: z.enum(["contains", "startsWith", "equals"]),
  value: z.string().min(1).max(200),
});
/** Testo della descrizione in una regola: anche `pattern` con `*` e `?` (spec 0007, AC-2). */
export const ruleDescriptionSchema = z.strictObject({
  op: z.enum(["contains", "startsWith", "equals", "pattern"]),
  value: z.string().trim().min(1).max(200),
});

// ---- Globali ------------------------------------------------------------------------------

export const userSchema = z.strictObject({
  id: userIdSchema,
  email: z.email().refine((e) => e === e.toLowerCase(), "email in minuscolo"),
  displayName: nameSchema,
  createdAtMs: epochMsSchema,
});

export const familySchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default("EUR"),
  defaultSplit: splitSpecSchema,
  schemaVersion: z.int().positive().default(1),
  createdByUserId: userIdSchema,
  ...auditShape,
});

// ---- Di famiglia --------------------------------------------------------------------------

export const memberSchema = z.strictObject({
  id: idSchema,
  displayName: nameSchema,
  userId: userIdSchema.nullable().default(null),
  role: z.enum(["owner", "member"]),
  color: z.string().max(32).nullable().default(null),
  joinedAtMs: epochMsSchema,
  leftAtMs: nullableMs,
  ...auditShape,
});

export const inviteSchema = z.strictObject({
  id: idSchema,
  role: z.enum(["owner", "member"]).default("member"),
  memberId: nullableId,
  expiresAtMs: epochMsSchema,
  usedAtMs: nullableMs,
  usedByUserId: userIdSchema.nullable().default(null),
  revokedAtMs: nullableMs,
  ...auditShape,
});

export const accountSchema = z
  .strictObject({
    id: idSchema,
    name: nameSchema,
    kind: z.enum(["checking", "savings", "cash", "card", "other"]),
    ownerMemberId: nullableId,
    visibility: z.enum(["shared", "private"]).default("shared"),
    initialBalanceCents: centsSchema.default(0),
    initialBalanceDate: isoDateSchema,
    order: z.int().default(0),
    archivedAtMs: nullableMs,
    ...auditShape,
  })
  .refine((a) => a.visibility === "shared" || a.ownerMemberId !== null, {
    message: "un conto privato richiede ownerMemberId",
    path: ["visibility"],
  });

export const categorySchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  kind: z.enum(["income", "expense"]),
  parentId: nullableId,
  defaultSplit: splitSpecSchema.nullable().default(null),
  color: z.string().max(32).nullable().default(null),
  icon: z.string().max(64).nullable().default(null),
  order: z.int().default(0),
  archivedAtMs: nullableMs,
  ...auditShape,
});

export const payeeSchema = z
  .strictObject({
    id: idSchema,
    name: z.string().trim().min(1).max(100),
    normalizedName: z.string().min(1).max(100),
    archivedAtMs: nullableMs,
    ...auditShape,
  })
  .refine((p) => p.normalizedName === normalize(p.name), {
    message: "normalizedName deve essere normalize(name)",
    path: ["normalizedName"],
  });

const provenanceValue = z.enum(["manual", "rule", "import", "default"]);

/** Invarianti del movimento che non richiedono altri documenti (AC-2). */
export function transactionShapeIssues(tx: {
  type: "income" | "expense" | "transfer";
  amountCents: number;
  accountId: string;
  toAccountId: string | null;
  categoryId: string | null;
  split: { kind: "bp" | "cents"; shares: Record<string, number> } | null;
  settlement: { fromMemberId: string; toMemberId: string } | null;
  visibility: "shared" | "private";
  ownerMemberId: string | null;
}): string[] {
  const issues: string[] = [];
  if (tx.type === "transfer") {
    if (tx.toAccountId === null) issues.push("toAccountId: obbligatorio per un giroconto");
    if (tx.toAccountId === tx.accountId) issues.push("toAccountId: deve essere diverso da accountId");
    if (tx.categoryId !== null) issues.push("categoryId: vietato per un giroconto");
    if (tx.split !== null) issues.push("split: vietato per un giroconto");
    if (tx.settlement && tx.settlement.fromMemberId === tx.settlement.toMemberId)
      issues.push("settlement: servono due membri diversi");
  } else {
    if (tx.toAccountId !== null) issues.push("toAccountId: solo per un giroconto");
    if (tx.split === null) issues.push("split: obbligatorio per entrate e spese");
    if (tx.settlement !== null) issues.push("settlement: solo per un giroconto");
  }
  if (tx.split) {
    const sum = sumOf(tx.split.shares);
    if (tx.split.kind === "cents" && sum !== tx.amountCents)
      issues.push(`split: le quote in centesimi sommano a ${sum}, non a ${tx.amountCents}`);
  }
  if (tx.visibility === "private") {
    if (tx.ownerMemberId === null) issues.push("ownerMemberId: obbligatorio per un movimento privato");
    else if (tx.split && Object.keys(tx.split.shares).some((m) => m !== tx.ownerMemberId))
      issues.push("split: un movimento privato può dividere solo sul proprietario");
  }
  return issues;
}

export const transactionSchema = z
  .strictObject({
    id: idSchema,
    type: transactionTypeSchema,
    date: isoDateSchema,
    amountCents: positiveCentsSchema,
    isRefund: z.boolean().default(false),
    accountId: idSchema,
    toAccountId: nullableId,
    categoryId: nullableId,
    payeeId: nullableId,
    description: z.string().max(500).default(""),
    notes: z.string().max(1000).nullable().default(null),
    payerMemberId: nullableId,
    split: transactionSplitSchema.nullable().default(null),
    settlement: z.strictObject({ fromMemberId: idSchema, toMemberId: idSchema }).nullable().default(null),
    visibility: z.enum(["shared", "private"]).default("shared"),
    ownerMemberId: nullableId,
    provenance: z
      .strictObject({
        category: provenanceValue.default("manual"),
        payee: provenanceValue.default("manual"),
        split: provenanceValue.default("manual"),
      })
      .prefault({}),
    ruleIds: z.array(idSchema).default([]),
    importBatchId: nullableId,
    importFingerprints: z
      .array(z.string().regex(/^[0-9a-f]{32}$/))
      .max(2)
      .default([]),
    recurrenceId: nullableId,
    recurrenceDueDate: isoDateSchema.nullable().default(null),
    ...auditShape,
  })
  .superRefine((tx, ctx) => {
    for (const message of transactionShapeIssues(tx)) ctx.addIssue({ code: "custom", message });
  });

/** Condizioni di una regola (spec 0007, AC-1..AC-3). `match` non conta come condizione. */
export const ruleConditionsSchema = z
  .strictObject({
    match: z.enum(["all", "any"]).default("all"),
    types: z.array(transactionTypeSchema).min(1).optional(),
    accountIds: z.array(idSchema).min(1).optional(),
    payeeIds: z.array(idSchema).min(1).optional(),
    memberIds: z.array(idSchema).min(1).optional(),
    description: ruleDescriptionSchema.optional(),
    amountMinCents: positiveCentsSchema.optional(),
    amountMaxCents: positiveCentsSchema.optional(),
  })
  .refine(
    (c) => Object.entries(c).some(([key, v]) => key !== "match" && v !== undefined),
    "serve almeno una condizione",
  )
  .refine(
    (c) =>
      c.amountMinCents === undefined ||
      c.amountMaxCents === undefined ||
      c.amountMinCents <= c.amountMaxCents,
    { message: "l'importo minimo supera il massimo", path: ["amountMaxCents"] },
  );

/** Azioni di una regola (spec 0007, AC-4). */
export const ruleActionsSchema = z
  .strictObject({
    categoryId: idSchema.optional(),
    payeeId: idSchema.optional(),
    split: splitSpecSchema.optional(),
    transferAccountId: idSchema.optional(),
    recurring: z.literal(true).optional(),
  })
  .refine((a) => Object.values(a).some((v) => v !== undefined), "serve almeno un'azione")
  .refine((a) => a.transferAccountId === undefined || (a.categoryId === undefined && a.split === undefined), {
    message: "un giroconto non ha categoria né divisione",
    path: ["transferAccountId"],
  });

export const ruleSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  enabled: z.boolean().default(true),
  order: z.int().default(0),
  conditions: ruleConditionsSchema,
  actions: ruleActionsSchema,
  ...auditShape,
});

const colRefSchema = z.union([
  z.strictObject({ header: z.string().min(1) }),
  z.strictObject({ index: z.int().nonnegative() }),
]);

export const importProfileSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  defaultAccountId: nullableId,
  encoding: z.enum(["utf-8", "windows-1252", "iso-8859-1"]).default("utf-8"),
  delimiter: z.enum([",", ";", "\t"]),
  quote: z.string().length(1).default('"'),
  skipRows: z.int().nonnegative().default(0),
  hasHeader: z.boolean(),
  headerSignature: z.string().max(128).nullable().default(null),
  columns: z.strictObject({
    date: colRefSchema,
    description: z.array(colRefSchema).min(1),
    amount: colRefSchema.optional(),
    debit: colRefSchema.optional(),
    credit: colRefSchema.optional(),
    payee: colRefSchema.optional(),
    type: colRefSchema.optional(),
  }),
  dateFormat: z.string().min(1).max(32),
  decimalSeparator: z.enum([",", "."]),
  thousandsSeparator: z.enum([".", ",", " ", ""]),
  sign: z.strictObject({
    mode: z.enum(["negativeIsExpense", "positiveIsExpense", "debitCreditColumns", "typeColumn"]),
    expenseValues: z.array(z.string()).optional(),
    incomeValues: z.array(z.string()).optional(),
  }),
  ...auditShape,
});

export const importBatchSchema = z.strictObject({
  id: idSchema,
  profileId: nullableId,
  accountId: idSchema,
  fileName: z.string().min(1).max(255),
  fileHash: z.string().regex(/^[0-9a-f]{64}$/),
  rowCount: z.int().nonnegative(),
  importedCount: z.int().nonnegative(),
  duplicateCount: z.int().nonnegative(),
  dateFrom: isoDateSchema,
  dateTo: isoDateSchema,
  importedAtMs: epochMsSchema,
  ...auditShape,
});

export const recurrenceSchema = z.strictObject({
  id: idSchema,
  name: nameSchema,
  type: transactionTypeSchema,
  accountId: idSchema,
  toAccountId: nullableId,
  categoryId: nullableId,
  payeeId: nullableId,
  expectedAmountCents: positiveCentsSchema,
  amountToleranceBp: bpSchema.default(1000),
  split: transactionSplitSchema.nullable().default(null),
  frequency: z.strictObject({
    unit: z.enum(["day", "week", "month", "year"]),
    interval: z.int().min(1),
    dayOfMonth: z.int().min(1).max(31).optional(),
  }),
  startDate: isoDateSchema,
  endDate: isoDateSchema.nullable().default(null),
  matchWindowDays: z.int().nonnegative().default(5),
  descriptionMatch: descriptionMatchSchema.nullable().default(null),
  skippedDates: z.array(isoDateSchema).default([]),
  archivedAtMs: nullableMs,
  ...auditShape,
});

/** L'id è la chiave del suggerimento scartato (un hash), non un UUIDv7. */
export const recurrenceDismissalSchema = z.strictObject({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,128}$/),
  dismissedAtMs: epochMsSchema,
  dismissedByMemberId: idSchema,
  ...auditShape,
});

/** L'id è il `memberId` del proprietario. */
export const memberSettingsSchema = z.strictObject({
  id: idSchema,
  notifications: z
    .strictObject({
      recurringDue: z
        .strictObject({
          enabled: z.boolean().default(true),
          leadDays: z.int().nonnegative().default(2),
        })
        .prefault({}),
      settlement: z
        .strictObject({ enabled: z.boolean().default(false), thresholdCents: centsSchema.default(0) })
        .prefault({}),
      importReminder: z
        .strictObject({ enabled: z.boolean().default(false), everyDays: z.int().min(1).default(30) })
        .prefault({}),
    })
    .prefault({}),
  channels: z
    .strictObject({
      inApp: z.boolean().default(true),
      webPush: z.boolean().default(false),
      email: z.boolean().default(false),
      telegram: z.boolean().default(false),
    })
    .prefault({}),
  defaultView: z.enum(["family", "personal"]).default("family"),
  ...auditShape,
});

export const reminderSchema = z.strictObject({
  id: idSchema,
  memberId: idSchema,
  kind: z.enum(["recurringDue", "settlement", "importReminder"]),
  refId: z.string().max(128).nullable().default(null),
  fireAtMs: epochMsSchema,
  title: z.string().min(1).max(120),
  body: z.string().max(1000).default(""),
  status: z.enum(["pending", "sent", "dismissed"]).default("pending"),
  sentAtMs: nullableMs,
  dedupKey: z.string().min(1).max(200),
  ...auditShape,
});

export type User = z.output<typeof userSchema>;
export type Family = z.output<typeof familySchema>;
export type FamilyInput = z.input<typeof familySchema>;
export type Member = z.output<typeof memberSchema>;
export type Invite = z.output<typeof inviteSchema>;
export type Account = z.output<typeof accountSchema>;
export type Category = z.output<typeof categorySchema>;
export type Payee = z.output<typeof payeeSchema>;
export type Transaction = z.output<typeof transactionSchema>;
export type Rule = z.output<typeof ruleSchema>;
export type ImportProfile = z.output<typeof importProfileSchema>;
export type ImportBatch = z.output<typeof importBatchSchema>;
export type Recurrence = z.output<typeof recurrenceSchema>;
export type RecurrenceDismissal = z.output<typeof recurrenceDismissalSchema>;
export type MemberSettings = z.output<typeof memberSettingsSchema>;
export type Reminder = z.output<typeof reminderSchema>;
