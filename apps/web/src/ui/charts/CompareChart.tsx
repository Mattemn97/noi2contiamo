// Confronto tra periodi: il corrente in `--series-1`, quello di confronto in `--chart-compare` (regola 5).
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OTHER_COLOR } from "./seriesColor";
import { AXIS_PROPS, ChartFrame, ChartTooltipContent, GRID_PROPS, type ChartFrameProps } from "./ChartFrame";

export interface CompareChartProps extends Omit<ChartFrameProps, "children" | "series"> {
  readonly current: { readonly key: string; readonly label: string };
  readonly previous: { readonly key: string; readonly label: string };
}

export function CompareChart({ current, previous, ...props }: CompareChartProps) {
  const series = [current, { ...previous, kind: "compare" as const }];
  const labels = { [current.key]: current.label, [previous.key]: previous.label };
  return (
    <ChartFrame {...props} series={series}>
      {(colors, animate) => (
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={[...props.data]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey={props.categoryKey} {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} width={72} domain={[0, "auto"]} tickFormatter={props.formatValue} />
            <Tooltip content={<ChartTooltipContent formatValue={props.formatValue} labels={labels} />} />
            <Bar
              dataKey={current.key}
              name={current.label}
              fill={colors[current.key] ?? OTHER_COLOR}
              isAnimationActive={animate}
            />
            <Bar
              dataKey={previous.key}
              name={previous.label}
              fill={colors[previous.key] ?? OTHER_COLOR}
              isAnimationActive={animate}
            />
          </BarChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
