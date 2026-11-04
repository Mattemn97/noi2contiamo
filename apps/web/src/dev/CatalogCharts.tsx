// Grafici del catalogo, caricati con React.lazy: Recharts arriva solo qui.
import { cents } from "@noi2contiamo/core";
import { t } from "../i18n/it";
import { formatCents } from "../ui";
import { BarList, CompareChart, StackedBar, TrendChart } from "../ui/charts";
import { cx } from "../ui/cx";
import styles from "./UiCatalog.module.css";

const euro = (value: number): string => formatCents(cents(Math.round(value)));

const TREND = [
  { mese: "Giu", uscite: 182000, entrate: 320000 },
  { mese: "Lug", uscite: 201000, entrate: 320000 },
  { mese: "Ago", uscite: 289000, entrate: 335000 },
  { mese: "Set", uscite: 196000, entrate: 320000 },
  { mese: "Ott", uscite: 210500, entrate: 322000 },
  { mese: "Nov", uscite: 188400, entrate: 320000 },
];

const CATEGORIES = [
  { voce: t("dev.categoryFood"), importo: 48350 },
  { voce: t("dev.categoryHome"), importo: 120000 },
  { voce: t("dev.categoryLeisure"), importo: 9900 },
  { voce: t("dev.categoryTransport"), importo: 15990 },
];

const MEMBERS = [{ voce: t("dev.expenses"), anna: 115500, luca: 77000 }];

const COMPARE = [
  { voce: t("dev.categoryHome"), corrente: 120000, precedente: 110000 },
  { voce: t("dev.categoryFood"), corrente: 48350, precedente: 51200 },
  { voce: t("dev.categoryTransport"), corrente: 15990, precedente: 14000 },
];

export function CatalogCharts() {
  return (
    <div className={cx(styles.chartGrid)}>
      <TrendChart
        title={t("dev.trendTitle")}
        summary={t("dev.trendSummary")}
        series={[
          { key: "uscite", label: t("dev.expenses") },
          { key: "entrate", label: t("dev.income") },
        ]}
        data={TREND}
        categoryKey="mese"
        formatValue={euro}
      />
      <BarList
        title={t("dev.barTitle")}
        summary={t("dev.barSummary")}
        series={[{ key: "importo", label: t("dev.expenses") }]}
        data={CATEGORIES}
        categoryKey="voce"
        formatValue={euro}
      />
      <StackedBar
        title={t("dev.stackTitle")}
        summary={t("dev.stackSummary")}
        series={[
          { key: "anna", label: t("dev.memberA") },
          { key: "luca", label: t("dev.memberB") },
        ]}
        data={MEMBERS}
        categoryKey="voce"
        formatValue={euro}
      />
      <CompareChart
        title={t("dev.compareTitle")}
        summary={t("dev.compareSummary")}
        current={{ key: "corrente", label: t("dev.current") }}
        previous={{ key: "precedente", label: t("dev.previous") }}
        data={COMPARE}
        categoryKey="voce"
        formatValue={euro}
      />
      <BarList
        title={t("dev.barTitle")}
        summary={t("dev.barSummary")}
        series={[{ key: "importo", label: t("dev.expenses") }]}
        data={[]}
        categoryKey="voce"
        formatValue={euro}
        state="empty"
      />
      <TrendChart
        title={t("dev.trendTitle")}
        summary={t("dev.trendSummary")}
        series={[{ key: "uscite", label: t("dev.expenses") }]}
        data={[]}
        categoryKey="mese"
        formatValue={euro}
        state="error"
        onRetry={() => undefined}
      />
    </div>
  );
}
