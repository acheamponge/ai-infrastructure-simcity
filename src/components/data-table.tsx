"use client";
import { useMemo, useState } from "react";

export interface Column<T> {
  key: string;
  label: string;
  numeric?: boolean;
  sort?: (row: T) => number | string | null;
  render: (row: T) => React.ReactNode;
  className?: string;
}

/** Sortable table: click a header to sort, click again to flip. */
export function DataTable<T>({ rows, columns, rowKey, initialSort, onRowClick, empty = "Nothing to show." }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; initialSort?: { key: string; dir: "asc" | "desc" }; onRowClick?: (r: T) => void; empty?: string }) {
  const [sort, setSort] = useState(initialSort ?? null);
  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows.slice().sort((a, b) => {
      const va = col.sort!(a), vb = col.sort!(b);
      if (va == null && vb == null) return 0; if (va == null) return 1; if (vb == null) return -1;
      return (typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb))) * dir;
    });
  }, [rows, sort, columns]);
  const click = (c: Column<T>) => { if (!c.sort) return; setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === "asc" ? "desc" : "asc" } : { key: c.key, dir: c.numeric ? "desc" : "asc" })); };
  return (
    <div className="card overflow-x-auto">
      <table className="table">
        <thead><tr>{columns.map((c) => <th key={c.key} className={`${c.numeric ? "r" : ""} ${c.sort ? "cursor-pointer select-none hover:text-ink" : ""}`} onClick={() => click(c)}>{c.label}{sort?.key === c.key && <span className="ml-1 text-accent" aria-label={sort.dir === "asc" ? "sorted ascending" : "sorted descending"}>{sort.dir === "asc" ? "▲" : "▼"}</span>}</th>)}</tr></thead>
        <tbody>
          {sorted.map((r) => <tr key={rowKey(r)} onClick={onRowClick ? () => onRowClick(r) : undefined} className={onRowClick ? "cursor-pointer" : ""}>{columns.map((c) => <td key={c.key} className={`${c.numeric ? "r" : ""} ${c.className ?? ""}`}>{c.render(r)}</td>)}</tr>)}
          {sorted.length === 0 && <tr><td colSpan={columns.length} className="text-center text-slate-2 py-8">{empty}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}

export function Slider({ label, value, min, max, step, format, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] min-w-[180px]">
      <span className="flex justify-between"><span className="eyebrow">{label}</span><span className="sr-only">: </span><span className="num font-medium">{format(value)}</span></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </label>
  );
}

export function Chips({ options, active, onToggle, all = "All", labels }: { options: string[]; active: Set<string>; onToggle: (v: string | null) => void; all?: string; labels?: Record<string, string> }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group">
      <button type="button" aria-pressed={active.size === 0} className={`pill hover:border-accent/60 transition-colors ${active.size === 0 ? "chip-on" : ""}`} onClick={() => onToggle(null)}>{all}</button>
      {options.map((o) => <button type="button" key={o} aria-pressed={active.has(o)} className={`pill hover:border-accent/60 transition-colors ${active.has(o) ? "chip-on" : ""}`} onClick={() => onToggle(o)}>{labels?.[o] ?? o}</button>)}
    </div>
  );
}
