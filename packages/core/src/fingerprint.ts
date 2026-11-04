// Impronta di import di una riga CSV (AC-6): sha256 troncato a 32 caratteri esadecimali.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils.js";
import type { Id, IsoDate } from "./ids";
import { normalize } from "./normalize";

export interface FingerprintRow {
  readonly accountId: Id;
  readonly date: IsoDate;
  /** Importo con segno in centesimi: negativo per le uscite. */
  readonly signedAmountCents: number;
  readonly description: string;
}

export function importFingerprint(row: FingerprintRow, occurrence: number): string {
  const key = [
    row.accountId,
    row.date,
    String(row.signedAmountCents),
    normalize(row.description),
    String(occurrence),
  ];
  return bytesToHex(sha256(utf8ToBytes(key.join("|")))).slice(0, 32);
}

/** Impronte di tutte le righe di un file: due righe identiche ricevono occorrenze 0, 1, ... */
export function fingerprintRows(rows: readonly FingerprintRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const key = [row.accountId, row.date, row.signedAmountCents, normalize(row.description)].join("|");
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    return importFingerprint(row, occurrence);
  });
}
