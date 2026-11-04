// Colori dei grafici per ruolo: slot `--series-1..8` assegnati in ordine, mai a caso. Funzioni pure.

export const SERIES_SLOTS = 8;
export const OTHER_COLOR = "var(--chart-other)";
export const COMPARE_COLOR = "var(--chart-compare)";
export const OTHER_KEY = "altro";

export type SeriesKind = "series" | "compare" | "other";

export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  /** `compare` = periodo di confronto (grigio), `other` = voci unite in "Altro". */
  readonly kind?: SeriesKind;
}

/** Colore dello slot in posizione `index` (0 → `--series-1`); oltre l'ottavo si usa il grigio di "Altro". */
export function seriesColor(index: number): string {
  return index >= 0 && index < SERIES_SLOTS ? `var(--series-${index + 1})` : OTHER_COLOR;
}

/** Colori per chiave, nell'ordine in cui le serie sono passate. Confronto e "Altro" non consumano slot. */
export function assignSeriesColors(series: readonly ChartSeries[]): Readonly<Record<string, string>> {
  let slot = 0;
  return Object.fromEntries(
    series.map((item) => {
      if (item.kind === "compare") return [item.key, COMPARE_COLOR];
      if (item.kind === "other") return [item.key, OTHER_COLOR];
      const color = seriesColor(slot);
      slot += 1;
      return [item.key, color];
    }),
  );
}

/** Colore stabile per membro: slot in ordine di ingresso (`joinedAt`), uguale in tutti i grafici. */
export function memberColors(
  members: readonly { readonly id: string; readonly joinedAt: string }[],
): Readonly<Record<string, string>> {
  const ordered = [...members].sort(
    (a, b) => a.joinedAt.localeCompare(b.joinedAt) || a.id.localeCompare(b.id),
  );
  return Object.fromEntries(ordered.map((member, index) => [member.id, seriesColor(index)]));
}

export interface Part {
  readonly key: string;
  readonly label: string;
  readonly value: number;
}

/**
 * Al massimo `SERIES_SLOTS` voci: se sono di più, le più grandi restano e le altre si uniscono in "Altro".
 * Ordina dalla più grande (per barre orizzontali ordinate).
 */
export function foldIntoOther(
  parts: readonly Part[],
  otherLabel: string,
  max = SERIES_SLOTS,
): readonly Part[] {
  const sorted = [...parts].sort((a, b) => b.value - a.value);
  if (sorted.length <= max) return sorted;
  const kept = sorted.slice(0, max - 1);
  const rest = sorted.slice(max - 1).reduce((total, part) => total + part.value, 0);
  return [...kept, { key: OTHER_KEY, label: otherLabel, value: rest }];
}
