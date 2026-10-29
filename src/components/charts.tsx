"use client";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, Legend, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/format";

/* Chart colors are their own set, kept apart from the status and verdict colors so a bar never looks like a pill. */
export const SERIES = { a: "#8fb4ff", b: "#c69cff", c: "#ffb38a", d: "#9fe8de", e: "#ffd27f" };
const GRID = "#1f2a38";
const TICK = { fontSize: 11, fill: "#93a1b6" };

const FORMATS = { money: (v: number) => money(v, 0), kt: (v: number) => `${Math.round(v).toLocaleString("en-US")} kt`, plain: (v: number) => String(Math.round(v)) };
type Unit = keyof typeof FORMATS;

/** Top-N horizontal ranking with an "other" row: value at the end of each bar, no angled labels, negatives allowed. */
export function RankedBars({ data, unit = "plain", topN = 6, height, color = SERIES.a, negativeColor = "#ff8a95" }: { data: Array<{ name: string; value: number }>; unit?: Unit; topN?: number; height?: number; color?: string; negativeColor?: string }) {
  const format = FORMATS[unit];
  const sorted = data.slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  const head = sorted.slice(0, topN), tail = sorted.slice(topN);
  const rows = tail.length ? [...head, { name: `Other (${tail.length})`, value: tail.reduce((a, d) => a + d.value, 0) }] : head;
  const hasNeg = rows.some((r) => r.value < 0);
  const h = height ?? Math.max(140, 28 * rows.length + 30);
  if (!rows.length) return <div className="h-[140px] grid place-items-center text-xs text-slate-3">No data in this view.</div>;
  return (
    <ResponsiveContainer width="100%" height={h}>
      <BarChart data={rows} layout="vertical" margin={{ left: 4, right: 64, top: 4, bottom: 4 }} barCategoryGap={6}>
        <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="2 4" />
        <XAxis type="number" hide domain={hasNeg ? ["auto", "auto"] : [0, "auto"]} />
        <YAxis type="category" dataKey="name" width={118} tick={TICK} axisLine={false} tickLine={false} />
        {hasNeg && <ReferenceLine x={0} stroke="#2e3c50" />}
        <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} formatter={(v) => format(Number(v))} contentStyle={{ borderRadius: 10 }} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} isAnimationActive={false}>
          {rows.map((r, i) => <Cell key={i} fill={r.value < 0 ? negativeColor : color} fillOpacity={r.name.startsWith("Other") ? 0.45 : 1 - Math.min(0.5, i * 0.07)} />)}
          <LabelList dataKey="value" position="right" formatter={(v: unknown) => format(Number(v))} style={{ fill: "#e6edf6", fontSize: 11, fontFamily: "var(--font-mono)" }} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function CapexChart({ breakdown }: { breakdown: Record<string, number> }) {
  const data = Object.entries(breakdown).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value);
  return <RankedBars data={data} unit="money" topN={8} color={SERIES.a} />;
}

export function AlternativesChart({ alternatives }: { alternatives: Array<{ name: string; economic: number; environment: number; community: number; viable: boolean }> }) {
  const data = alternatives.map((a) => ({ ...a, name: a.name.length > 26 ? a.name.slice(0, 24) + "…" : a.name }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 8 }} barCategoryGap={10}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="2 4" />
        <XAxis dataKey="name" tick={TICK} interval={0} height={28} axisLine={false} tickLine={false} />
        <YAxis domain={[0, 100]} tick={TICK} axisLine={false} tickLine={false} width={28} />
        <Tooltip cursor={{ fill: "rgba(255,255,255,.03)" }} contentStyle={{ borderRadius: 10 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="economic" name="Economic" fill={SERIES.a} radius={[3, 3, 0, 0]} />
        <Bar dataKey="environment" name="Environment" fill={SERIES.d} radius={[3, 3, 0, 0]} />
        <Bar dataKey="community" name="Community" fill={SERIES.c} radius={[3, 3, 0, 0]}>
          {data.map((d, i) => <Cell key={i} opacity={d.viable ? 1 : 0.45} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Kept for callers that want a plain vertical series; prefer RankedBars for country breakdowns. */
export function SimpleBars({ data, color = SERIES.a, unit = "plain", height = 220 }: { data: Array<{ name: string; value: number }>; color?: string; unit?: Unit; height?: number }) {
  const format = FORMATS[unit];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 8 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="2 4" />
        <XAxis dataKey="name" tick={TICK} interval={0} height={28} axisLine={false} tickLine={false} />
        <YAxis tick={TICK} tickFormatter={format} width={60} axisLine={false} tickLine={false} />
        <Tooltip formatter={(v) => format(Number(v))} contentStyle={{ borderRadius: 10 }} />
        <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
