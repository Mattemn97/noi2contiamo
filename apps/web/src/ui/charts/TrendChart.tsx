// Andamento nel tempo: linee, una per serie, un solo asse verticale.
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { OTHER_COLOR } from "./seriesColor";
import { AXIS_PROPS, ChartFrame, ChartTooltipContent, GRID_PROPS, type ChartFrameProps } from "./ChartFrame";

export type TrendChartProps = Omit<ChartFrameProps, "children">;

export function TrendChart(props: TrendChartProps) {
  const labels = Object.fromEntries(props.series.map((item) => [item.key, item.label]));
  return (
    <ChartFrame {...props}>
      {(colors, animate) => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={[...props.data]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid {...GRID_PROPS} />
            <XAxis dataKey={props.categoryKey} {...AXIS_PROPS} />
            <YAxis {...AXIS_PROPS} width={72} tickFormatter={(value: number) => props.formatValue(value)} />
            <Tooltip content={<ChartTooltipContent formatValue={props.formatValue} labels={labels} />} />
            {props.series.map((item) => (
              <Line
                key={item.key}
                dataKey={item.key}
                name={item.label}
                type="monotone"
                stroke={colors[item.key] ?? OTHER_COLOR}
                strokeWidth={2}
                {...(item.kind === "compare" ? { strokeDasharray: "6 4" } : {})}
                dot={false}
                isAnimationActive={animate}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </ChartFrame>
  );
}
