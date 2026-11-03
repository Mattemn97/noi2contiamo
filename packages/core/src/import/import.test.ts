// Spec 0006: lettura dei CSV di banche e servizi (fixture sintetiche) e piano dell'import.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  accountSchema,
  columnsByHeader,
  decodeBytes,
  detectDateFormat,
  detectDelimiter,
  detectEncoding,
  detectHeaderRow,
  detectNumberFormat,
  fileHash,
  guessSettings,
  headerSignature,
  importProfileSchema,
  matchProfile,
  parseAmount,
  parseCsv,
  parseCsvRecords,
  parseDate,
  planImport,
  planWindow,
  readRows,
  settingsOf,
  transactionSchema,
  undoImportOps,
  type Account,
  type ImportSettings,
  type ParsedRow,
  type PlanInput,
  type Transaction,
  type ValidRow,
} from "../index";

const fixture = (name: string) => new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", name)));
const bytes = (text: string) => new Uint8Array(Buffer.from(text, "utf8"));

function read(name: string, patch: Partial<ImportSettings> = {}) {
  const file = fixture(name);
  const settings = { ...guessSettings(file), ...patch };
  const result = readRows(decodeBytes(file, settings.encoding), settings);
  if (!result.ok) throw new Error(JSON.stringify(result.error));
  return { settings, ...result.value };
}
const valid = (rows: readonly ParsedRow[]) => rows.filter((r): r is ValidRow => r.ok);
const invalid = (rows: readonly ParsedRow[]) => rows.filter((r) => !r.ok);

describe("decodifica (AC-1)", () => {
  it("riconosce Windows-1252, UTF-8 e il BOM", () => {
    expect(detectEncoding(fixture("intesa.csv"))).toBe("windows-1252");
    expect(detectEncoding(fixture("revolut.csv"))).toBe("utf-8");
    expect(detectEncoding(fixture("paypal.csv"))).toBe("utf-8");
  });

  it("legge accenti ed euro in Windows-1252 e toglie il BOM", () => {
    const intesa = decodeBytes(fixture("intesa.csv"), "windows-1252");
    expect(intesa).toContain("CAFFÈ");
    expect(intesa).toContain("ÀLFA");
    expect(intesa).toContain("10€");
    expect(decodeBytes(fixture("paypal.csv"), "utf-8").startsWith('"Data"')).toBe(true);
    expect(decodeBytes(new Uint8Array([0xe8]), "iso-8859-1")).toBe("è");
    expect(decodeBytes(new Uint8Array([0x80]), "iso-8859-1")).toBe("\u0080");
  });

  it("un UTF-8 non valido non perde caratteri", () => {
    expect(decodeBytes(new Uint8Array([0x63, 0x61, 0x66, 0x66, 0xe8]), "utf-8")).toBe("caffè");
    expect(decodeBytes(bytes("😀 ok"), "utf-8")).toBe("😀 ok");
  });

  it("l'hash del file è stabile", () => {
    expect(fileHash(fixture("satispay.csv"))).toMatch(/^[0-9a-f]{64}$/);
    expect(fileHash(fixture("satispay.csv"))).toBe(fileHash(fixture("satispay.csv")));
  });
});

describe("CSV (AC-2)", () => {
  it("virgolette, separatori, a capo e doppi apici dentro i campi", () => {
    const text = 'a;b;c\r\n"x;y";"riga\nnuova";"lui disse ""ciao"""\r\n\r\n;;\r\nz;;fine';
    expect(parseCsv(text, { delimiter: ";" })).toEqual([
      ["a", "b", "c"],
      ["x;y", "riga\nnuova", 'lui disse "ciao"'],
      ["z", "", "fine"],
    ]);
    expect(parseCsvRecords(text, { delimiter: ";" }).map((r) => r.line)).toEqual([1, 2, 6]);
  });

  it("trova il separatore anche con le righe del conto prima della tabella", () => {
    expect(detectDelimiter(decodeBytes(fixture("intesa.csv"), "windows-1252"))).toBe(";");
    expect(detectDelimiter(decodeBytes(fixture("revolut.csv"), "utf-8"))).toBe(",");
    expect(detectDelimiter(decodeBytes(fixture("paypal.csv"), "utf-8"))).toBe(",");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("Data;Importo\n01/10/2026;1,50\n02/10/2026;2,50")).toBe(";");
  });
});

describe("intestazione (AC-3)", () => {
  it("salta il preambolo del conto", () => {
    const rows = parseCsv(decodeBytes(fixture("intesa.csv"), "windows-1252"), { delimiter: ";" });
    expect(detectHeaderRow(rows)).toEqual({ skipRows: 3, hasHeader: true });
  });

  it("senza intestazione legge dalla prima riga", () => {
    expect(detectHeaderRow([["01/10/2026", "x", "1,00"]])).toEqual({ skipRows: 0, hasHeader: false });
    const settings: ImportSettings = {
      ...guessSettings(bytes("01/10/2026;Bar;-1,50\n02/10/2026;Pane;-2,00\n")),
    };
    expect(settings.hasHeader).toBe(false);
    const result = readRows("01/10/2026;Bar;-1,50\n02/10/2026;Pane;-2,00\n", settings);
    expect(result.ok && result.value.headers).toEqual(["", "", ""]);
    expect(result.ok && valid(result.value.rows).map((r) => r.signedCents)).toEqual([-150, -200]);
  });
});

describe("date (AC-4)", () => {
  it.each([
    ["01/10/2026", "dd/MM/yyyy", "2026-10-01"],
    ["1/9/2026", "d/M/yyyy", "2026-09-01"],
    ["03-10-2026", "dd-MM-yyyy", "2026-10-03"],
    ["03.10.2026", "dd.MM.yyyy", "2026-10-03"],
    ["2026-10-06 09:15:02", "yyyy-MM-dd", "2026-10-06"],
    ["2026-10-06T09:15", "yyyy-MM-dd", "2026-10-06"],
    ["03/10/26", "dd/MM/yy", "2026-10-03"],
    ["10/31/2026", "MM/dd/yyyy", "2026-10-31"],
  ])("%s con %s", (raw, fmt, iso) => {
    expect(parseDate(raw, fmt)).toEqual({ ok: true, value: iso });
  });

  it("rifiuta date impossibili e testo", () => {
    expect(parseDate("31/02/2026", "dd/MM/yyyy").ok).toBe(false);
    expect(parseDate("29/02/2028", "dd/MM/yyyy").ok).toBe(true);
    expect(parseDate("ieri", "dd/MM/yyyy").ok).toBe(false);
    expect(parseDate("01/10/2026x", "dd/MM/yyyy").ok).toBe(false);
  });

  it("propone il formato, italiano per primo", () => {
    expect(detectDateFormat(["01/10/2026", "12/10/2026"])).toBe("dd/MM/yyyy");
    expect(detectDateFormat(["10/31/2026"])).toBe("MM/dd/yyyy");
    expect(detectDateFormat(["2026-10-06 09:15:02"])).toBe("yyyy-MM-dd");
    expect(detectDateFormat(["boh"])).toBeNull();
    expect(detectDateFormat([])).toBeNull();
  });
});

describe("importi (AC-5)", () => {
  const it_ = { decimalSeparator: ",", thousandsSeparator: "." } as const;
  const en = { decimalSeparator: ".", thousandsSeparator: "," } as const;
  it.each([
    ["1.234,56", it_, 123456],
    ["-1.234,56", it_, -123456],
    ["1.234,56-", it_, -123456],
    ["(12,50)", it_, -1250],
    ["−12,50", it_, -1250],
    ["+ 12,5 €", it_, 1250],
    ["EUR 3", it_, 300],
    ["12,500", it_, 1250],
    ["1,234.56", en, 123456],
    ["-23.99", en, -2399],
    [",5", it_, 50],
  ])("%s → %i", (raw, fmt, cents) => {
    expect(parseAmount(raw, fmt)).toEqual({ ok: true, value: cents });
  });

  it("errori: vuoto, testo, troppi decimali", () => {
    expect(parseAmount("  ", it_)).toEqual({ ok: false, error: "empty" });
    expect(parseAmount("abc", it_)).toEqual({ ok: false, error: "invalid" });
    expect(parseAmount("1,2,3", { decimalSeparator: ",", thousandsSeparator: "" })).toEqual({
      ok: false,
      error: "invalid",
    });
    expect(parseAmount("-20,123", it_)).toEqual({ ok: false, error: "decimals" });
  });

  it("spazio come separatore delle migliaia", () => {
    expect(parseAmount("1 234,56", { decimalSeparator: ",", thousandsSeparator: " " })).toEqual({
      ok: true,
      value: 123456,
    });
  });

  it("propone il formato dai campioni", () => {
    expect(detectNumberFormat(["1.234,56", "12,00"])).toEqual({
      decimalSeparator: ",",
      thousandsSeparator: ".",
    });
    expect(detectNumberFormat(["-23.99", "200.00"])).toEqual({
      decimalSeparator: ".",
      thousandsSeparator: "",
    });
    expect(detectNumberFormat(["1,234.50"])).toEqual({ decimalSeparator: ".", thousandsSeparator: "," });
    expect(detectNumberFormat([])).toEqual({ decimalSeparator: ",", thousandsSeparator: "" });
  });
});

describe("fixture: Intesa (Windows-1252, Addebiti/Accrediti)", () => {
  const { settings, headers, rows } = read("intesa.csv");

  it("propone le impostazioni giuste", () => {
    expect(settings).toMatchObject({
      encoding: "windows-1252",
      delimiter: ";",
      skipRows: 3,
      hasHeader: true,
      dateFormat: "dd/MM/yyyy",
      decimalSeparator: ",",
      thousandsSeparator: ".",
      sign: { mode: "debitCreditColumns" },
    });
    expect(headers["index" in settings.columns.date ? settings.columns.date.index : -1]).toBe(
      "Data contabile",
    );
  });

  it("legge segni, migliaia e accenti; errori con il numero di riga (AC-6, AC-9)", () => {
    expect(valid(rows).map((r) => [r.date, r.signedCents, r.description])).toEqual([
      ["2026-10-01", -4530, "Pagamento POS"],
      ["2026-10-02", 185000, "Accredito stipendio"],
      ["2026-10-03", -1200, "Pagamento POS"],
      ["2026-10-03", -1200, "Pagamento POS"],
      ["2026-10-05", -20000, "Bonifico disposto"],
      ["2026-10-07", -123456, "Addebito SDD"],
      ["2026-10-10", -890, "Pagamento POS"],
      ["2026-10-11", -1000, "Ricarica telefonica"],
    ]);
    expect(invalid(rows)).toEqual([
      { line: 13, ok: false, error: "date", value: "31/02/2026" },
      { line: 14, ok: false, error: "none", value: "" },
    ]);
  });

  it("descrizione da più colonne unite con ' · ' (AC-7)", () => {
    const both = read("intesa.csv", {
      columns: {
        ...settings.columns,
        description: [{ header: "Descrizione" }, { header: "Descrizione estesa" }],
      },
    });
    expect(valid(both.rows)[6]!.description).toBe('Pagamento POS · FARMACIA "SAN MARCO"');
    expect(valid(both.rows)[0]!.description).toBe("Pagamento POS · COOP CAFFÈ CENTRALE MILANO");
  });
});

describe("fixture: Revolut (UTF-8, data con orario, punto decimale)", () => {
  const { settings, rows } = read("revolut.csv");

  it("una colonna con il segno", () => {
    expect(settings).toMatchObject({
      encoding: "utf-8",
      delimiter: ",",
      skipRows: 0,
      dateFormat: "yyyy-MM-dd",
    });
    expect(settings.sign.mode).toBe("negativeIsExpense");
    expect(valid(rows).map((r) => [r.date, r.signedCents, r.description])).toEqual([
      ["2026-10-06", 20000, "Top-up by *4321"],
      ["2026-10-07", -2399, "Amazon, Inc."],
      ["2026-10-09", -5640, "Esselunga"],
      ["2026-10-12", -5000, "To Bruno Bianchi"],
      ["2026-10-14", -120, 'Caffè "Il Chicco"'],
    ]);
    expect(invalid(rows)).toEqual([{ line: 7, ok: false, error: "amount", value: "abc" }]);
  });
});

describe("fixture: PayPal (BOM, tutto tra virgolette)", () => {
  const { settings, headers, rows } = read("paypal.csv");

  it("importo netto, destinatario dal nome, troppi decimali segnalati", () => {
    expect(settings).toMatchObject({
      encoding: "utf-8",
      delimiter: ",",
      decimalSeparator: ",",
      thousandsSeparator: ".",
    });
    expect(headers[0]).toBe("Data");
    expect(valid(rows).map((r) => [r.signedCents, r.payee])).toEqual([
      [-123456, "Negozio Elettronica Srl"],
      [-1599, "Spotify AB"],
      [125000, null],
      [1599, "Spotify AB"],
    ]);
    expect(invalid(rows)).toEqual([{ line: 6, ok: false, error: "decimals", value: "-20,123" }]);
  });
});

describe("fixture: Satispay (colonna tipo)", () => {
  const { settings, rows } = read("satispay.csv");

  it("tipo Pagamento = spesa, Ricevuto e Ricarica = entrata, sconosciuto = errore", () => {
    expect(settings.sign).toEqual({
      mode: "typeColumn",
      expenseValues: ["Pagamento"],
      incomeValues: ["Ricevuto", "Ricarica", "Storno"],
    });
    const fixed = read("satispay.csv", {
      sign: { mode: "typeColumn", expenseValues: ["pagamento"], incomeValues: ["Ricevuto", "Ricarica"] },
    });
    expect(settings.dateFormat).toBe("dd-MM-yyyy");
    expect(valid(fixed.rows).map((r) => [r.signedCents, r.payee, r.description])).toEqual([
      [-150, "Bar Centrale", "Bar Centrale"],
      [1200, "Bruno Bianchi", "Bruno Bianchi"],
      [5000, "Ricarica da IBAN", "Ricarica da IBAN"],
      [-380, "Panificio Rossi", "Panificio Rossi"],
      [-4000, "Distributore Q8", "Distributore Q8"],
    ]);
    expect(invalid(fixed.rows)).toEqual([{ line: 7, ok: false, error: "type", value: "Storno" }]);
    expect(valid(rows)).toHaveLength(6);
  });

  it("positiveIsExpense inverte il segno", () => {
    const card = read("satispay.csv", { sign: { mode: "positiveIsExpense" } });
    expect(valid(card.rows)[0]!.signedCents).toBe(-150);
  });

  it("una colonna mappata che non c'è è un errore della mappatura", () => {
    const file = fixture("satispay.csv");
    const result = readRows(decodeBytes(file, "utf-8"), {
      ...settings,
      columns: { ...settings.columns, payee: { header: "Esercente" } },
    });
    expect(result).toEqual({ ok: false, error: { code: "missing_column", field: "payee" } });
  });
});

const M = "0190a000-0000-7000-8000-00000000000a";
const N = "0190a000-0000-7000-8000-00000000000b";
const INTESA = "0190a000-0000-7000-8000-000000000301";
const REVOLUT = "0190a000-0000-7000-8000-000000000302";
const audit = { createdAtMs: 0, updatedAtMs: 0, createdByMemberId: M, updatedByMemberId: M };
const account = (id: string, ownerMemberId: string | null): Account =>
  accountSchema.parse({
    id,
    name: id.slice(-3),
    kind: "checking",
    ownerMemberId,
    initialBalanceDate: "2026-01-01",
    ...audit,
  });
const accounts = [account(INTESA, null), account(REVOLUT, M)];
const family = { defaultSplit: { kind: "bp" as const, shares: { [M]: 5000, [N]: 5000 } } };

let seq = 0;
const newId = () => `0190b000-0000-7000-8000-${String(++seq).padStart(12, "0")}`;

function plan(rows: readonly ParsedRow[], patch: Partial<PlanInput> = {}) {
  return planImport({
    rows,
    account: accounts[0]!,
    accounts,
    family,
    categories: [],
    payees: [],
    existing: [],
    batchId: newId(),
    profileId: null,
    fileName: "intesa.csv",
    fileHash: fileHash(fixture("intesa.csv")),
    nowMs: 1_000,
    newId,
    ...patch,
  });
}

/** Come lo rilegge un adapter: schema di core con audit. */
const saved = (doc: object): Transaction => transactionSchema.parse({ ...doc, ...audit });

describe("piano dell'import (AC-9..AC-14)", () => {
  const { rows } = read("intesa.csv");

  it("righe nuove, errori, lotto e operazioni (AC-9, AC-11)", () => {
    const p = plan(rows);
    expect(p.counts).toEqual({ rows: 10, new: 8, duplicate: 0, error: 2, transfer: 0 });
    expect(p.batch).toMatchObject({
      accountId: INTESA,
      rowCount: 10,
      importedCount: 8,
      duplicateCount: 0,
      dateFrom: "2026-10-01",
      dateTo: "2026-10-11",
      importedAtMs: 1_000,
    });
    expect(p.ops[0]).toMatchObject({ type: "put", collection: "importBatches" });
    const txs = p.ops.flatMap((op) =>
      op.type === "put" && op.collection === "transactions" ? [op.doc] : [],
    );
    expect(txs).toHaveLength(8);
    const salary = saved(txs[1]!);
    expect(salary).toMatchObject({
      type: "income",
      amountCents: 185000,
      categoryId: null,
      importBatchId: p.batch!.id,
      visibility: "shared",
      payerMemberId: null,
      split: { kind: "bp", source: "default", shares: { [M]: 5000, [N]: 5000 } },
    });
    expect(salary.importFingerprints).toHaveLength(1);
  });

  it("due righe identiche nello stesso file sono due movimenti con impronte diverse (AC-10)", () => {
    const p = plan(rows);
    const coffees = p.items.filter((i) => i.status === "new" && i.row.signedCents === -1200);
    expect(coffees).toHaveLength(2);
    expect(new Set(coffees.map((i) => (i.status === "new" ? i.fingerprint : "")))).toHaveProperty("size", 2);
  });

  it("lo stesso file due volte: la seconda volta zero nuove (AC-10)", () => {
    const first = plan(rows);
    const existing = first.ops.flatMap((op) =>
      op.type === "put" && op.collection === "transactions" ? [saved(op.doc)] : [],
    );
    const second = plan(rows, { existing });
    expect(second.counts).toMatchObject({ new: 0, duplicate: 8, error: 2 });
    expect(second.batch).toBeNull();
    expect(second.ops).toEqual([]);
  });

  it("un file che si sovrappone importa solo la parte nuova (AC-10)", () => {
    const first = plan(rows.slice(0, 5));
    const existing = first.ops.flatMap((op) =>
      op.type === "put" && op.collection === "transactions" ? [saved(op.doc)] : [],
    );
    expect(plan(rows, { existing }).counts).toMatchObject({ new: 3, duplicate: 5 });
  });

  it("destinatari: esistente riusato, nuovo creato una volta sola (AC-11)", () => {
    const paypal = read("paypal.csv").rows;
    const spotify = "0190a000-0000-7000-8000-000000000999";
    const p = plan(paypal, { payees: [{ id: spotify, normalizedName: "spotify ab" }] });
    const payees = p.ops.filter((op) => op.type === "put" && op.collection === "payees");
    expect(payees).toHaveLength(1);
    expect(payees[0]).toMatchObject({
      doc: { name: "Negozio Elettronica Srl", normalizedName: "negozio elettronica srl" },
    });
    const txs = p.items.flatMap((i) => (i.status === "new" ? [i.tx] : []));
    expect(txs.filter((t) => t.payeeId === spotify)).toHaveLength(2);
    expect(txs[0]!.provenance).toEqual({ category: "default", payee: "import", split: "default" });
    expect(txs[2]!.provenance).toEqual({ category: "default", payee: "default", split: "default" });
  });

  it("entrata sul conto di un membro: divisione al 100% sul proprietario", () => {
    const revolut = read("revolut.csv").rows;
    const p = plan(revolut, { account: accounts[1]!, existing: [] });
    const topup = p.items.find((i) => i.status === "new" && i.row.signedCents === 20000);
    expect(topup?.status === "new" && topup.tx.split).toEqual({
      kind: "bp",
      source: "default",
      shares: { [M]: 10000 },
    });
    expect(topup?.status === "new" && topup.tx.payerMemberId).toBe(M);
  });

  it("giroconto: la riga nuova si unisce al movimento esistente dell'altro conto (AC-13)", () => {
    const revolut = read("revolut.csv").rows;
    const revolutPlan = plan(revolut, { account: accounts[1]!, fileName: "revolut.csv" });
    const existing = revolutPlan.ops.flatMap((op) =>
      op.type === "put" && op.collection === "transactions" ? [saved(op.doc)] : [],
    );
    const topup = existing.find((t) => t.amountCents === 20000)!;
    const p = plan(rows, { existing });
    expect(p.counts).toMatchObject({ new: 7, transfer: 1 });
    const item = p.items.find((i) => i.status === "transfer");
    expect(item?.status === "transfer" && item.other.id).toBe(topup.id);
    expect(item?.status === "transfer" && item.tx).toMatchObject({
      id: topup.id,
      type: "transfer",
      accountId: INTESA,
      toAccountId: REVOLUT,
      date: "2026-10-05",
      importBatchId: topup.importBatchId,
    });
    expect(item?.status === "transfer" && item.tx.importFingerprints).toHaveLength(2);
    expect(p.batch?.importedCount).toBe(8);

    const declined = plan(rows, { existing, declinedTransfers: new Set([item?.fingerprint ?? ""]) });
    expect(declined.counts).toMatchObject({ new: 8, transfer: 0 });

    // Il giroconto salvato contiene l'impronta della riga: reimportare non lo duplica.
    const after = existing
      .filter((t) => t.id !== topup.id)
      .concat(item?.status === "transfer" ? [saved(item.tx)] : []);
    const firstTxs = p.ops.flatMap((op) =>
      op.type === "put" && op.collection === "transactions" ? [saved(op.doc)] : [],
    );
    expect(
      plan(rows, { existing: [...after, ...firstTxs.filter((t) => t.type !== "transfer")] }).counts,
    ).toMatchObject({
      new: 0,
      transfer: 0,
      duplicate: 8,
    });
  });

  it("l'aggancio delle regole cambia i movimenti nuovi (AC-14)", () => {
    const category = "0190a000-0000-7000-8000-000000000777";
    const p = plan(rows, {
      hook: (tx, row) => (row.description.includes("POS") ? { ...tx, categoryId: category } : tx),
    });
    const txs = p.items.flatMap((i) => (i.status === "new" ? [i.tx] : []));
    expect(txs.filter((t) => t.categoryId === category)).toHaveLength(4);
  });

  it("profilo salvato nello stesso commit, prima del lotto", () => {
    const profile = {
      id: newId(),
      name: "Intesa",
      hasHeader: true,
      delimiter: ";" as const,
      columns: { date: { index: 0 }, description: [{ index: 2 }] },
      dateFormat: "dd/MM/yyyy",
      decimalSeparator: "," as const,
      thousandsSeparator: "." as const,
      sign: { mode: "debitCreditColumns" as const },
    };
    const p = plan(rows, { profile, profileId: profile.id });
    expect(p.ops.slice(0, 2).map((op) => op.collection)).toEqual(["importProfiles", "importBatches"]);
    expect(p.batch?.profileId).toBe(profile.id);
  });

  it("finestra di lettura: 3 giorni prima e dopo", () => {
    expect(planWindow(rows)).toEqual({ from: "2026-09-28", to: "2026-10-14" });
    expect(planWindow([])).toBeNull();
  });

  it("annullare: prima i movimenti del lotto, poi il lotto (AC-12)", () => {
    const ops = undoImportOps({ id: "b" }, [
      { id: "t1", importBatchId: "b" },
      { id: "t2", importBatchId: "altro" },
      { id: "t3", importBatchId: "b" },
    ]);
    expect(ops).toEqual([
      { type: "remove", collection: "transactions", id: "t1" },
      { type: "remove", collection: "transactions", id: "t3" },
      { type: "remove", collection: "importBatches", id: "b" },
    ]);
  });
});

describe("profili (AC-8)", () => {
  const file = fixture("intesa.csv");
  const guess = guessSettings(file);
  const rows = parseCsv(decodeBytes(file, guess.encoding), guess);
  const headers = rows[guess.skipRows]!;
  const profile = (id: string, patch: object = {}) =>
    importProfileSchema.parse({
      id,
      name: "Intesa",
      ...guess,
      columns: columnsByHeader(guess.columns, headers, true),
      headerSignature: headerSignature(headers),
      defaultAccountId: null,
      ...audit,
      ...patch,
    });

  it("la firma non dipende da maiuscole, accenti e spazi", () => {
    expect(headerSignature(["Data", "Caffè  "])).toBe(headerSignature(["data", "caffe"]));
    expect(headerSignature(["Data"])).not.toBe(headerSignature(["Data valuta"]));
  });

  it("le colonne si salvano col nome dell'intestazione e si rileggono uguali", () => {
    const p = profile("0190c000-0000-7000-8000-000000000001");
    expect(p.columns.date).toEqual({ header: "Data contabile" });
    const again = readRows(decodeBytes(file, p.encoding), settingsOf(p));
    expect(again.ok && valid(again.value.rows)).toHaveLength(8);
  });

  it("riconosce il profilo dal file; a parità vince il conto, poi il più recente", () => {
    const a = profile("0190c000-0000-7000-8000-000000000001", { updatedAtMs: 5 });
    const b = profile("0190c000-0000-7000-8000-000000000002", { defaultAccountId: INTESA, updatedAtMs: 1 });
    const c = profile("0190c000-0000-7000-8000-000000000003", { updatedAtMs: 9 });
    expect(matchProfile(file, [a, b, c], INTESA)?.id).toBe(b.id);
    expect(matchProfile(file, [a, b, c], REVOLUT)?.id).toBe(c.id);
    expect(matchProfile(fixture("revolut.csv"), [a, b, c], INTESA)).toBeNull();
  });

  it("legge con i parametri del profilo, non con quelli rilevati", () => {
    const wrongSkip = profile("0190c000-0000-7000-8000-000000000004", { skipRows: 0 });
    expect(matchProfile(file, [wrongSkip], null)).toBeNull();
  });
});
