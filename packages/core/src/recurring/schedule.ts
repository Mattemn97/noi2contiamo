// Scadenze di una ricorrenza (spec 0008, AC-1, AC-2): calcolate, mai salvate. La n-esima parte sempre
// dall'inizio della serie, così il 31 portato al 28 febbraio non fa scivolare le date dopo.
import type { IsoDate } from "../ids";
import type { Recurrence } from "../model/schemas";

export type RecurrenceSchedule = Pick<Recurrence, "frequency" | "startDate" | "endDate" | "archivedAtMs">;

/** Massimo di scadenze restituite da una chiamata. */
export const MAX_OCCURRENCES = 1000;
/** Limite di passi per non girare all'infinito su intervalli enormi. */
const MAX_STEPS = 100_000;

const pad = (n: number, width = 2) => String(n).padStart(width, "0");
export const isoOf = (y: number, m: number, d: number): IsoDate => `${pad(y, 4)}-${pad(m)}-${pad(d)}`;
/** Giorni del mese `m` (1..12) dell'anno `y`. */
export const daysInMonth = (y: number, m: number): number => new Date(Date.UTC(y, m, 0)).getUTCDate();

export function dateParts(date: IsoDate): readonly [number, number, number] {
  const [y = 1970, m = 1, d = 1] = date.split("-").map(Number);
  return [y, m, d];
}

const dayNumber = (date: IsoDate): number => {
  const [y, m, d] = dateParts(date);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** Giorni da `a` a `b` (positivo se `b` viene dopo). */
export function daysBetween(a: IsoDate, b: IsoDate): number {
  return dayNumber(b) - dayNumber(a);
}

export function shiftDays(date: IsoDate, days: number): IsoDate {
  const [y, m, d] = dateParts(date);
  const moved = new Date(Date.UTC(y, m - 1, d + days));
  return isoOf(moved.getUTCFullYear(), moved.getUTCMonth() + 1, moved.getUTCDate());
}

/** Mese di calendario `months` dopo quello di `date`, come `[anno, mese]`. */
export function shiftMonth(date: IsoDate, months: number): readonly [number, number] {
  const [y, m] = dateParts(date);
  const total = y * 12 + (m - 1) + months;
  return [Math.floor(total / 12), (total % 12) + 1];
}

export const monthKey = (date: IsoDate): string => date.slice(0, 7);
export const endOfMonth = (y: number, m: number): IsoDate => isoOf(y, m, daysInMonth(y, m));

/** Data UTC di un istante (per `archivedAtMs`). */
export const isoFromMs = (ms: number): IsoDate => new Date(ms).toISOString().slice(0, 10);

/** La data al passo `step` della serie, senza tenere conto di inizio e fine. */
function stepDate(f: Recurrence["frequency"], start: IsoDate, step: number): IsoDate {
  const [y, m, d] = dateParts(start);
  switch (f.unit) {
    case "day":
      return shiftDays(start, step * f.interval);
    case "week":
      return shiftDays(start, 7 * step * f.interval);
    case "month": {
      const [ny, nm] = shiftMonth(start, step * f.interval);
      return isoOf(ny, nm, Math.min(f.dayOfMonth ?? d, daysInMonth(ny, nm)));
    }
    case "year": {
      const ny = y + step * f.interval;
      return isoOf(ny, m, Math.min(f.dayOfMonth ?? d, daysInMonth(ny, m)));
    }
  }
}

/**
 * Le scadenze tra `from` e `to` compresi, in ordine. `count` conta dalla prima scadenza della serie
 * (anche quelle prima di `from` e le saltate); vale la prima tra `endDate`, `count` e l'archiviazione.
 */
export function occurrences(rec: RecurrenceSchedule, from: IsoDate, to: IsoDate): IsoDate[] {
  const archived = rec.archivedAtMs === null ? null : isoFromMs(rec.archivedAtMs);
  const limits = [to, rec.endDate, archived].filter((x): x is IsoDate => x !== null);
  const last = limits.reduce((a, b) => (a < b ? a : b));
  const out: IsoDate[] = [];
  let counted = 0;
  for (let step = 0; step < MAX_STEPS; step += 1) {
    const date = stepDate(rec.frequency, rec.startDate, step);
    if (date > last) break;
    if (date < rec.startDate) continue;
    counted += 1;
    if (rec.frequency.count !== undefined && counted > rec.frequency.count) break;
    if (date >= from) {
      out.push(date);
      if (out.length >= MAX_OCCURRENCES) break;
    }
  }
  return out;
}
