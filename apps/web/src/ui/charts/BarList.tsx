// Parti di un totale come barre orizzontali ordinate, tutte nello stesso colore (niente torte).
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OTHER_COLOR } from "./seriesColor";
import { AXIS_PROPS, ChartFrame, ChartTooltipContent, type ChartFrameProps } from "./ChartFrame";

export type BarListProps = Omit<ChartFrameProps, "children">;

export function BarList(props: BarListProps) {
  const labels = Object.fromEntries(props.series.map((item) => [item.key, item.label]));
  const valueKey = props.series[0]?.key ?? "value";
  const data = [...props.data].sort((a, b) => Number(b[valueKey] ?? 0) - Number(a[valueKey] ?? 0));
  return (
    <ChartFrame {...props} data={data}>
      {(colors, animate) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="var(--chart-grid)" horizontal={false} />
            <XAxis type="number" {...AXIS_PROPS} domain={[0, "auto"]} tickFormatter={props.formatValue} />
            <YAxis type="category" dataKey={props.categoryKey} {...AXIS_PROPS} width={96} />
            <Tooltip content={<ChartTooltipContent formatValue={props.formatValue} labels={labels} />} />
            <Bar
              dataKey={valueKey}
              name={labels[valueKey] ?? valueKey}
              fill={colors[valueKey] ?? OTHER_COLOR}
              isAnimationActive={animate}
              radius={[0, 4, 4, 0]}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
