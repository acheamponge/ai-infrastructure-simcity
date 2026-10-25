"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { EnergyMix, EnergySource, EstimateResult, SiteSpec } from "@/lib/model/types";
import { money, num, pct, years } from "@/lib/format";

const SOURCE_LABELS: Record<EnergySource, string> = { grid: "Grid", gas: "On-site gas", solar: "Solar + storage", wind: "Wind + storage", nuclear: "Small modular reactor", geothermal: "Geothermal", hydro: "Hydro PPA" };
const ORDER: EnergySource[] = ["grid", "gas", "solar", "wind", "nuclear", "geothermal", "hydro"];

export function EnergyMixer({ siteId, initialSpec, initialMix, baseline, geothermalAvailable }: { siteId: string; initialSpec: SiteSpec; initialMix: EnergyMix; baseline: EstimateResult; geothermalAvailable: boolean }) {
  const [spec, setSpec] = useState<SiteSpec>(initialSpec);
  const [weights, setWeights] = useState<EnergyMix>(initialMix);
  const [est, setEst] = useState<EstimateResult>(baseline);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("What-if");
  const [saved, setSaved] = useState<string | null>(null);
  const router = useRouter();
  const mix = useMemo(() => {
    const total = ORDER.reduce((a, k) => a + weights[k], 0) || 1;
    return Object.fromEntries(ORDER.map((k) => [k, weights[k] / total])) as EnergyMix;
  }, [weights]);

  useEffect(() => {
    const t = setTimeout(async () => {
      setBusy(true);
      try {
        const r = await fetch("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId, spec, energyMix: mix, preview: true }) });
        const j = await r.json();
        if (j.estimate) setEst(j.estimate);
      } finally { setBusy(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [siteId, spec, mix]);

  async function save(assess: boolean) {
    setBusy(true);
    try {
      const r = await fetch("/api/scenarios", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId, spec, energyMix: mix, name }) });
      const j = await r.json();
      if (assess && j.id) await fetch("/api/agents/assess", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenarioId: j.id }) });
      setSaved(j.id);
      router.refresh();
    } finally { setBusy(false); }
  }

  const d = (a: number, b: number) => (a === b ? "" : a > b ? "text-teal" : "text-crimson");
  const row = (label: string, v: string, base: string, cls = "") => (
    <tr><td className="text-slate-2">{label}</td><td className={`r font-medium ${cls}`}>{v}</td><td className="r text-slate-2">{base}</td></tr>
  );

  return (
    <div className="grid lg:grid-cols-[1.1fr_1fr] gap-5">
      <div className="card p-4 flex flex-col gap-4">
        <div>
          <div className="eyebrow mb-2">Energy supply mix</div>
          <div className="flex flex-col gap-2.5">
            {ORDER.map((k) => (
              <label key={k} className={`grid grid-cols-[150px_1fr_52px] items-center gap-3 text-[13px] ${k === "geothermal" && !geothermalAvailable ? "opacity-50" : ""}`}>
                <span>{SOURCE_LABELS[k]}{k === "geothermal" && !geothermalAvailable && <span className="block text-[10px] text-slate-2">no mapped resource</span>}</span>
                <input type="range" min={0} max={100} step={5} value={Math.round(weights[k] * 100)} onChange={(e) => setWeights({ ...weights, [k]: Number(e.target.value) / 100 })} aria-label={SOURCE_LABELS[k]} />
                <span className="num text-right">{Math.round(mix[k] * 100)}%</span>
              </label>
            ))}
          </div>
          <div className="text-[11px] text-slate-2 mt-2">Sliders are weights; shares are normalized to 100%.</div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-[13px]">
          <label>IT load (MW)<input type="number" min={1} value={spec.itMw} onChange={(e) => setSpec({ ...spec, itMw: Number(e.target.value) })} /></label>
          <label>GPU class<select value={spec.gpu} onChange={(e) => setSpec({ ...spec, gpu: e.target.value as SiteSpec["gpu"] })}><option value="h100">H100</option><option value="b200">B200</option><option value="gb300">GB300</option><option value="next">Next-gen (2028)</option></select></label>
          <label>Rack density<select value={spec.densityKw} onChange={(e) => setSpec({ ...spec, densityKw: Number(e.target.value) as SiteSpec["densityKw"] })}><option value={40}>40 kW · air</option><option value={80}>80 kW · liquid</option><option value={130}>130 kW · liquid</option></select></label>
          <label>Construction crew<input type="number" min={50} step={50} value={spec.crew} onChange={(e) => setSpec({ ...spec, crew: Number(e.target.value) })} /></label>
          <label className="col-span-2">Automation share <span className="num">{Math.round(spec.robots * 100)}%</span><input type="range" min={0} max={100} step={5} value={Math.round(spec.robots * 100)} onChange={(e) => setSpec({ ...spec, robots: Number(e.target.value) / 100 })} /></label>
        </div>
        <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-line">
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="!w-40" aria-label="Scenario name" />
          <button className="btn" onClick={() => save(false)} disabled={busy}>Save scenario</button>
          <button className="btn btn-primary" onClick={() => save(true)} disabled={busy}>Save and assess</button>
          {saved && <span className="text-xs text-teal">saved</span>}
        </div>
      </div>
      <div className="card p-4">
        <div className="flex items-center justify-between mb-2"><div className="eyebrow">Live estimate</div><span className="text-[11px] text-slate-2">{busy ? "recomputing…" : "vs. baseline"}</span></div>
        <div className="grid grid-cols-4 gap-2 mb-3">
          {([["Composite", est.scores.composite, baseline.scores.composite], ["Economic", est.scores.economic, baseline.scores.economic], ["Environment", est.scores.environment, baseline.scores.environment], ["Community", est.scores.community, baseline.scores.community]] as const).map(([l, v, b]) => (
            <div key={l} className="rounded bg-paper px-2.5 py-2"><div className="text-[10px] uppercase tracking-wider text-slate-2">{l}</div><div className={`num text-lg font-semibold ${d(v, b)}`}>{v}</div></div>
          ))}
        </div>
        <table className="table">
          <thead><tr><th>Metric</th><th className="r">This mix</th><th className="r">Baseline</th></tr></thead>
          <tbody>
            {row("Build cost", money(est.build.capexUsd), money(baseline.build.capexUsd), d(baseline.build.capexUsd, est.build.capexUsd))}
            {row("Months to live", num(est.build.monthsToLive), num(baseline.build.monthsToLive), d(baseline.build.monthsToLive, est.build.monthsToLive))}
            {row("Blended power", `$${est.operations.blendedPowerPriceKwh.toFixed(3)}/kWh`, `$${baseline.operations.blendedPowerPriceKwh.toFixed(3)}/kWh`, d(baseline.operations.blendedPowerPriceKwh, est.operations.blendedPowerPriceKwh))}
            {row("Utilization", pct(est.operations.utilization), pct(baseline.operations.utilization), d(est.operations.utilization, baseline.operations.utilization))}
            {row("EBITDA / yr", money(est.operations.ebitdaUsdYr), money(baseline.operations.ebitdaUsdYr), d(est.operations.ebitdaUsdYr, baseline.operations.ebitdaUsdYr))}
            {row("Payback", years(est.operations.paybackYears), years(baseline.operations.paybackYears), d(baseline.operations.paybackYears ?? 99, est.operations.paybackYears ?? 99))}
            {row("IRR", pct(est.operations.irr, 1), pct(baseline.operations.irr, 1), d(est.operations.irr ?? 0, baseline.operations.irr ?? 0))}
            {row("CO₂ / yr", `${num(est.environment.co2TonnesYr)} t`, `${num(baseline.environment.co2TonnesYr)} t`, d(baseline.environment.co2TonnesYr, est.environment.co2TonnesYr))}
            {row("Carbon intensity", `${num(est.environment.carbonIntensityG)} g/kWh`, `${num(baseline.environment.carbonIntensityG)} g/kWh`, d(baseline.environment.carbonIntensityG, est.environment.carbonIntensityG))}
            {row("Water / yr", `${num(est.environment.waterM3Yr)} m³`, `${num(baseline.environment.waterM3Yr)} m³`, d(baseline.environment.waterM3Yr, est.environment.waterM3Yr))}
            {row("Grid draw vs headroom", pct(est.environment.gridLoadShare), pct(baseline.environment.gridLoadShare), d(baseline.environment.gridLoadShare, est.environment.gridLoadShare))}
            {row("Land", `${num(est.facility.landHa)} ha`, `${num(baseline.facility.landHa)} ha`, d(baseline.facility.landHa, est.facility.landHa))}
            {row("Permanent jobs", num(est.operations.permanentJobs), num(baseline.operations.permanentJobs), d(est.operations.permanentJobs, baseline.operations.permanentJobs))}
            {row("Nuisance index", num(est.community.nuisanceScore), num(baseline.community.nuisanceScore), d(baseline.community.nuisanceScore, est.community.nuisanceScore))}
          </tbody>
        </table>
        {est.flags.length > 0 && (
          <ul className="mt-3 text-xs text-amber list-disc pl-4 space-y-1">{est.flags.map((f) => <li key={f}>{f}</li>)}</ul>
        )}
      </div>
    </div>
  );
}
