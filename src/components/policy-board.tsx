"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteBundle } from "@/lib/bundles";
import { estimate } from "@/lib/model/estimate";
import { money, moneyRound, num, pctCap } from "@/lib/format";
import { Chips, DataTable, Slider, type Column } from "./data-table";
import { Kpi, Lead, Score, Screening, StatusPill, VerdictPill } from "./ui";
import { RankedBars, SERIES } from "./charts";

export function PolicyBoard({ sites }: { sites: SiteBundle[] }) {
  const [countries, setCountries] = useState<Set<string>>(new Set());
  const [carbon, setCarbon] = useState(0);          // USD per tonne
  const [usePlan, setUsePlan] = useState(false);
  const [headroom, setHeadroom] = useState(0);      // % change in grid headroom (new transmission)
  const router = useRouter();
  const allCountries = useMemo(() => [...new Set(sites.map((s) => s.country))].sort(), [sites]);

  const rows = useMemo(() => sites
    .filter((s) => countries.size === 0 || countries.has(s.country))
    .map((s) => {
      const f = { ...s.factors, gridHeadroomMw: s.factors.gridHeadroomMw * (1 + headroom / 100) };
      const spec = usePlan && s.planSpec ? s.planSpec : s.spec, mix = usePlan && s.planMix ? s.planMix : s.mix;
      const e = estimate(spec, f, mix, { carbonPriceUsdT: carbon });
      return { s, e, carbonCost: (e.environment.co2TonnesYr * carbon) };
    }), [sites, countries, carbon, usePlan, headroom]);

  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const co2 = sum((r) => r.e.environment.co2TonnesYr), water = sum((r) => r.e.environment.waterM3Yr), tax = sum((r) => r.e.community.taxRevenueUsdYr);
  const jobsB = sum((r) => r.e.build.constructionJobs), jobsP = sum((r) => r.e.operations.permanentJobs);
  const flagged = rows.filter((r) => r.e.flags.length);
  const byCountry = Object.entries(rows.reduce<Record<string, number>>((acc, r) => { acc[r.s.country] = (acc[r.s.country] ?? 0) + r.e.environment.co2TonnesYr; return acc; }, {})).map(([name, value]) => ({ name, value: value / 1000 }));

  const heaviest = rows.slice().sort((a, b) => (b.e.environment.gridLoadShare + (b.e.environment.waterStressFlag ? 1 : 0)) - (a.e.environment.gridLoadShare + (a.e.environment.waterStressFlag ? 1 : 0)))[0] ?? null;
  const cols: Column<(typeof rows)[number]>[] = [
    { key: "site", label: "Site", sort: (r) => r.s.name, render: (r) => <><span className="font-medium text-accent">{r.s.name}</span><div className="text-[11px] text-slate-2">{[r.s.region, r.s.country].filter(Boolean).join(", ")}</div></> },
    { key: "status", label: "Status", sort: (r) => r.s.status, render: (r) => <StatusPill status={r.s.status} /> },
    { key: "grid", label: "Grid draw vs headroom", numeric: true, sort: (r) => r.e.environment.gridLoadShare, render: (r) => <span className={r.e.environment.gridLoadShare > 0.6 ? "text-crimson font-semibold" : ""} title={r.e.environment.gridLoadShare > 2 ? "The facility would draw more than the region's entire spare capacity" : undefined}>{pctCap(r.e.environment.gridLoadShare)}</span> },
    { key: "co2", label: "CO₂ kt/yr", numeric: true, sort: (r) => r.e.environment.co2TonnesYr, render: (r) => num(r.e.environment.co2TonnesYr / 1000) },
    { key: "ci", label: "g/kWh", numeric: true, sort: (r) => r.e.environment.carbonIntensityG, render: (r) => num(r.e.environment.carbonIntensityG) },
    { key: "water", label: "Water Mm³/yr", numeric: true, sort: (r) => r.e.environment.waterM3Yr, render: (r) => <span className={r.e.environment.waterStressFlag ? "text-crimson" : ""}>{num(r.e.environment.waterM3Yr / 1e6, 2)}</span> },
    { key: "jobs", label: "Jobs build / perm", numeric: true, sort: (r) => r.e.operations.permanentJobs, render: (r) => `${num(r.e.build.constructionJobs)} / ${num(r.e.operations.permanentJobs)}` },
    { key: "tax", label: "Tax / yr", numeric: true, sort: (r) => r.e.community.taxRevenueUsdYr, render: (r) => money(r.e.community.taxRevenueUsdYr) },
    { key: "carbonCost", label: "Carbon cost / yr", numeric: true, sort: (r) => r.carbonCost, render: (r) => (carbon ? money(r.carbonCost) : "—") },
    { key: "nuis", label: "Nuisance", sort: (r) => r.e.community.nuisanceScore, render: (r) => <Score value={100 - r.e.community.nuisanceScore} /> },
    { key: "sent", label: "Sentiment / yr", numeric: true, sort: (r) => r.e.community.sentimentShift, render: (r) => <span className={r.e.community.sentimentShift < 0 ? "text-crimson" : "text-teal"}>{r.e.community.sentimentShift > 0 ? "+" : ""}{r.e.community.sentimentShift.toFixed(1)}</span> },
    { key: "verdict", label: "Verdict", sort: (r) => r.s.verdict ?? "", render: (r) => <VerdictPill verdict={r.s.verdict} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {heaviest && <Lead tone="amber" eyebrow="Largest grid and water hit" title={heaviest.s.name} href={`/sites/${heaviest.s.id}`} stats={[{ l: "Grid draw", v: pctCap(heaviest.e.environment.gridLoadShare) }, { l: "Water / yr", v: `${num(heaviest.e.environment.waterM3Yr / 1e6, 1)} Mm³` }, { l: "CO₂ / yr", v: `${num(heaviest.e.environment.co2TonnesYr / 1e3)} kt` }]} note={<>{[heaviest.s.region, heaviest.s.country].filter(Boolean).join(", ")} · {heaviest.e.environment.gridLoadShare > 0.6 ? "draws more than the advisor allows of regional headroom" : "within the grid headroom floor"}{heaviest.e.environment.waterStressFlag ? ", with evaporative cooling in a water-stressed basin" : ""}. {heaviest.e.flags[0] ?? "No engine flags."}</>} />}
      <div className="card p-4 flex flex-col gap-3">
        <Chips options={allCountries} active={countries} onToggle={(c) => setCountries((prev) => { if (c === null) return new Set(); const n = new Set(prev); if (n.has(c)) n.delete(c); else n.add(c); return n; })} all="All countries" />
        <div className="flex flex-wrap gap-5 items-end">
          <Slider label="Carbon price" value={carbon} min={0} max={200} step={10} format={(v) => `$${v}/t`} onChange={setCarbon} />
          <Slider label="Grid headroom (new transmission)" value={headroom} min={-30} max={100} step={10} format={(v) => `${v > 0 ? "+" : ""}${v}%`} onChange={setHeadroom} />
          <label className="flex items-center gap-2 text-[12px] pb-1"><input type="checkbox" checked={usePlan} onChange={(e) => setUsePlan(e.target.checked)} /> Apply the advisor's plan where one exists</label>
          <button className="btn !py-1 text-xs" onClick={() => { setCarbon(0); setHeadroom(0); setUsePlan(false); setCountries(new Set()); }}>Reset</button>
        </div>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kpi label="CO₂ / yr" value={`${num(co2 / 1e6, 1)} Mt`} tone="warn" sub={carbon ? `${money(co2 * carbon)} at $${carbon}/t` : "no carbon price"} />
        <Kpi label="Water / yr" value={`${num(water / 1e6, 0)} Mm³`} />
        <Kpi label="Jobs" value={`${num(jobsB)} / ${num(jobsP)}`} sub="construction / permanent" />
        <Kpi label="Tax base / yr" value={moneyRound(tax)} sub="state and local, estimated" tone="good" />
        <Kpi label="Sites with flags" value={`${flagged.length} of ${rows.length}`} tone={flagged.length ? "warn" : "good"} />
      </div>
      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-5">
        <div className="card p-4"><div className="flex items-center justify-between mb-2"><div className="eyebrow">Annual CO₂ by country</div><Screening /></div><RankedBars data={byCountry} unit="kt" topN={6} color={SERIES.c} /></div>
        <div className="card"><div className="px-4 py-3 border-b border-line eyebrow">Engine flags</div>
          <ul className="divide-y divide-line text-sm max-h-[300px] overflow-auto">{flagged.map((r) => <li key={r.s.id} className="px-4 py-2.5"><span className="font-medium text-accent cursor-pointer" onClick={() => router.push(`/sites/${r.s.id}`)}>{r.s.name}</span><ul className="text-xs text-amber mt-1 list-disc pl-4">{r.e.flags.map((f) => <li key={f}>{f}</li>)}</ul></li>)}{flagged.length === 0 && <li className="px-4 py-6 text-center text-slate-2">No flags raised.</li>}</ul></div>
      </div>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.s.id} initialSort={{ key: "grid", dir: "desc" }} onRowClick={(r) => router.push(`/sites/${r.s.id}`)} />
      <p className="text-xs text-slate-2">Nuisance bar is the inverse of the nuisance index. Sentiment is the modeled change in community acceptance per year of operation. Grid draw above 60% of regional headroom is a hard failure for the advisor; the headroom slider shows what new transmission would change.</p>
    </div>
  );
}
