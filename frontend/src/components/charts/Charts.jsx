import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatTime } from '../../lib/format';
import { EmptyState } from '../ui/States';
import { axisProps, tooltipProps, useChartColors } from './chartTheme';

const tickTime = (t) => formatTime(t);

/** Time-series area chart. `series`: [{ key, label, color? }] */
export function TimeSeriesChart({ data, series, height = 240, unit = '%', domain = [0, 100], stacked = false, emptyText = 'No telemetry in this range yet' }) {
  const c = useChartColors();
  if (!data?.length) return <EmptyState title={emptyText} className="py-10" />;
  const palette = [c.chart1, c.chart2, c.chart3, c.chart4];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: -14, bottom: 0 }}>
        <defs>
          {series.map((s, i) => (
            <linearGradient key={s.key} id={`grad-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color || palette[i]} stopOpacity={stacked ? 0.55 : 0.22} />
              <stop offset="100%" stopColor={s.color || palette[i]} stopOpacity={stacked ? 0.3 : 0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={c.chartGrid} vertical={false} />
        <XAxis dataKey="t" tickFormatter={tickTime} minTickGap={40} {...axisProps(c)} />
        <YAxis domain={domain} unit={unit} width={52} {...axisProps(c)} />
        <Tooltip {...tooltipProps(c)} labelFormatter={(t) => new Date(t).toLocaleString()} formatter={(v, name) => [`${v}${unit}`, name]} />
        {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: c.textMuted }} />}
        {series.map((s, i) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stackId={stacked ? '1' : undefined}
            stroke={s.color || palette[i]}
            strokeWidth={2}
            fill={`url(#grad-${s.key})`}
            isAnimationActive={false}
            dot={false}
            activeDot={{ r: 3.5, strokeWidth: 0 }}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Donut with a centred total and a legend list. `data`: [{ name, value, color }] */
export function DonutChart({ data, height = 200, centerLabel = 'Total' }) {
  const c = useChartColors();
  const total = data.reduce((a, d) => a + d.value, 0);
  if (!total) return <EmptyState title="Nothing to show yet" className="py-10" />;
  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row">
      <div className="relative" style={{ width: height, height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data.filter((d) => d.value > 0)} dataKey="value" nameKey="name" innerRadius="64%" outerRadius="92%" paddingAngle={2} stroke="none" isAnimationActive={false}>
              {data
                .filter((d) => d.value > 0)
                .map((d) => (
                  <Cell key={d.name} fill={d.color} />
                ))}
            </Pie>
            <Tooltip {...tooltipProps(c)} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="tabular text-2xl font-semibold text-fg">{total}</span>
          <span className="text-xs text-muted">{centerLabel}</span>
        </div>
      </div>
      <ul className="w-full flex-1 space-y-2">
        {data.map((d) => (
          <li key={d.name} className="flex items-center justify-between gap-3 text-sm">
            <span className="flex items-center gap-2 text-muted">
              <span className="h-2.5 w-2.5 rounded-sm" style={{ background: d.color }} aria-hidden />
              {d.name}
            </span>
            <span className="tabular font-medium text-fg">
              {d.value}
              <span className="ml-1.5 text-xs font-normal text-subtle">{Math.round((d.value / total) * 100)}%</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Grouped/stacked vertical bars over time or categories. */
export function BarsChart({ data, xKey = 't', bars, height = 240, stacked = false, timeAxis = true, layout = 'horizontal' }) {
  const c = useChartColors();
  if (!data?.length) return <EmptyState title="No data in this range yet" className="py-10" />;
  const palette = [c.chart1, c.chart2, c.chart3, c.chart4];
  const vertical = layout === 'vertical';
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout={layout} margin={{ top: 6, right: 8, left: vertical ? 8 : -14, bottom: 0 }} barCategoryGap="22%">
        <CartesianGrid stroke={c.chartGrid} vertical={vertical} horizontal={!vertical} />
        {vertical ? (
          <>
            <XAxis type="number" allowDecimals={false} {...axisProps(c)} />
            <YAxis type="category" dataKey={xKey} width={170} {...axisProps(c)} />
          </>
        ) : (
          <>
            <XAxis dataKey={xKey} tickFormatter={timeAxis ? tickTime : undefined} minTickGap={30} {...axisProps(c)} />
            <YAxis allowDecimals={false} width={44} {...axisProps(c)} />
          </>
        )}
        <Tooltip {...tooltipProps(c)} cursor={{ fill: c.chartGrid }} labelFormatter={timeAxis && !vertical ? (t) => new Date(t).toLocaleString() : undefined} />
        {bars.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: c.textMuted }} />}
        {bars.map((b, i) => (
          <Bar key={b.key} dataKey={b.key} name={b.label} fill={b.color || palette[i]} stackId={stacked ? 's' : undefined} radius={stacked ? 0 : [4, 4, 0, 0]} maxBarSize={vertical ? 18 : 28} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
