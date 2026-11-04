// ChartFrame: ogni grafico passa da qui. Impone titolo e riassunto, legenda con 2 o più serie, un solo asse
// verticale, colori dagli slot in ordine, testo sempre in inchiostro, "Mostra tabella" e i tre stati.
import {
  Children,
  isValidElement,
  useEffect,
  useId,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { YAxis } from "recharts";
import { t } from "../../i18n/it";
import { Button } from "../Button/Button";
import { EmptyState, ErrorState, Skeleton } from "../States/States";
import { assignSeriesColors, type ChartSeries } from "./seriesColor";
import { cx } from "../cx";
import styles from "./ChartFrame.module.css";

export type ChartState = "loading" | "empty" | "error" | "ready";

export type ChartDatum = Readonly<Record<string, string | number>>;

export interface ChartFrameProps {
  readonly title: string;
  /** Riassunto per i lettori di schermo: cosa dice il grafico, in una frase. */
  readonly summary: string;
  readonly series: readonly ChartSeries[];
  readonly data: readonly ChartDatum[];
  /** Chiave della categoria (asse orizzontale o etichetta della barra). */
  readonly categoryKey: string;
  readonly categoryLabel?: string;
  /** Formatta i valori in tabella e nel tooltip (es. importi it-IT). */
  readonly formatValue: (value: number) => string;
  readonly state?: ChartState;
  readonly onRetry?: () => void;
  readonly children: (colors: Readonly<Record<string, string>>, animate: boolean) => ReactElement;
}

/** Conta gli `<YAxis>` nell'albero restituito dal grafico: deve essercene al massimo uno. */
export function countYAxes(node: ReactNode): number {
  return Children.toArray(node).reduce<number>((total, child) => {
    if (!isValidElement<{ children?: ReactNode }>(child)) return total;
    return total + (child.type === YAxis ? 1 : 0) + countYAxes(child.props.children);
  }, 0);
}

export function usePrefersReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = (): void => {
      setReduced(media.matches);
    };
    media.addEventListener("change", onChange);
    return () => {
      media.removeEventListener("change", onChange);
    };
  }, []);
  return reduced;
}

export function ChartFrame({
  title,
  summary,
  series,
  data,
  categoryKey,
  categoryLabel = t("chart.category"),
  formatValue,
  state = "ready",
  onRetry,
  children,
}: ChartFrameProps) {
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();
  const tableId = useId();
  const reduced = usePrefersReducedMotion();
  const colors = assignSeriesColors(series);
  const chart = state === "ready" ? children(colors, !reduced) : null;
  if (chart !== null && countYAxes(chart) > 1) {
    throw new Error(`ChartFrame "${title}": un solo asse verticale per grafico (regola 1 di design.md)`);
  }

  return (
    <figure className={cx(styles.frame)} aria-labelledby={titleId}>
      <HatchPatterns />
      <div className={cx(styles.header)}>
        <h3 id={titleId} className={cx(styles.title)}>
          {title}
        </h3>
        {state === "ready" ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={showTable}
            aria-controls={tableId}
            onPress={() => {
              setShowTable((value) => !value);
            }}
          >
            {showTable ? t("chart.hideTable") : t("chart.showTable")}
          </Button>
        ) : null}
      </div>

      {state === "loading" ? <Skeleton blockHeight="chart" label={t("chart.loading")} /> : null}
      {state === "empty" ? <EmptyState title={t("chart.empty")} /> : null}
      {state === "error" ? <ErrorState description={t("chart.error")} onRetry={onRetry} /> : null}

      {state === "ready" ? (
        <>
          {series.length >= 2 ? (
            <ul className={cx(styles.legend)} aria-label={t("chart.legend")}>
              {series.map((item) => (
                <li key={item.key} className={cx(styles.legendItem)}>
                  <span
                    className={cx(styles.swatch)}
                    data-kind={item.kind ?? "series"}
                    style={{ background: colors[item.key] }}
                    aria-hidden="true"
                  />
                  {item.label}
                </li>
              ))}
            </ul>
          ) : null}
          <div className={cx(styles.plot)} role="img" aria-label={summary}>
            {chart}
          </div>
          <div id={tableId} className={cx(showTable ? styles.table : "visually-hidden")}>
            <table className={cx(styles.dataTable)}>
              <caption className="visually-hidden">{t("chart.tableCaption", { title })}</caption>
              <thead>
                <tr>
                  <th scope="col">{categoryLabel}</th>
                  {series.map((item) => (
                    <th key={item.key} scope="col" data-align="end">
                      {item.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, index) => (
                  <tr key={`${String(row[categoryKey])}-${String(index)}`}>
                    <th scope="row">{row[categoryKey]}</th>
                    {series.map((item) => {
                      const value = row[item.key];
                      return (
                        <td key={item.key} data-align="end">
                          {typeof value === "number" ? formatValue(value) : value}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : null}
    </figure>
  );
}

/** Righe a 45° e 135° usate solo con `forced-colors` e in stampa (vedi ChartFrame.module.css). */
function HatchPatterns() {
  return (
    <svg className="visually-hidden" aria-hidden="true" focusable="false">
      <defs>
        {[45, 135].map((angle) => (
          <pattern
            key={angle}
            id={`n2c-hatch-${String(angle)}`}
            width={6}
            height={6}
            patternUnits="userSpaceOnUse"
            patternTransform={`rotate(${String(angle)})`}
          >
            <line x1={0} y1={0} x2={0} y2={6} stroke="CanvasText" strokeWidth={2} />
          </pattern>
        ))}
      </defs>
    </svg>
  );
}

interface TooltipEntry {
  readonly dataKey?: unknown;
  readonly name?: unknown;
  readonly value?: unknown;
  readonly color?: string | undefined;
}

export interface ChartTooltipContentProps {
  readonly active?: boolean;
  readonly label?: unknown;
  readonly payload?: readonly TooltipEntry[];
  readonly formatValue: (value: number) => string;
  readonly labels: Readonly<Record<string, string>>;
}

/** Contenuto del tooltip: superficie rialzata, testo in inchiostro, colore solo nel quadratino. */
export function ChartTooltipContent({
  active,
  label,
  payload,
  formatValue,
  labels,
}: ChartTooltipContentProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className={cx(styles.tooltip)}>
      <p className={cx(styles.tooltipLabel)}>{String(label)}</p>
      <ul className={cx(styles.tooltipList)}>
        {payload.map((entry) => {
          const key = String(entry.dataKey ?? entry.name);
          return (
            <li key={key} className={cx(styles.legendItem)}>
              <span className={cx(styles.swatch)} style={{ background: entry.color }} aria-hidden="true" />
              <span>{labels[key] ?? key}</span>
              <span className={cx(styles.tooltipValue)}>
                {typeof entry.value === "number" ? formatValue(entry.value) : String(entry.value)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Props comuni degli assi e della griglia: inchiostro dei grafici, numeri tabulari. */
export const AXIS_PROPS = {
  stroke: "var(--chart-axis)",
  tick: { fill: "var(--chart-label)", fontSize: "0.75rem" },
  tickLine: false,
} as const;

export const GRID_PROPS = { stroke: "var(--chart-grid)", vertical: false } as const;
