import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { ensureBaseline, ensureProfile } from "@/lib/sites";
import { EnergyMixer } from "@/components/energy-mixer";
import { SiteMeasure } from "@/components/site-measure";
import { RunButton } from "@/components/run-button";
import { AlternativesChart, CapexChart } from "@/components/charts";
import { SiteMapLoader } from "@/components/site-map-loader";
import { Kpi, Lead, Score, SectionTitle, StatusPill, VerdictPill } from "@/components/ui";
import { SiteGlyph } from "@/components/site-glyph";
import { ConceptRender } from "@/components/concept-render";
import type { StoredLayers } from "@/lib/vision/sam";
import { dateShort, money, moneyRound, num, pct, years } from "@/lib/format";
import { mixLabel } from "@/lib/model/energy";
import type { EnergyMix, EstimateResult, SiteSpec } from "@/lib/model/types";

export const dynamic = "force-dynamic";

export default async function SitePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = await prisma.site.findUnique({ where: { id } });
  if (!site) notFound();
  const profile = await ensureProfile(site);
  await ensureBaseline(site);
  const scenarios = await prisma.scenario.findMany({ where: { siteId: id }, orderBy: [{ isBaseline: "desc" }, { createdAt: "desc" }], include: { assessments: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const baseline = scenarios.find((s) => s.isBaseline)!;
  const base = baseline.estimate as unknown as EstimateResult;
  const latest = scenarios.flatMap((s) => s.assessments.map((a) => ({ ...a, scenarioName: s.name, mix: s.energyMix as unknown as EnergyMix }))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  const sources = (site.sources as Array<{ title: string; url: string }>) ?? [];
  const profileSources = (profile.sources as Array<{ title: string; url: string }>) ?? [];
  const alts = (latest?.alternatives as Array<{ name: string; viable: boolean; composite: number; economic: number; environment: number; community: number; paybackYears: number | null; irr: number | null; co2TonnesYr: number; energyMix: EnergyMix }>) ?? [];
  const plan = latest?.plan as (SiteSpec & { energyMix: EnergyMix; summary: string; phasing: string[]; communityMeasures: string[]; estimate?: { composite: number; economic: number; environment: number; community: number; monthsToLive: number; paybackYears: number | null; viable: boolean } }) | null | undefined;

  return (
    <div className="flex flex-col gap-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 mb-1"><StatusPill status={site.status} /><VerdictPill verdict={latest?.verdict} /><span className={`pill ${profile.enrichedBy ? "pill-go" : ""}`}>{profile.enrichedBy ? "profile sourced" : "profile from priors"}</span>{site.curated && <span className="pill">curated</span>}{profile.measuredBy && <span className="pill pill-plan">measured by {profile.measuredBy}</span>}</div>
          <h1 className="text-2xl font-semibold">{site.name}</h1>
          <div className="text-sm text-slate-2 mt-1">{site.operator ?? "Operator unknown"} · {[site.city, site.region, site.country].filter(Boolean).join(", ")} · {site.capacityMw ? `${num(site.capacityMw)} MW` : "capacity unknown"}{site.expectedOnline ? ` · online ${site.expectedOnline}` : ""}{site.announcedAt ? ` · announced ${dateShort(site.announcedAt)}` : ""}</div>
          {site.description && <p className="text-sm mt-2 leading-relaxed">{site.description}</p>}
          {site.energyNotes && <p className="text-xs text-slate-2 mt-1">Supply as reported: {site.energyNotes}</p>}
          {sources.length > 0 && <div className="text-xs mt-2 flex flex-wrap gap-x-3 gap-y-1">{sources.slice(0, 6).map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.title}</a>)}</div>}
        </div>
        <div className="flex flex-col gap-2 items-end">
          <Link href={`/?site=${id}`} className="btn">Open in the simulation</Link>
          <RunButton endpoint="/api/agents/enrich" body={{ siteId: id }} label="Enrich profile from the web" />
          <RunButton endpoint="/api/agents/assess" body={{ scenarioId: baseline.id }} label="Assess baseline" primary />
        </div>
      </div>

      <div className="grid lg:grid-cols-[1fr_300px_300px] gap-4 items-stretch">
        {(() => { const v = latest?.verdict; const conds = (latest?.conditions as string[] | undefined) ?? []; const firstSentence = (latest?.rationale ?? "").split(/(?<=\.)\s/)[0]; return (
          <Lead tone={v === "GO" ? "accent" : v === "NO_GO" ? "violet" : "amber"} eyebrow={latest ? `Advisor's verdict · ${dateShort(latest.createdAt)} · ${latest.model}` : "Advisor's verdict"}
            title={v === "GO" ? "Go" : v === "CONDITIONAL" ? "Conditional go" : v === "NO_GO" ? "No go" : "Not assessed yet"}
            note={latest ? (v === "CONDITIONAL" && conds[0] ? <>On one condition: {conds[0]}{conds.length > 1 ? ` (+${conds.length - 1} more below)` : ""}</> : firstSentence) : "Press Assess baseline to have the advisor search energy mixes, fix a verdict against the viability floors and write the plan."}
            stats={[{ l: "Composite", v: num(base.scores.composite) }, { l: "Payback", v: years(base.operations.paybackYears) }, { l: "Live in", v: `${num(base.build.monthsToLive)} mo` }]} />
        ); })()}
        <SiteGlyph siteId={id} racks={base.facility.racks} facilityMw={base.facility.facilityMw} live={site.status === "OPERATIONAL"} />
        <ConceptRender siteId={id} initialImage={site.conceptImage} initialPrompt={site.conceptPrompt} />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3">
        <Kpi label="Build cost" value={moneyRound(base.build.capexUsd)} />
        <Kpi label="Months to live" value={num(base.build.monthsToLive)} sub={`gated by ${base.build.criticalPath}`} />
        <Kpi label="EBITDA / yr" value={moneyRound(base.operations.ebitdaUsdYr)} tone={base.operations.ebitdaUsdYr > 0 ? "good" : "bad"} />
        <Kpi label="Payback" value={years(base.operations.paybackYears)} tone={(base.operations.paybackYears ?? 99) <= 7 ? "good" : "warn"} />
        <Kpi label="IRR" value={pct(base.operations.irr, 1)} />
        <Kpi label="CO₂ / yr" value={`${num(base.environment.co2TonnesYr / 1000)} kt`} sub={`${num(base.environment.carbonIntensityG)} g/kWh`} />
        <Kpi label="Jobs" value={`${num(base.build.constructionJobs)} / ${num(base.operations.permanentJobs)}`} sub="build / permanent" />
        <Kpi label="Composite" value={num(base.scores.composite)} sub={`E ${base.scores.economic} · Env ${base.scores.environment} · C ${base.scores.community}`} tone={base.scores.composite >= 60 ? "good" : base.scores.composite >= 45 ? "warn" : "bad"} />
      </div>

      <section>
        <SectionTitle>What the satellite shows <span className="pill ml-2">SAM 3.1</span></SectionTitle>
        <div className="card p-4"><SiteMeasure siteId={site.id} capacityMw={site.capacityMw} stored={(profile.measuredLayers as unknown as StoredLayers | null) ?? null} measured={profile.measuredBy ? { builtHa: profile.measuredBuiltHa ?? 0, openHa: profile.measuredOpenHa ?? 0, waterHa: profile.measuredWaterHa ?? 0, waterNearM: profile.measuredWaterNearM ?? null, solarHa: profile.measuredSolarHa ?? 0, spanM: profile.measuredSpanM ?? 1400, by: profile.measuredBy, at: profile.measuredAt?.toISOString() ?? null } : null} /></div>
      </section>

      {latest && (
        <section className="card p-5 border-l-4" style={{ borderLeftColor: latest.verdict === "GO" ? "#059669" : latest.verdict === "CONDITIONAL" ? "#d97706" : "#dc2626" }}>
          <div className="flex flex-wrap items-center gap-2 mb-2"><VerdictPill verdict={latest.verdict} /><span className="text-xs text-slate-2">on “{latest.scenarioName}” ({mixLabel(latest.mix)}) · {dateShort(latest.createdAt)} · {latest.model}</span></div>
          <p className="text-[15px] leading-relaxed max-w-4xl">{latest.rationale}</p>
          <div className="grid md:grid-cols-3 gap-4 mt-4">
            <div><div className="eyebrow mb-1">Conditions</div>{(latest.conditions as string[]).length ? <ul className="text-sm list-disc pl-4 space-y-1">{(latest.conditions as string[]).map((c) => <li key={c}>{c}</li>)}</ul> : <div className="text-sm text-slate-2">None.</div>}</div>
            <div><div className="eyebrow mb-1">Risks</div><ul className="text-sm list-disc pl-4 space-y-1">{(latest.risks as string[]).map((c) => <li key={c}>{c}</li>)}</ul></div>
            <div><div className="eyebrow mb-1">Scores</div><div className="space-y-1.5"><Score value={latest.economic} label="economic" /><Score value={latest.environment} label="environment" /><Score value={latest.community} label="community" /></div></div>
          </div>
          <div className="grid md:grid-cols-3 gap-4 mt-4 text-sm">
            {(["executive", "policy", "investor"] as const).map((p) => <div key={p} className="rounded bg-paper p-3"><div className="eyebrow mb-1">For the {p === "policy" ? "policy maker" : p}</div>{(latest.personas as Record<string, string>)[p]}</div>)}
          </div>
          {plan && (
            <div className="mt-5 rounded-lg border border-line bg-panel-2 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div><div className="eyebrow">How to build it so the verdict holds</div><div className="text-sm text-slate-2 mt-0.5">{plan.summary}</div></div>
                <div className="flex gap-2"><Link href={`/?site=${id}&plan=${latest.id}`} className="btn btn-primary">Play this plan in the simulation</Link></div>
              </div>
              <div className="grid md:grid-cols-[1fr_1fr_1fr] gap-4 text-sm">
                <div>
                  <div className="eyebrow mb-1">Configuration</div>
                  <table className="table"><tbody>
                    <tr><td className="text-slate-2">Supply mix</td><td className="r">{mixLabel(plan.energyMix)}</td></tr>
                    <tr><td className="text-slate-2">IT load</td><td className="r">{num(plan.itMw)} MW</td></tr>
                    <tr><td className="text-slate-2">Hardware</td><td className="r">{plan.gpu.toUpperCase()} · {plan.densityKw} kW racks</td></tr>
                    <tr><td className="text-slate-2">Crew · automation</td><td className="r">{num(plan.crew)} · {Math.round(plan.robots * 100)}%</td></tr>
                    {plan.estimate && <><tr><td className="text-slate-2">Plan scores</td><td className="r">{plan.estimate.composite} · E {plan.estimate.economic} · Env {plan.estimate.environment} · C {plan.estimate.community}</td></tr><tr><td className="text-slate-2">Live in · payback</td><td className="r">{plan.estimate.monthsToLive} mo · {years(plan.estimate.paybackYears)}</td></tr><tr><td className="text-slate-2">Clears the floors</td><td className="r">{plan.estimate.viable ? <span className="pill pill-go">yes</span> : <span className="pill pill-nogo">no</span>}</td></tr></>}
                  </tbody></table>
                </div>
                <div><div className="eyebrow mb-1">Phasing</div><ol className="list-decimal pl-4 space-y-1">{plan.phasing.map((p) => <li key={p}>{p}</li>)}</ol></div>
                <div><div className="eyebrow mb-1">Community commitments</div><ul className="list-disc pl-4 space-y-1">{plan.communityMeasures.map((p) => <li key={p}>{p}</li>)}</ul></div>
              </div>
            </div>
          )}
          {alts.length > 0 && (
            <div className="mt-5 grid lg:grid-cols-[1fr_1fr] gap-5">
              <div><div className="eyebrow mb-1">Energy mixes the advisor searched</div><AlternativesChart alternatives={alts} /></div>
              <div className="overflow-x-auto"><table className="table"><thead><tr><th>Mix</th><th>Viable</th><th className="r">Score</th><th className="r">Payback</th><th className="r">IRR</th><th className="r">CO₂ kt/yr</th></tr></thead><tbody>
                {alts.map((a) => <tr key={a.name}><td>{a.name}<div className="text-[11px] text-slate-2">{mixLabel(a.energyMix)}</div></td><td>{a.viable ? <span className="pill pill-go">yes</span> : <span className="pill pill-nogo">no</span>}</td><td className="r">{a.composite}</td><td className="r">{years(a.paybackYears)}</td><td className="r">{pct(a.irr, 0)}</td><td className="r">{num(a.co2TonnesYr / 1000)}</td></tr>)}
              </tbody></table></div>
            </div>
          )}
        </section>
      )}

      <section>
        <SectionTitle>Energy what-if</SectionTitle>
        <EnergyMixer siteId={id} initialSpec={baseline.spec as unknown as SiteSpec} initialMix={baseline.energyMix as unknown as EnergyMix} baseline={base} geothermalAvailable={profile.geothermal} />
      </section>


      <section className="grid lg:grid-cols-[1fr_1fr] gap-5">
        <div className="card p-4">
          <SectionTitle>Region profile {profile.enrichedBy ? <span className="pill pill-go ml-2">sourced</span> : <span className="pill ml-2">country priors</span>}</SectionTitle>
          <table className="table"><tbody>
            {([
              ["Industrial power", `$${profile.powerPriceKwh.toFixed(3)}/kWh`], ["Grid carbon", `${num(profile.gridCarbonG)} g/kWh`], ["Interconnect lead", `${num(profile.gridLeadMonths)} months`], ["Grid headroom", `${num(profile.gridHeadroomMw)} MW`], ["Grid reliability", pct(profile.gridReliability)],
              ["Construction trades", `${num(profile.laborPool)} @ $${profile.wageUsdH}/h`], ["Land index", `${profile.landIndex.toFixed(2)}×`], ["Sentiment", `${num(profile.sentiment)} / 100`], ["Climate · water", `${profile.climate} · ${profile.waterStress} stress`], ["Solar · wind", `${profile.solar.toFixed(2)} · ${profile.wind.toFixed(2)}`], ["Geothermal · flare gas", `${profile.geothermal ? "yes" : "no"} · ${profile.flareGas ? "yes" : "no"}`], ["People within 5 km", profile.populationNear ? num(profile.populationNear) : "unknown"],
            ] as const).map(([k, v]) => <tr key={k}><td className="text-slate-2">{k}</td><td className="r">{v}</td></tr>)}
          </tbody></table>
          {profile.measuredBy && (
            <table className="table mt-3"><thead><tr><th>Measured by {profile.measuredBy} <span className="pill pill-go ml-1">measured</span></th><th className="r">replaces</th></tr></thead><tbody>
              <tr><td className="text-slate-2">Open, buildable land: <b className="text-slate-1">{num(profile.measuredOpenHa ?? 0)} ha</b></td><td className="r">land index {profile.landIndex.toFixed(2)}× prior</td></tr>
              <tr><td className="text-slate-2">Surface water: <b className="text-slate-1">{num(profile.measuredWaterHa ?? 0)} ha{profile.measuredWaterNearM != null ? `, ${num(profile.measuredWaterNearM)} m away` : ""}</b></td><td className="r">{profile.waterStress} water stress prior</td></tr>
              <tr><td className="text-slate-2">Existing solar arrays: <b className="text-slate-1">{num(profile.measuredSolarHa ?? 0)} ha</b></td><td className="r">solar resource {profile.solar.toFixed(2)} prior</td></tr>
              <tr><td className="text-slate-2">Built footprint: <b className="text-slate-1">{num(profile.measuredBuiltHa ?? 0)} ha</b></td><td className="r">{site.capacityMw ? `${num(site.capacityMw)} MW reported` : "capacity unknown"}</td></tr>
            </tbody></table>
          )}
          {profileSources.length > 0 && <div className="text-xs mt-2 flex flex-wrap gap-x-3 gap-y-1">{profileSources.slice(0, 8).map((s) => <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{s.title}</a>)}</div>}
        </div>
        <div className="card p-4">
          <SectionTitle>Baseline build cost</SectionTitle>
          <CapexChart breakdown={base.build.capexBreakdown} />
          <div className="text-xs text-slate-2 mt-2">{base.assumptions.join(" · ")}</div>
        </div>
      </section>

      <section className="grid lg:grid-cols-[1fr_1fr] gap-5">
        <div className="card">
          <div className="px-4 py-3 border-b border-line"><SectionTitle>Scenarios</SectionTitle></div>
          <table className="table"><thead><tr><th>Name</th><th>Mix</th><th className="r">Score</th><th className="r">Payback</th><th>Verdict</th><th></th></tr></thead><tbody>
            {scenarios.map((s) => { const e = s.estimate as unknown as EstimateResult; const a = s.assessments[0]; return (
              <tr key={s.id}><td>{s.name}{s.isBaseline && <span className="pill ml-1">baseline</span>}</td><td className="text-[12px]">{mixLabel(s.energyMix as unknown as EnergyMix)}</td><td className="r">{e.scores.composite}</td><td className="r">{years(e.operations.paybackYears)}</td><td><VerdictPill verdict={a?.verdict} /></td><td><RunButton endpoint="/api/agents/assess" body={{ scenarioId: s.id }} label={a ? "Re-assess" : "Assess"} /></td></tr>
            ); })}
          </tbody></table>
        </div>
        <div><SiteMapLoader sites={[{ id: site.id, name: site.name, operator: site.operator, lat: site.lat, lon: site.lon, status: site.status, capacityMw: site.capacityMw, country: site.country }]} center={[site.lat, site.lon]} zoom={7} height={320} /></div>
      </section>
    </div>
  );
}
