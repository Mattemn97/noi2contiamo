// Filtro dei dettagli del registro di diagnostica: passa solo ciò che è tecnico e innocuo.
// Lista di campi ammessi (non di campi vietati): un campo nuovo resta nascosto finché qualcuno non lo ammette.

export const HIDDEN = "[nascosto]";

/** Campi con valori tecnici: conteggi, codici, tempi, nomi di collezioni e passi. Mai importi né testi liberi. */
const SAFE_KEYS: ReadonlySet<string> = new Set([
  "backend",
  "batches",
  "chunk",
  "chunks",
  "code",
  "collection",
  "collections",
  "count",
  "counts",
  "dateFormat",
  "decimalSeparator",
  "delimiter",
  "duplicate",
  "duration",
  "encoding",
  "error",
  "errorName",
  "event",
  "fields",
  "hasHeader",
  "issues",
  "kind",
  "message",
  "method",
  "mode",
  "new",
  "ok",
  "online",
  "ops",
  "path",
  "reason",
  "rows",
  "size",
  "skipRows",
  "status",
  "step",
  "transfer",
  "type",
  "version",
]);

/** Campi con un identificativo: si mostra solo l'inizio, basta per riconoscerlo nei log. */
const ID_KEYS: ReadonlySet<string> = new Set(["id", "familyId", "batchId", "accountId", "connectionId"]);

const MAX_TEXT = 200;
const MAX_ITEMS = 20;

export const shortId = (id: string): string => (id.length > 8 ? `${id.slice(0, 8)}…` : id);

/** Testi lunghi tagliati; email e numeri lunghi (IBAN, carte) mascherati anche dentro i messaggi. */
export function safeText(text: string): string {
  const masked = text
    .replace(/[^\s@"'<>()]+@[^\s@"'<>()]+\.[a-z]{2,}/gi, "[email]")
    .replace(/\b[A-Z]{2}\d{2}[A-Z0-9 ]{10,30}\b/g, "[iban]")
    .replace(/\b\d{9,}\b/g, "[numero]")
    .replace(/Bearer\s+\S+/gi, "Bearer [token]")
    .replace(/[\w-]{20,}\.[\w-]{20,}\.[\w-]{10,}/g, "[token]");
  return masked.length > MAX_TEXT ? `${masked.slice(0, MAX_TEXT)}…` : masked;
}

function redactValue(key: string, value: unknown, depth: number): unknown {
  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (ID_KEYS.has(key)) return typeof value === "string" ? shortId(value) : HIDDEN;
  if (!SAFE_KEYS.has(key)) return HIDDEN;
  if (typeof value === "number") return value;
  if (typeof value === "string") return safeText(value);
  if (Array.isArray(value)) {
    const items = value.slice(0, MAX_ITEMS).map((item) => redactValue(key, item, depth + 1));
    return value.length > MAX_ITEMS ? [...items, `… altri ${value.length - MAX_ITEMS}`] : items;
  }
  if (typeof value === "object")
    return depth > 4 ? HIDDEN : redact(value as Record<string, unknown>, depth + 1);
  return HIDDEN;
}

/** Copia dei dettagli con solo i campi ammessi; gli altri diventano `[nascosto]`. */
export function redact(details: Readonly<Record<string, unknown>>, depth = 0): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(details).map(([key, value]) => [key, redactValue(key, value, depth)]),
  );
}

/** Un errore qualunque ridotto a nome, codice e messaggio filtrati. */
export function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const extra = error as Error & { code?: unknown; error?: unknown };
    return redact({
      errorName: error.name,
      message: error.message,
      ...(typeof extra.code === "string" ? { code: extra.code } : {}),
      ...(extra.error && typeof extra.error === "object" ? { error: extra.error } : {}),
    });
  }
  if (error && typeof error === "object") return redact({ error });
  return { message: safeText(String(error)) };
}
