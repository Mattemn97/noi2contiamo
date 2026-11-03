// Dati del report PDF (feature 18). Puro: riusa dashboard e saldo, così i numeri coincidono con la
// dashboard. Nella vista personale non c'è il saldo e i movimenti privati altrui non entrano mai.
import { memberBalances, type BalanceContext, type BalanceRow, type BalanceTx } from "./balance";
import {
  byCategory,
  contributions,
  dashboardEntries,
  entriesInRange,
  kpis,
  periodAround,
  type CategoryTotal,
  type ClosedRange,
  type CompareGranularity,
  type DashboardContext,
  type DashboardTx,
  type Kpis,
  type MemberContribution,
} from "./dashboard";
import type { IsoDate } from "./ids";

export type ReportTx = DashboardTx & BalanceTx;

export interface ReportData {
  readonly granularity: CompareGranularity;
  readonly range: ClosedRange;
  readonly kpis: Kpis;
  readonly categories: readonly CategoryTotal[];
  readonly contributions: readonly MemberContribution[];
  /** Solo nella vista di famiglia. */
  readonly balances: readonly BalanceRow[] | null;
}

export interface ReportContext extends DashboardContext {
  readonly family: BalanceContext["family"];
  readonly memberIds: readonly string[];
}

export function buildReport(
  txs: readonly ReportTx[],
  ctx: ReportContext,
  granularity: CompareGranularity,
  anchor: IsoDate,
): ReportData {
  const range = periodAround(granularity, anchor);
  const entries = entriesInRange(dashboardEntries(txs, ctx), range);
  return {
    granularity,
    range,
    kpis: kpis(entries),
    categories: byCategory(entries),
    contributions: contributions(entries),
    balances:
      ctx.view.kind === "family"
        ? memberBalances(txs, {
            accounts: ctx.accounts,
            family: ctx.family,
            memberIds: ctx.memberIds,
            range,
          }).rows
        : null,
  };
}
