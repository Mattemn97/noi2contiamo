// Una sola barra impilata: le parti di un totale (es. contributo dei membri), colori per slot in ordine.
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OTHER_COLOR } from "./seriesColor";
import { AXIS_PROPS, ChartFrame, ChartTooltipContent, type ChartFrameProps } from "./ChartFrame";

export type StackedBarProps = Omit<ChartFrameProps, "children">;

export function StackedBar(props: StackedBarProps) {
  const labels = Object.fromEntries(props.series.map((item) => [item.key, item.label]));
  return (
    <ChartFrame {...props}>
      {(colors, animate) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={[...props.data]}
            layout="vertical"
            margin={{ top: 0, right: 16, bottom: 0, left: 0 }}
          >
            <XAxis type="number" {...AXIS_PROPS} domain={[0, "auto"]} tickFormatter={props.formatValue} />
            <YAxis type="category" dataKey={props.categoryKey} {...AXIS_PROPS} width={96} />
            <Tooltip content={<ChartTooltipContent formatValue={props.formatValue} labels={labels} />} />
            {props.series.map((item) => (
              <Bar
                key={item.key}
                dataKey={item.key}
                name={item.label}
                stackId="totale"
                fill={colors[item.key] ?? OTHER_COLOR}
                stroke="var(--chart-surface)"
                isAnimationActive={animate}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
