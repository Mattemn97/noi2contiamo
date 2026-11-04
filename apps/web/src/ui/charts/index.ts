// Grafici: si importano solo da qui, e le pagine li caricano con React.lazy (Recharts pesa).
export { BarList } from "./BarList";
export { ChartFrame, type ChartDatum, type ChartState } from "./ChartFrame";
export { CompareChart } from "./CompareChart";
export {
  assignSeriesColors,
  foldIntoOther,
  memberColors,
  seriesColor,
  type ChartSeries,
} from "./seriesColor";
export { StackedBar } from "./StackedBar";
export { TrendChart } from "./TrendChart";
