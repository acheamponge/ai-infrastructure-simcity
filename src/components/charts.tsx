"use client";
import { Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { money } from "@/lib/format";

export function CapexChart({ breakdown }: { breakdown: Record<string, number> }) {
  const data = Object.entries(breakdown).map(([k, v]) => ({ name: k, value: v })).sort((a, b) => b.value - a.value);
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
        <CartesianGrid horizontal={false} stroke="#24303f" />
        <XAxis type="number" tickFormatter={(v) => money(v, 0)} tick={{ fontSize: 11 }} />
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 11 }} />
        <Tooltip formatter={(v) => money(Number(v))} />
        <Bar dataKey="value" fill="#7fc4ff" radius={[0, 3, 3, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function AlternativesChart({ alternatives }: { alternatives: Array<{ name: string; economic: number; environment: number; community: number; viable: boolean }> }) {
  const data = alternatives.map((a) => ({ ...a, name: a.name.length > 26 ? a.name.slice(0, 24) + "…" : a.name }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 40 }}>
        <CartesianGrid vertical={false} stroke="#24303f" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-25} textAnchor="end" interval={0} height={60} />
        <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="economic" name="Economic" fill="#7fc4ff" />
        <Bar dataKey="environment" name="Environment" fill="#3fd8c6" />
        <Bar dataKey="community" name="Community" fill="#f0b443">
          {data.map((d, i) => <Cell key={i} opacity={d.viable ? 1 : 0.45} />)}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

const FORMATS = { money: (v: number) => money(v, 0), kt: (v: number) => `${Math.round(v).toLocaleString("en-US")} kt`, plain: (v: number) => String(Math.round(v)) };

export function SimpleBars({ data, color = "#7fc4ff", unit = "plain", height = 220 }: { data: Array<{ name: string; value: number }>; color?: string; unit?: keyof typeof FORMATS; height?: number }) {
  const format = FORMATS[unit];
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ left: 0, right: 10, top: 5, bottom: 30 }}>
        <CartesianGrid vertical={false} stroke="#24303f" />
        <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-20} textAnchor="end" interval={0} height={50} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={format} width={60} />
        <Tooltip formatter={(v) => format(Number(v))} />
        <Bar dataKey="value" fill={color} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
