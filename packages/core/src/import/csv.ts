// Lettore CSV (spec 0006, AC-2): RFC 4180 con virgolette, a capo dentro i campi, CRLF o LF.

export type Delimiter = "," | ";" | "\t";

export interface CsvOptions {
  readonly delimiter: Delimiter;
  readonly quote?: string;
}

export interface CsvRecord {
  /** Riga del file (da 1) dove comincia il record. */
  readonly line: number;
  readonly cells: string[];
}

/** I record del file con la loro riga; le righe vuote (anche solo separatori) si tolgono. */
export function parseCsvRecords(text: string, options: CsvOptions): CsvRecord[] {
  const quote = options.quote ?? '"';
  const records: CsvRecord[] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let line = 1;
  let start = 1;
  const endRow = () => {
    row.push(cell);
    if (row.some((c) => c.trim() !== "")) records.push({ line: start, cells: row });
    row = [];
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i);
    if (quoted) {
      if (ch === quote && text[i + 1] === quote) {
        cell += quote;
        i += 1;
      } else if (ch === quote) quoted = false;
      else {
        if (ch === "\n") line += 1;
        cell += ch;
      }
    } else if (ch === quote && cell.trim() === "") {
      quoted = true;
      cell = "";
    } else if (ch === options.delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\r" || ch === "\n") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRow();
      line += 1;
      start = line;
    } else cell += ch;
  }
  if (cell !== "" || row.length > 0) endRow();
  return records;
}

/** Solo le celle (vedi `parseCsvRecords`). */
export function parseCsv(text: string, options: CsvOptions): string[][] {
  return parseCsvRecords(text, options).map((r) => r.cells);
}

const CANDIDATES: readonly Delimiter[] = [";", ",", "\t"];

/** Quante volte compare il separatore in ogni riga logica, fuori dalle virgolette. */
function countsPerLine(text: string, delimiter: Delimiter, maxLines: number): number[] {
  const counts: number[] = [];
  let count = 0;
  let quoted = false;
  let nonEmpty = false;
  for (let i = 0; i < text.length && counts.length < maxLines; i++) {
    const ch = text.charAt(i);
    if (ch === '"') quoted = !quoted;
    else if (!quoted && ch === delimiter) count += 1;
    else if (!quoted && (ch === "\n" || ch === "\r")) {
      if (nonEmpty) counts.push(count);
      count = 0;
      nonEmpty = false;
      continue;
    }
    if (ch.trim() !== "") nonEmpty = true;
  }
  if (nonEmpty && counts.length < maxLines) counts.push(count);
  return counts;
}

/**
 * Il separatore più costante nelle prime 10 righe non vuote (righe con lo stesso conteggio, pesate per
 * il conteggio fino a 4: una tabella vera ha più colonne di una virgola decimale sparsa); a pari merito
 * `;`, poi `,`, poi tab (le banche italiane usano `;`).
 */
export function detectDelimiter(text: string): Delimiter {
  let best: Delimiter = ";";
  let bestScore = -1;
  for (const delimiter of CANDIDATES) {
    const counts = countsPerLine(text, delimiter, 10).filter((c) => c > 0);
    const freq = new Map<number, number>();
    for (const c of counts) freq.set(c, (freq.get(c) ?? 0) + 1);
    const score = Math.max(0, ...[...freq].map(([c, lines]) => lines * Math.min(c, 4)));
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}
