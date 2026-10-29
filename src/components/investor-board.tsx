"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteBundle } from "@/lib/bundles";
import { estimate } from "@/lib/model/estimate";
import { money, moneyRound, pct, years, num } from "@/lib/format";
import { DataTable, Slider, type Column } from "./data-table";
import { Kpi, Lead, Screening, StatusPill, VerdictPill } from "./ui";
import { RankedBars, SERIES } from "./charts";

export function InvestorBoard({ sites }: { sites: SiteBundle[] }) {
  const [power, setPower] = useState(0);      // % change in grid power price
  const [firm, setFirm] = useState(0);        // % change in supply firmness
  const [price, setPrice] = useState(0);      // % change in GPU-hour rate
  const [disc, setDisc] = useState(10);       // discount rate %
  const [usePlan, setUsePlan] = useState(false);
  const router = useRouter();

  const rows = useMemo(() => sites.map((s) => {
    const f = { ...s.factors, powerPriceKwh: s.factors.powerPriceKwh * (1 + power / 100), gridReliability: Math.min(1, s.factors.gridReliability * (1 + firm / 100)), solar: Math.min(1, s.factors.solar * (1 + firm / 100)), wind: Math.min(1, s.factors.wind * (1 + firm / 100)) };
    const spec = usePlan && s.planSpec ? s.planSpec : s.spec, mix = usePlan && s.planMix ? s.planMix : s.mix;
    const e = estimate(spec, f, mix, { priceMult: 1 + price / 100, discount: disc / 100 });
    const base = estimate(spec, s.factors, mix, { discount: disc / 100 });
    return { s, e, base };
  }).sort((a, b) => (b.e.operations.irr ?? -1) - (a.e.operations.irr ?? -1)), [sites, power, firm, price, disc, usePlan]);

  const top = rows.find((r) => r.s.verdict !== "NO_GO") ?? rows[0] ?? null;
  const flip = useMemo(() => {
    if (!top) return null;
    const spec = usePlan && top.s.planSpec ? top.s.planSpec : top.s.spec, mix = usePlan && top.s.planMix ? top.s.planMix : top.s.mix;
    for (let p = power + 5; p <= 80; p += 5) { const f = { ...top.s.factors, powerPriceKwh: top.s.factors.powerPriceKwh * (1 + p / 100) }; const e = estimate(spec, f, mix, { priceMult: 1 + price / 100, discount: disc / 100 }); if ((e.operations.irr ?? 0) < 0.08) return { kind: "power" as const, at: p }; }
    for (let q = price - 5; q >= -60; q -= 5) { const e = estimate(spec, top.s.factors, mix, { priceMult: 1 + q / 100, discount: disc / 100 }); if ((e.operations.irr ?? 0) < 0.08) return { kind: "gpu" as const, at: q }; }
    return null;
  }, [top, usePlan, power, price, disc]);
  const totalNpv = rows.reduce((a, r) => a + r.e.operations.npv10Usd, 0);
  const bankable = rows.filter((r) => (r.e.operations.irr ?? 0) >= 0.08 && r.s.verdict !== "NO_GO");
  const byCountry = Object.entries(rows.reduce<Record<string, number>>((acc, r) => { acc[r.s.country] = (acc[r.s.country] ?? 0) + r.e.operations.npv10Usd; return acc; }, {})).map(([name, value]) => ({ name, value }));

  const cols: Column<(typeof rows)[number]>[] = [
    { key: "site", label: "Site", sort: (r) => r.s.name, render: (r) => <><span className="font-medium text-accent">{r.s.name}</span><div className="text-[11px] text-slate-2">{r.s.operator ?? "—"} · {r.s.country}</div></> },
    { key: "status", label: "Status", sort: (r) => r.s.status, render: (r) => <StatusPill status={r.s.status} /> },
    { key: "capex", label: "Capex", numeric: true, sort: (r) => r.e.build.capexUsd, render: (r) => money(r.e.build.capexUsd) },
    { key: "irr", label: "IRR", numeric: true, sort: (r) => r.e.operations.irr, render: (r) => <span className={`font-semibold ${(r.e.operations.irr ?? 0) >= 0.12 ? "text-teal" : (r.e.operations.irr ?? 0) < 0.08 ? "text-crimson" : ""}`}>{pct(r.e.operations.irr, 1)}</span> },
    { key: "dirr", label: "Δ vs base", numeric: true, sort: (r) => (r.e.operations.irr ?? 0) - (r.base.operations.irr ?? 0), render: (r) => { const d = ((r.e.operations.irr ?? 0) - (r.base.operations.irr ?? 0)) * 100; return <span className={d > 0.05 ? "text-teal" : d < -0.05 ? "text-crimson" : "text-slate-2"}>{d > 0 ? "+" : ""}{d.toFixed(1)} pt</span>; } },
    { key: "npv", label: "NPV", numeric: true, sort: (r) => r.e.operations.npv10Usd, render: (r) => money(r.e.operations.npv10Usd) },
    { key: "payback", label: "Payback", numeric: true, sort: (r) => r.e.operations.paybackYears ?? 99, render: (r) => years(r.e.operations.paybackYears) },
    { key: "util", label: "Util.", numeric: true, sort: (r) => r.e.operations.utilization, render: (r) => pct(r.e.operations.utilization) },
    { key: "ebitda", label: "EBITDA / yr", numeric: true, sort: (r) => r.e.operations.ebitdaUsdYr, render: (r) => money(r.e.operations.ebitdaUsdYr) },
    { key: "verdict", label: "Verdict", sort: (r) => r.s.verdict ?? "", render: (r) => <VerdictPill verdict={r.s.verdict} /> },
  ];

  return (
    <div className="flex flex-col gap-5">
      {top && <Lead tone="violet" eyebrow="Best risk-adjusted site" title={top.s.name} href={`/sites/${top.s.id}`} stats={[{ l: "IRR", v: pct(top.e.operations.irr, 1) }, { l: "NPV", v: moneyRound(top.e.operations.npv10Usd) }, { l: "Payback", v: years(top.e.operations.paybackYears) }]} note={<>{top.s.operator ?? "Operator unknown"} · {top.s.country} · {top.s.verdict ? `advisor says ${top.s.verdict.replace("_", " ").toLowerCase()}` : "not assessed yet"}. {flip ? (flip.kind === "power" ? `IRR drops below 8% if grid power rises ${flip.at}% from here; move the first slider to see it.` : `IRR drops below 8% if GPU-hour prices fall ${Math.abs(flip.at)}% from here; move the third slider to see it.`) : "IRR holds above 8% through the full range of every slider."}</>} />}
      <div className="card p-4 flex flex-wrap gap-5 items-end">
        <Slider label="Grid power price" value={power} min={-30} max={60} step={5} format={(v) => `${v > 0 ? "+" : ""}${v}%`} onChange={setPower} />
        <Slider label="Supply firmness" value={firm} min={-30} max={10} step={5} format={(v) => `${v > 0 ? "+" : ""}${v}%`} onChange={setFirm} />
        <Slider label="GPU-hour price" value={price} min={-40} max={20} step={5} format={(v) => `${v > 0 ? "+" : ""}${v}%`} onChange={setPrice} />
        <Slider label="Discount rate" value={disc} min={6} max={16} step={1} format={(v) => `${v}%`} onChange={setDisc} />
        <label className="flex items-center gap-2 text-[12px] pb-1"><input type="checkbox" checked={usePlan} onChange={(e) => setUsePlan(e.target.checked)} /> Use the advisor's plan where one exists</label>
        <button className="btn !py-1 text-xs" onClick={() => { setPower(0); setFirm(0); setPrice(0); setDisc(10); setUsePlan(false); }}>Reset</button>
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Portfolio NPV" value={moneyRound(totalNpv)} sub={`10 yr at ${disc}%`} tone={totalNpv > 0 ? "good" : "bad"} />
        <Kpi label="Clearing 8% IRR" value={`${bankable.length} of ${rows.length}`} sub="and not a no-go" />
        <Kpi label="Best IRR" value={pct(rows[0]?.e.operations.irr, 1)} sub={rows[0]?.s.name} />
        <Kpi label="Median payback" value={years(median(rows.map((r) => r.e.operations.paybackYears).filter((v): v is number => v !== null)))} />
      </div>
      <div className="card p-4"><div className="flex items-center justify-between mb-2"><div className="eyebrow">NPV by country under these assumptions</div><Screening /></div><RankedBars data={byCountry} unit="money" topN={6} color={SERIES.d} /></div>
      <DataTable rows={rows} columns={cols} rowKey={(r) => r.s.id} initialSort={{ key: "irr", dir: "desc" }} onRowClick={(r) => router.push(`/sites/${r.s.id}`)} />
      <p className="text-xs text-slate-2">{num(rows.length)} sites. Every row is recomputed in the browser from the site's region profile and baseline spec as you move the sliders. "Δ vs base" compares against the unstressed estimate at the same discount rate.</p>
    </div>
  );
}

function median(v: number[]): number | null { if (!v.length) return null; const s = [...v].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
