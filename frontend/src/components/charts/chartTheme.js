import { useEffect, useState } from 'react';
import { useTheme } from '../../context/ThemeContext';

const VARS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4', '--chart-grid', '--text-muted', '--text-subtle', '--surface', '--border', '--healthy', '--warning', '--critical', '--offline', '--info', '--text'];

/** Resolve CSS design tokens to concrete colours for SVG charts (re-read when the theme changes). */
export function useChartColors() {
  const { resolved } = useTheme();
  const [colors, setColors] = useState(() => readColors());
  useEffect(() => setColors(readColors()), [resolved]);
  return colors;
}

function readColors() {
  if (typeof window === 'undefined' || !window.getComputedStyle) return {};
  const style = getComputedStyle(document.documentElement);
  const out = {};
  for (const v of VARS) out[v.slice(2).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = style.getPropertyValue(v).trim() || '#888';
  return out;
}

export const axisProps = (c) => ({
  stroke: c.border,
  tick: { fill: c.textSubtle, fontSize: 11 },
  tickLine: false,
  axisLine: false,
});

export const tooltipProps = (c) => ({
  contentStyle: {
    background: c.surface,
    border: `1px solid ${c.border}`,
    borderRadius: 10,
    fontSize: 12,
    color: c.text,
    boxShadow: '0 8px 24px -8px rgb(0 0 0 / 0.25)',
  },
  labelStyle: { color: c.textMuted, marginBottom: 4 },
  itemStyle: { padding: 0 },
  cursor: { stroke: c.border },
});
