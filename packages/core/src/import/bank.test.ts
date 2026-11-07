// Feature 24: movimenti dalla banca → righe dell'import, e il CSV scritto da `npm run bank:csv`.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BankTransaction,
  bankBatchHash,
  bankBatchName,
  bankTransactionsToRows,
  decodeBytes,
  guessSettings,
  suggestBankRange,
  readRows,
  type ValidRow,
} from "../index";

const tx = (patch: Record<string, unknown>) =>
  BankTransaction.parse({
    transaction_amount: { currency: "EUR", amount: "10.00" },
    credit_debit_indicator: "DBIT",
    status: "BOOK",
    booking_date: "2026-11-03",
    ...patch,
  });

describe("bankTransactionsToRows", () => {
  it("converte in centesimi interi senza decimali, con il segno dell'indicatore", () => {
    const rows = bankTransactionsToRows([
      tx({ transaction_amount: { currency: "EUR", amount: "0.10" } }),
      tx({ credit_debit_indicator: "CRDT", transaction_amount: { currency: "EUR", amount: "1234.5" } }),
      tx({ transaction_amount: { currency: "EUR", amount: "-7.05" } }),
    ]);
    expect(rows.map((r) => (r.ok ? r.signedCents : null))).toEqual([-10, 123450, -705]);
  });

  it("tiene solo i movimenti contabilizzati e numera da 1", () => {
    const rows = bankTransactionsToRows([tx({ status: "PDNG" }), tx({ status: undefined }), tx({})]);
    expect(rows.map((r) => r.line)).toEqual([1, 2]);
    expect(bankTransactionsToRows([tx({ status: "PDNG" })], { includePending: true })).toHaveLength(1);
  });

  it("usa booking_date, poi value_date, poi transaction_date", () => {
    const [a, b, c, d] = bankTransactionsToRows([
      tx({}),
      tx({ booking_date: undefined, value_date: "2026-11-02" }),
      tx({ booking_date: undefined, transaction_date: "2026-11-01" }),
      tx({ booking_date: undefined }),
    ]);
    expect((a as ValidRow).date).toBe("2026-11-03");
    expect((b as ValidRow).date).toBe("2026-11-02");
    expect((c as ValidRow).date).toBe("2026-11-01");
    expect(d).toMatchObject({ ok: false, error: "date" });
  });

  it("descrizione dalle causali, beneficiario dal lato giusto", () => {
    const [out, inc, bare] = bankTransactionsToRows([
      tx({
        remittance_information: ["Spesa", "Carta 1234"],
        creditor: { name: "Coop" },
        debtor: { name: "Io" },
      }),
      tx({ credit_debit_indicator: "CRDT", creditor: { name: "Io" }, debtor: { name: "Azienda" } }),
      tx({ creditor: { name: "Idraulico" } }),
    ]);
    expect(out).toMatchObject({ description: "Spesa · Carta 1234", payee: "Coop" });
    expect(inc).toMatchObject({ description: "Azienda", payee: "Azienda" });
    expect(bare).toMatchObject({ description: "Idraulico" });
  });

  it("segnala importo zero o illeggibile", () => {
    const rows = bankTransactionsToRows([
      tx({ transaction_amount: { currency: "EUR", amount: "0.00" } }),
      tx({ transaction_amount: { currency: "EUR", amount: "abc" } }),
      tx({ transaction_amount: { currency: "EUR", amount: "1.005" } }),
    ]);
    expect(rows.map((r) => (r.ok ? "ok" : r.error))).toEqual(["zero", "amount", "decimals"]);
  });
});

describe("lotto", () => {
  it("l'hash è deterministico e cambia con il periodo", () => {
    const key = { connectionId: "c", accountUid: "a", dateFrom: "2026-08-01", dateTo: "2026-10-30" };
    expect(bankBatchHash(key)).toBe(bankBatchHash({ ...key }));
    expect(bankBatchHash(key)).not.toBe(bankBatchHash({ ...key, dateTo: "2026-10-31" }));
    expect(bankBatchHash(key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("nome del lotto", () => {
    expect(
      bankBatchName({
        bankName: "Intesa",
        iban: "IT60 X054 2811 1010 0000 0123 456",
        dateFrom: "2026-08-01",
        dateTo: "2026-10-30",
      }),
    ).toBe("Banca · Intesa · 3456 · 01/08/2026–30/10/2026");
  });
});

describe("CSV di `npm run bank:csv`", () => {
  it("si legge con il riconoscimento automatico dell'import CSV", () => {
    const bytes = new Uint8Array(readFileSync(join(import.meta.dirname, "fixtures", "bank-cli.csv")));
    const settings = guessSettings(bytes);
    expect(settings.delimiter).toBe(";");
    const read = readRows(decodeBytes(bytes, settings.encoding), settings);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.rows.map((r) => (r.ok ? [r.date, r.signedCents, r.payee] : r))).toEqual([
      ["2026-11-03", -4250, "Supermercato Rossi"],
      ["2026-11-02", 123456, "Azienda Srl"],
      ["2026-11-01", -2990, "Telecom"],
    ]);
    expect(read.value.rows[0]).toMatchObject({ description: "Spesa settimanale · Carta 1234" });
  });
});

describe("suggestBankRange", () => {
  const batch = (accountId: string, fileName: string, dateTo: string) => ({ accountId, fileName, dateTo });
  it("riparte dall'ultimo import dalla banca di quel conto, altrimenti 90 giorni", () => {
    const batches = [
      batch("a", "Banca · Intesa · 3456 · 01/08/2026–30/09/2026", "2026-09-30"),
      batch("a", "Banca · Intesa · 3456 · 01/10/2026–20/10/2026", "2026-10-20"),
      batch("a", "estratto.csv", "2026-11-01"),
      batch("b", "Banca · Altra · 1111 · 01/10/2026–25/10/2026", "2026-10-25"),
    ];
    expect(suggestBankRange(batches, "a", "2026-11-07")).toEqual({
      dateFrom: "2026-10-20",
      dateTo: "2026-11-07",
    });
    expect(suggestBankRange(batches, "c", "2026-11-07")).toEqual({
      dateFrom: "2026-08-09",
      dateTo: "2026-11-07",
    });
  });
});
