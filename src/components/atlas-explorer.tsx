"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteBundle } from "@/lib/bundles";
import { estimate } from "@/lib/model/estimate";
import { money, num, years, statusLabel, verdictLabel } from "@/lib/format";
import { Chips, DataTable, type Column } from "./data-table";
import { StatusPill, VerdictPill } from "./ui";
import { SiteMapLoader } from "./site-map-loader";

const STATUSES = ["OPERATIONAL", "CONSTRUCTION", "PLANNED", "PROPOSED"];

export function AtlasExplorer({ sites }: { sites: SiteBundle[] }) {
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [countries, setCountries] = useState<Set<string>>(new Set());
  const [verdicts, setVerdicts] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [minMw, setMinMw] = useState(0);
  const router = useRouter();
  const allCountries = useMemo(() => [...new Set(sites.map((s) => s.country))].sort(), [sites]);
  const toggle = (set: (f: (p: Set<string>) => Set<string>) => void) => (v: string | null) => set((prev) => { if (v === null) return new Set(); const n = new Set(prev); if (n.has(v)) n.delete(v); else n.add(v); return n; });

  const rows = useMemo(() => sites
    .filter((s) => (statuses.size === 0 || statuses.has(s.status)) && (countries.size === 0 || countries.has(s.country)) && (verdicts.size === 0 || verdicts.has(s.verdict ?? "NONE")) && (s.capacityMw ?? 0) >= minMw && (!q || `${s.name} ${s.operator ?? ""} ${s.city ?? ""} ${s.region ?? ""} ${s.country}`.toLowerCase().includes(q.toLowerCase())))
    .map((s) => ({ s, e: estimate(s.spec, s.factors, s.mix) })), [sites, statuses, countries, verdicts, q, minMw]);
  const mw = rows.reduce((a, r) => a + (r.s.capacityMw ?? 0), 0);

  const cols: Column<(typeof rows)[number]>[] = [
    { key: "site", label: "Site", sort: (r) => r.s.name, render: (r) => <><span className="font-medium text-accent">{r.s.name}</span><div className="text-[11px] text-slate-2">{[r.s.city, r.s.region, r.s.country].filter(Boolean).join(", ")}</div></> },
    { key: "op", priority: 2, label: "Operator", sort: (r) => r.s.operator ?? "", render: (r) => r.s.operator ?? <span className="text-slate-2">—</span> },
    { key: "status", priority: 1, label: "Status", sort: (r) => r.s.status, render: (r) => <StatusPill status={r.s.status} /> },
    { key: "mw", priority: 1, label: "MW", numeric: true, sort: (r) => r.s.capacityMw, render: (r) => num(r.s.capacityMw) },
    { key: "capex", priority: 1, label: "Capex", numeric: true, sort: (r) => r.e.build.capexUsd, render: (r) => money(r.e.build.capexUsd) },
    { key: "live", priority: 3, label: "Live in", numeric: true, sort: (r) => r.e.build.monthsToLive, render: (r) => `${r.e.build.monthsToLive} mo` },
    { key: "payback", priority: 2, label: "Payback", numeric: true, sort: (r) => r.e.operations.paybackYears ?? 99, render: (r) => years(r.e.operations.paybackYears) },
    { key: "co2", priority: 3, label: "CO₂ kt/yr", numeric: true, sort: (r) => r.e.environment.co2TonnesYr, render: (r) => num(r.e.environment.co2TonnesYr / 1000) },
    { key: "prof", priority: 3, label: "Profile", sort: (r) => (r.s.enriched ? 1 : 0), render: (r) => <span className={`pill ${r.s.enriched ? "pill-go" : ""}`}>{r.s.enriched ? "sourced" : "priors"}</span> },
    { key: "verdict", priority: 1, label: "Verdict", sort: (r) => r.s.verdict ?? "", render: (r) => <VerdictPill verdict={r.s.verdict} /> },
    { key: "sim", label: "", render: (r) => <a href={`/?site=${r.s.id}`} className="btn !py-0.5 !px-2 text-[11px]" onClick={(e) => e.stopPropagation()}>Simulate</a> },
  ];

  return (
    <div className="flex flex-col gap-4">
      <SiteMapLoader sites={rows.map((r) => ({ id: r.s.id, name: r.s.name, operator: r.s.operator, lat: r.s.lat, lon: r.s.lon, status: r.s.status, capacityMw: r.s.capacityMw, country: r.s.country, verdict: r.s.verdict }))} />
      <div className="card p-4 flex flex-col gap-3">
        <div className="flex flex-wrap gap-4 items-center">
          <input type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, operator, place" className="!w-64 !py-1.5" />
          <label className="flex items-center gap-2 text-[12px]">Min MW <input type="range" min={0} max={2000} step={50} value={minMw} onChange={(e) => setMinMw(Number(e.target.value))} className="!w-40" /><span className="num w-10">{minMw}</span></label>
          <span className="text-xs text-slate-2 ml-auto num">{rows.length} sites · {num(mw)} MW</span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-2 items-start">
          <div><div className="eyebrow mb-1">Status</div><Chips options={STATUSES} active={statuses} onToggle={toggle(setStatuses)} labels={statusLabel} /></div>
          <div><div className="eyebrow mb-1">Verdict</div><Chips options={["GO", "CONDITIONAL", "NO_GO", "NONE"]} active={verdicts} onToggle={toggle(setVerdicts)} labels={{ ...verdictLabel, NONE: "Not assessed" }} /></div>
          <div className="min-w-0"><div className="eyebrow mb-1">Country</div><Chips options={allCountries} active={countries} onToggle={toggle(setCountries)} /></div>
        </div>
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.s.id} initialSort={{ key: "mw", dir: "desc" }} onRowClick={(r) => router.push(`/sites/${r.s.id}`)} empty="Nothing matches. Clear the filters or run discovery." />
    </div>
  );
}
