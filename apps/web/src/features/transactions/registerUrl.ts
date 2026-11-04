// Stato del registro nell'URL (filtri condivisibili e tasto indietro): `?periodo=mese-scorso&tipo=spese&q=coop`.
import { isIsoDate, type PeriodPreset, type RegisterFilter, type Transaction } from "@noi2contiamo/core";

export interface RegisterState {
  readonly preset: PeriodPreset;
  readonly from: string | null;
  readonly to: string | null;
  readonly type: Transaction["type"] | null;
  readonly accountId: string | null;
  readonly memberId: string | null;
  readonly categoryId: string | null;
  readonly payeeId: string | null;
  readonly text: string;
  readonly page: number;
}

export const DEFAULT_PRESET: PeriodPreset = "thisMonth";

const PRESET_SLUGS: Readonly<Record<PeriodPreset, string>> = {
  thisMonth: "questo-mese",
  lastMonth: "mese-scorso",
  last30: "ultimi-30-giorni",
  thisYear: "quest-anno",
  lastYear: "anno-scorso",
  all: "tutto",
  custom: "personalizzato",
};

const TYPE_SLUGS: Readonly<Record<Transaction["type"], string>> = {
  expense: "spese",
  income: "entrate",
  transfer: "giroconti",
};

const fromSlug = <K extends string>(map: Readonly<Record<K, string>>, slug: string | null): K | null =>
  (Object.keys(map) as K[]).find((key) => map[key] === slug) ?? null;

const date = (value: string | null) => (value !== null && isIsoDate(value) ? value : null);
const id = (value: string | null) => (value !== null && value.trim() !== "" ? value : null);

export function parseRegister(params: URLSearchParams): RegisterState {
  const from = date(params.get("dal"));
  const to = date(params.get("al"));
  const preset = fromSlug(PRESET_SLUGS, params.get("periodo")) ?? (from || to ? "custom" : DEFAULT_PRESET);
  const page = Number.parseInt(params.get("pagina") ?? "1", 10);
  return {
    preset,
    from: preset === "custom" ? from : null,
    to: preset === "custom" ? to : null,
    type: fromSlug(TYPE_SLUGS, params.get("tipo")),
    accountId: id(params.get("conto")),
    memberId: id(params.get("persona")),
    categoryId: id(params.get("categoria")),
    payeeId: id(params.get("destinatario")),
    text: params.get("q") ?? "",
    page: Number.isFinite(page) && page > 0 ? page : 1,
  };
}

/** Solo i valori diversi dal default, in ordine fisso: URL corti e stabili. */
export function serializeRegister(state: RegisterState): URLSearchParams {
  const params = new URLSearchParams();
  if (state.preset !== DEFAULT_PRESET) params.set("periodo", PRESET_SLUGS[state.preset]);
  if (state.preset === "custom") {
    if (state.from) params.set("dal", state.from);
    if (state.to) params.set("al", state.to);
  }
  if (state.type) params.set("tipo", TYPE_SLUGS[state.type]);
  if (state.accountId) params.set("conto", state.accountId);
  if (state.memberId) params.set("persona", state.memberId);
  if (state.categoryId) params.set("categoria", state.categoryId);
  if (state.payeeId) params.set("destinatario", state.payeeId);
  if (state.text.trim() !== "") params.set("q", state.text);
  if (state.page > 1) params.set("pagina", String(state.page));
  return params;
}

/** I filtri di `core` (tranne il periodo, che va al backend come intervallo di date). */
export function filterOf(state: RegisterState): RegisterFilter {
  return {
    type: state.type,
    accountId: state.accountId,
    memberId: state.memberId,
    categoryId: state.categoryId,
    payeeId: state.payeeId,
    text: state.text,
  };
}
