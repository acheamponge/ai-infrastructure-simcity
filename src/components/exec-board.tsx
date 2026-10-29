"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteBundle } from "@/lib/bundles";
import { estimate } from "@/lib/model/estimate";
import { money, moneyRound, num, pct, years } from "@/lib/format";
import { DataTable, Slider, type Column } from "./data-table";
import { Kpi, Lead, Screening, StatusPill, VerdictPill } from "./ui";
import { RankedBars } from "./charts";

export function ExecBoard({ sites, conditions }: { sites: SiteBundle[]; conditions: Array<{ id: string; siteId: string; siteName: string; conditions: string[] }> }) {
  const [crew, setCrew] = useState(0);        // % change in crew size
  const [robots, setRobots] = useState<number | null>(null); // override automation share, null = as planned
  const [gpu, setGpu] = useState<"" | "h100" | "h200" | "b200" | "gb200" | "gb300" | "next">("");
  const [usePlan, setUsePlan] = useState(false);
  const [pipelineOnly, setPipelineOnly] = useState(false);
  const router = useRouter();

  const rows = useMemo(() => sites
    .filter((s) => !pipelineOnly || s.status !== "OPERATIONAL")
    .map((s) => {
      const base = usePlan && s.planSpec ? s.planSpec : s.spec, mix = usePlan && s.planMix ? s.planMix : s.mix;
      const spec = { ...base, crew: Math.round(base.crew * (1 + crew / 100)), robots: robots ?? base.robots, gpu: gpu || base.gpu };
      return { s, e: estimate(spec, s.factors, mix), ref: estimate(base, s.factors, mix) };
    }), [sites, crew, robots, gpu, usePlan, pipelineOnly]);

  const pipeline = rows.filter((r) => r.s.status !== "OPERATIONAL");
  const capex = pipeline.reduce((a, r) => a + r.e.build.capexUsd, 0);
  const ebitda = rows.reduce((a, r) => a + r.e.operations.ebitdaUsdYr, 0);
  const pf = rows.reduce((a, r) => a + r.e.facility.petaflops, 0);
  const byCountry = Object.entries(rows.reduce<Record<string, number>>((acc, r) => { acc[r.s.country] = (acc[r.s.country] ?? 0) + r.e.build.capexUsd; return acc; }, {})).map(([name, value]) => ({ name, value }));

  const next = pipeline.filter((r) => r.s.verdict !== "NO_GO").sort((a, b) => ((b.s.verdict === "GO" ? 1 : 0) - (a.s.verdict === "GO" ? 1 : 0)) || ((b.e.operations.irr ?? -1) - (a.e.operations.irr ?? -1)))[0] ?? null;
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "site", label: "Site", sort: (r) => r.s.name, render: (r) => <><span className="font-medium text-accent">{r.s.name}</span><div className="text-[11px] text-slate-2">{r.s.operator ?? "—"} · {r.s.country}</div></> },
    { key: "status", label: "Status", sort: (r) => r.s.status, render: (r) => <StatusPill status={r.s.status} /> },
    { key: "mw", label: "MW", numeric: true, sort: (r) => r.e.facility.facilityMw, render: (r) => num(r.e.facility.facilityMw) },
    { key: "capex", label: "Capex", numeric: true, sort: (r) => r.e.build.capexUsd, render: (r) => money(r.e.build.capexUsd) },
    { key: "live", label: "Live in", numeric: true, sort: (r) => r.e.build.monthsToLive, render: (r) => { const d = r.e.build.monthsToLive - r.ref.build.monthsToLive; return <>{r.e.build.monthsToLive} mo{d !== 0 && <span className={`text-[11px] ml-1 ${d < 0 ? "text-teal" : "text-crimson"}`}>({d > 0 ? "+" : ""}{d})</span>}</>; } },
    { key: "path", label: "Critical path", sort: (r) => r.e.build.criticalPath, render: (r) => <span className="text-xs">{r.e.build.criticalPath}</span> },
    { key: "jobs", label: "Jobs build / perm", numeric: true, sort: (r) => r.e.build.constructionJobs, render: (r) => `${num(r.e.build.constructionJobs)} / ${num(r.e.operations.permanentJobs)}` },
    { key: "rev", label: "Revenue / yr", numeric: true, sort: (r) => r.e.operations.revenueUsdYr, render: (r) => money(r.e.operations.revenueUsdYr) },
    { key: "ebitda", label: "EBITDA / yr", numeric: true, sort: (r) => r.e.operations.ebitdaUsdYr, render: (r) => money(r.e.operations.ebitdaUsdYr) },
    { key: "payback", label: "Payback", numeric: true, sort: (r) => r.e.operations.paybackYears ?? 99, render: (r) => years(r.e.operations.paybackYears) },
    { key: "irr", label: "IRR", numeric: true, sort: (r) => r.e.operations.irr, render: (r) => pct(r.e.operations.irr, 0) },
    { key: "verdict", label: "Verdict", sort: (r) => r.s.verdict ?? "", render: (r) => <VerdictPill verdict={r.s.verdict} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {next && <Lead eyebrow="Build next" title={next.s.name} href={`/sites/${next.s.id}`} stats={[{ l: "Capex", v: moneyRound(next.e.build.capexUsd) }, { l: "Live in", v: `${next.e.build.monthsToLive} mo` }, { l: "IRR", v: pct(next.e.operations.irr, 0) }]} note={<>{next.s.operator ?? "Operator unknown"} · {next.s.country} · {next.s.verdict === "GO" ? "a go from the advisor" : next.s.verdict === "CONDITIONAL" ? "conditional, see the open conditions" : "not assessed yet"}. Critical path is {next.e.build.criticalPath}{next.e.flags[0] ? <>; watch: {next.e.flags[0]}</> : "; no engine flags"}.</>} />}
      <div className="card p-4 flex flex-wrap gap-5 items-end">
        <Slider label="Crew size" value={crew} min={-50} max={100} step={10} format={(v) => `${v > 0 ? "+" : ""}${v}%`} onChange={setCrew} />
        <Slider label="Automation share" value={robots === null ? -1 : Math.round(robots * 100)} min={-1} max={100} step={5} format={(v) => (v < 0 ? "as planned" : `${v}%`)} onChange={(v) => setRobots(v < 0 ? null : v / 100)} />
        <label className="flex flex-col gap-1 text-[12px]"><span className="eyebrow">GPU class</span><select value={gpu} onChange={(e) => setGpu(e.target.value as typeof gpu)} className="!w-40"><option value="">as planned</option><option value="h100">H100</option><option value="h200">H200</option><option value="b200">B200</option><option value="gb200">GB200 NVL72</option><option value="gb300">GB300 NVL72</option><option value="next">Rubin</option></select></label>
        <label className="flex items-center gap-2 text-[12px] pb-1"><input type="checkbox" checked={usePlan} onChange={(e) => setUsePlan(e.target.checked)} /> Advisor's plan where one exists</label>
        <label className="flex items-center gap-2 text-[12px] pb-1"><input type="checkbox" checked={pipelineOnly} onChange={(e) => setPipelineOnly(e.target.checked)} /> Pipeline only</label>
        <button className="btn !py-1 text-xs" onClick={() => { setCrew(0); setRobots(null); setGpu(""); setUsePlan(false); setPipelineOnly(false); }}>Reset</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="Pipeline capex" value={moneyRound(capex)} sub={`${pipeline.length} sites not yet operational`} />
        <Kpi label="Portfolio EBITDA / yr" value={moneyRound(ebitda)} />
        <Kpi label="Compute at build-out" value={`${num(pf)} PF`} />
        <Kpi label="Median payback" value={years(median(rows.map((r) => r.e.operations.paybackYears).filter((v): v is number => v !== null)))} />
        <Kpi label="Median time to live" value={`${num(median(pipeline.map((r) => r.e.build.monthsToLive)))} mo`} sub="pipeline" />
      </div>
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-5">
        <div className="card p-4"><div className="flex items-center justify-between mb-2"><div className="eyebrow">Capex by country</div><Screening /></div><RankedBars data={byCountry} unit="money" topN={6} /></div>
        <div className="card"><div className="px-4 py-3 border-b border-line eyebrow">Open conditions</div>
          <ul className="divide-y divide-line text-sm max-h-[260px] overflow-auto">{conditions.map((c) => <li key={c.id} className="px-4 py-2.5"><span className="font-medium text-accent cursor-pointer" onClick={() => router.push(`/sites/${c.siteId}`)}>{c.siteName}</span><ul className="text-xs text-slate-2 mt-1 list-disc pl-4">{c.conditions.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul></li>)}{conditions.length === 0 && <li className="px-4 py-6 text-center text-slate-2">No conditional verdicts yet.</li>}</ul></div>
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.s.id} initialSort={{ key: "capex", dir: "desc" }} onRowClick={(r) => router.push(`/sites/${r.s.id}`)} />
      <p className="text-xs text-slate-2">The sliders apply the same crew, automation and hardware decision to every site and recompute the engine in the browser; the "Live in" delta is against each site's own plan.</p>
    </div>
  );
}

function median(v: number[]): number | null { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
