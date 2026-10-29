// The planner: a conversational agent over the estimation engine. Muse Spark reads the user's request, looks up
// places (the simulation's modeled regions plus every tracked real site), runs estimates and energy-mix searches
// through our deterministic engine, optionally checks the web, and submits a build plan the simulation can play.
import { z } from "zod/v4";
import { prisma } from "../db";
import { env } from "../env";
import { chatWithTools, type ChatMessage, type ToolDef, type ToolStep } from "../llm/client";
import { estimate } from "../model/estimate";
import { normalizeMix, mixLabel, DEFAULT_MIX } from "../model/energy";
import { searchMixes } from "../model/optimize";
import { GPUS } from "../model/hardware";
import type { EnergyMix, EstimateResult, RegionFactors, SiteSpec, GpuClass } from "../model/types";
import { mixFromNotes, profileToFactors } from "../sites";
import { toSimCfg } from "../sim-bridge";
import { gate } from "./assess";
import { searchWeb } from "../search/web";
import { REGIONS } from "@/sim/regions";

export interface Place { id: string; name: string; country: string; lat: number; lon: number; kind: "region" | "site"; factors: RegionFactors; flare: boolean; mix: EnergyMix; status?: string; capacityMw?: number | null; operator?: string | null }

interface SimRegionRow { id: string; name: string; country: string; lat: number; lon: number; power: number; carbon: number; labor: number; wage: number; land: number; sent: number; climate: "hot" | "temperate" | "cold"; water: "low" | "med" | "high"; gridLead: number; gridRel: number; headroom: number; solar: number; wind: number; geo?: boolean; flare?: boolean }

function regionFactors(r: SimRegionRow): RegionFactors {
  return { powerPriceKwh: r.power, gridCarbonG: r.carbon, gridLeadMonths: r.gridLead, gridHeadroomMw: r.headroom, gridReliability: r.gridRel, laborPool: r.labor, wageUsdH: r.wage, landIndex: r.land, sentiment: r.sent, climate: r.climate, waterStress: r.water === "med" ? "medium" : r.water, solar: r.solar, wind: r.wind, geothermal: !!r.geo, flareGas: !!r.flare, populationNear: null };
}

export async function loadPlaces(): Promise<Place[]> {
  const regions = (REGIONS as SimRegionRow[]).map<Place>((r) => ({ id: r.id, name: r.name, country: r.country, lat: r.lat, lon: r.lon, kind: "region", factors: regionFactors(r), flare: !!r.flare, mix: DEFAULT_MIX }));
  const sites = await prisma.site.findMany({ include: { profile: true, scenarios: { where: { isBaseline: true } } } });
  const real = sites.filter((s) => s.profile).map<Place>((s) => ({ id: `site:${s.id}`, name: s.name, country: s.country, lat: s.lat, lon: s.lon, kind: "site", factors: profileToFactors(s.profile!), flare: s.profile!.flareGas, mix: (s.scenarios[0]?.energyMix as EnergyMix | undefined) ?? mixFromNotes(s.energyNotes), status: s.status, capacityMw: s.capacityMw, operator: s.operator }));
  return [...regions, ...real];
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
function findPlaces(places: Place[], query: string, limit = 5): Place[] {
  const q = norm(query).split(/[^a-z0-9]+/).filter(Boolean);
  const scored = places.map((p) => { const hay = norm(`${p.name} ${p.country} ${p.operator ?? ""} ${p.id}`); let s = 0; for (const t of q) { if (hay === t) s += 5; else if (hay.split(/[^a-z0-9]+/).includes(t)) s += 3; else if (hay.includes(t)) s += 1; } return [s, p] as const; });
  return scored.filter(([s]) => s > 0).sort((a, b) => b[0] - a[0]).slice(0, limit).map(([, p]) => p);
}

const placeCard = (p: Place) => ({
  id: p.id, name: p.name, country: p.country, kind: p.kind, status: p.status, reportedCapacityMw: p.capacityMw, operator: p.operator,
  powerUsdKwh: p.factors.powerPriceKwh, gridCarbonG: p.factors.gridCarbonG, gridLeadMonths: p.factors.gridLeadMonths, gridHeadroomMw: p.factors.gridHeadroomMw, gridReliability: p.factors.gridReliability,
  laborPool: p.factors.laborPool, wageUsdH: p.factors.wageUsdH, landIndex: p.factors.landIndex, sentiment: p.factors.sentiment, climate: p.factors.climate, waterStress: p.factors.waterStress,
  solarResource: p.factors.solar, windResource: p.factors.wind, geothermal: p.factors.geothermal, flareGas: p.factors.flareGas, defaultMix: mixLabel(p.mix),
});

const compact = (e: EstimateResult) => ({
  facilityMw: Math.round(e.facility.facilityMw), pue: +e.facility.pue.toFixed(2), racks: e.facility.racks, gpus: e.facility.gpus, petaflops: Math.round(e.facility.petaflops),
  capexUsdB: +(e.build.capexUsd / 1e9).toFixed(2), monthsToLive: e.build.monthsToLive, criticalPath: e.build.criticalPath, constructionJobs: e.build.constructionJobs, laborShortfall: e.build.laborShortfall,
  revenueUsdMyr: Math.round(e.operations.revenueUsdYr / 1e6), ebitdaUsdMyr: Math.round(e.operations.ebitdaUsdYr / 1e6), paybackYears: e.operations.paybackYears, irr: e.operations.irr, utilization: +e.operations.utilization.toFixed(2), permanentJobs: e.operations.permanentJobs, blendedPowerUsdKwh: +e.operations.blendedPowerPriceKwh.toFixed(3),
  co2KtYr: Math.round(e.environment.co2TonnesYr / 1e3), carbonIntensityG: Math.round(e.environment.carbonIntensityG), waterStressFlag: e.environment.waterStressFlag, gridLoadShare: +e.environment.gridLoadShare.toFixed(2),
  prosperityIndex: Math.round(e.community.prosperityIndex), nuisanceScore: Math.round(e.community.nuisanceScore), scores: e.scores, flags: e.flags,
});

const GPU_IDS = Object.keys(GPUS) as GpuClass[];
const MixSchema = z.object({ grid: z.number().min(0).max(1).optional(), gas: z.number().min(0).max(1).optional(), solar: z.number().min(0).max(1).optional(), wind: z.number().min(0).max(1).optional(), nuclear: z.number().min(0).max(1).optional(), geothermal: z.number().min(0).max(1).optional(), hydro: z.number().min(0).max(1).optional() });
const SpecArgs = z.object({ placeId: z.string(), itMw: z.number().min(5).max(5000), gpu: z.enum(GPU_IDS as [GpuClass, ...GpuClass[]]).default("b200"), densityKw: z.union([z.literal(40), z.literal(80), z.literal(130)]).default(80), crew: z.number().min(100).max(5000).optional(), energyMix: MixSchema.optional() });
const PlanArgs = SpecArgs.extend({ title: z.string(), summary: z.string(), rationale: z.array(z.string()).min(1).max(6), risks: z.array(z.string()).max(6).default([]) });
export type PlannerPlan = z.infer<typeof PlanArgs> & { place: ReturnType<typeof placeCard>; estimate: ReturnType<typeof compact>; verdict: string; mixLabel: string; focus: { regionId: string; cfg: Record<string, unknown>; label: string; autoBreakGround: boolean }; dossierUrl: string | null };

const mixSchemaJson = { type: "object", description: "Shares of facility power by source, 0 to 1; they are normalized to sum to 1", properties: Object.fromEntries(["grid", "gas", "solar", "wind", "nuclear", "geothermal", "hydro"].map((k) => [k, { type: "number" }])) };
const specProps = {
  placeId: { type: "string", description: "A place id from find_place" },
  itMw: { type: "number", description: "IT load in MW (5 to 5000). Facility power is higher by the PUE." },
  gpu: { type: "string", enum: GPU_IDS, description: `GPU class. ${GPU_IDS.map((k) => `${k}: ${GPUS[k].label}, ${GPUS[k].watts} W`).join("; ")}. NVL72 classes (gb200, gb300, next) need densityKw 80 or 130.` },
  densityKw: { type: "integer", enum: [40, 80, 130], description: "Rack density: 40 air-cooled, 80 or 130 direct liquid" },
  crew: { type: "number", description: "Peak construction headcount, 100 to 5000. Omit to size automatically." },
  energyMix: mixSchemaJson,
};

export const PLANNER_TOOLS: ToolDef[] = [
  { type: "function", function: { name: "find_place", description: "Look up candidate places by name, country, operator or region. Returns up to five matches with their power price, grid carbon, interconnect lead time, labor pool, wage, land cost, sentiment, climate, water stress and renewable resources. Always call this first; estimates need a place id from it.", parameters: { type: "object", properties: { query: { type: "string", description: "Free text such as 'Québec', 'Texas', 'Norway hydro' or an operator name" } }, required: ["query"] } } },
  { type: "function", function: { name: "estimate_site", description: "Run the deterministic estimate for a facility spec at a place: capex, schedule, revenue, EBITDA, payback, IRR, CO2, water, grid load, jobs, prosperity, nuisance, composite scores and a go / conditional / no-go verdict. Cheap; call it as often as needed to compare options.", parameters: { type: "object", properties: specProps, required: ["placeId", "itMw"] } } },
  { type: "function", function: { name: "compare_energy_mixes", description: "Search alternative energy supply mixes for a spec at a place and return the best few by composite score with their capex, EBITDA, CO2 and whether they clear the viability floors. Use it whenever the user cares about carbon, cost of power or reliability.", parameters: { type: "object", properties: { placeId: specProps.placeId, itMw: specProps.itMw, gpu: specProps.gpu, densityKw: specProps.densityKw }, required: ["placeId", "itMw"] } } },
  { type: "function", function: { name: "web_search", description: "Search the web for recent facts about a place, operator, grid or policy when the question depends on current events. Returns titles, urls and snippets.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } } },
  { type: "function", function: { name: "submit_plan", description: "Record the final build plan once you have estimated it. This ends the planning turn; the user can then build it in the simulation.", parameters: { type: "object", properties: { ...specProps, title: { type: "string", description: "Short plan name, e.g. 'Québec 300 MW GB200 on hydro'" }, summary: { type: "string", description: "Two sentences: what and why" }, rationale: { type: "array", items: { type: "string" }, description: "Three to six bullet reasons, each citing a number from the estimate" }, risks: { type: "array", items: { type: "string" }, description: "Up to six risks or conditions" } }, required: ["placeId", "itMw", "title", "summary", "rationale"] } } },
];

const SYSTEM = `You are the planning agent inside AI Infrastructure SimCity, a simulator and planning platform for AI data centers. The user wants a facility planned somewhere on the globe. You have tools over a deterministic estimation engine; never invent numbers, take them from estimate_site and compare_energy_mixes.

Method: call find_place for every place the user names or implies (pick the best match, or compare a few when they ask "where"). Run estimate_site for the spec they describe; fill gaps with sensible defaults (b200 at 80 kW unless they ask for NVL72 racks, which need 80 or 130 kW). When the user mentions carbon, clean power, cost of power or reliability, also call compare_energy_mixes and prefer a viable mix with a higher composite score. Use web_search only when the question hinges on current events. Then call submit_plan once with the plan you recommend. Keep tool arguments realistic: itMw is IT load, facility power is higher.

Units: MW, $ (capex in billions, EBITDA in millions per year), kt CO2 per year, months. Scores are 0 to 100 with viability floors; the verdict comes from the engine. Be concise and concrete.`;

export interface PlannerEvent { type: "status" | "tool" | "final" | "error"; text?: string; name?: string; args?: Record<string, unknown>; summary?: string; reply?: string; plan?: PlannerPlan | null; model?: string; provider?: string; tokensIn?: number; tokensOut?: number }

/** Run one planning turn as a stream of events: tool steps as they happen, then the final reply and plan. */
export async function* plan(history: Array<{ role: "user" | "assistant"; content: string }>): AsyncGenerator<PlannerEvent> {
  const places = await loadPlaces();
  const byId = new Map(places.map((p) => [p.id, p]));
  let submitted: PlannerPlan | null = null;
  const queue: PlannerEvent[] = [];
  let notify: (() => void) | null = null;
  const push = (e: PlannerEvent) => { queue.push(e); notify?.(); };

  const specFor = (a: z.infer<typeof SpecArgs>, p: Place) => {
    const spec: SiteSpec = { itMw: a.itMw, gpu: a.gpu, densityKw: a.densityKw, crew: a.crew ?? Math.round(Math.min(2500, Math.max(150, a.itMw * 6))), robots: 0 };
    const mix = a.energyMix && Object.values(a.energyMix).some((v) => (v ?? 0) > 0) ? normalizeMix(a.energyMix as Partial<EnergyMix>) : p.mix;
    return { spec, mix };
  };

  const handler = async (name: string, raw: Record<string, unknown>) => {
    if (name === "find_place") {
      const hits = findPlaces(places, String(raw.query ?? ""));
      return { result: hits.length ? hits.map(placeCard) : { none: `No place matched "${raw.query}". Try a country or a nearby city; modeled regions include ${places.filter((p) => p.kind === "region").map((p) => p.name).join(", ")}.` }, summary: hits.length ? `found ${hits.map((h) => h.name).join(", ")}` : `no match for "${raw.query}"` };
    }
    if (name === "estimate_site" || name === "compare_energy_mixes" || name === "submit_plan") {
      const parsed = (name === "submit_plan" ? PlanArgs : SpecArgs).safeParse(raw);
      if (!parsed.success) return { result: { error: parsed.error.issues.slice(0, 4) }, summary: `${name}: invalid arguments` };
      const a = parsed.data; const p = byId.get(a.placeId);
      if (!p) return { result: { error: `unknown placeId ${a.placeId}; call find_place first` }, summary: `${name}: unknown place` };
      const { spec, mix } = specFor(a, p);
      if (name === "compare_energy_mixes") {
        const alts = searchMixes(spec, p.factors, mix).slice(0, 5).map((x) => ({ name: x.name, mix: x.energyMix, label: mixLabel(x.energyMix), viable: x.viable, composite: Math.round(x.estimate.scores.composite), capexUsdB: +(x.estimate.build.capexUsd / 1e9).toFixed(2), ebitdaUsdMyr: Math.round(x.estimate.operations.ebitdaUsdYr / 1e6), co2KtYr: Math.round(x.estimate.environment.co2TonnesYr / 1e3), monthsToLive: x.estimate.build.monthsToLive }));
        return { result: alts, summary: `compared ${alts.length} mixes at ${p.name}; best ${alts[0]?.label ?? "none"}` };
      }
      const e = estimate(spec, p.factors, mix); const alts = searchMixes(spec, p.factors, mix); const g = gate(e, alts);
      const result = { place: p.name, mix: mixLabel(mix), verdict: g.verdict, estimate: compact(e), betterMix: g.bestAlt ? { label: mixLabel(g.bestAlt.energyMix), composite: Math.round(g.bestAlt.estimate.scores.composite) } : null };
      if (name === "estimate_site") return { result, summary: `${p.name}: ${Math.round(e.facility.facilityMw)} MW, $${(e.build.capexUsd / 1e9).toFixed(1)}B, ${e.build.monthsToLive} mo, ${g.verdict.replace("_", " ").toLowerCase()}` };
      const pa = a as z.infer<typeof PlanArgs>;
      const { cfg } = toSimCfg(spec, mix, p.flare);
      submitted = { ...pa, place: placeCard(p), estimate: compact(e), verdict: g.verdict, mixLabel: mixLabel(mix), focus: { regionId: p.id, cfg, label: `Muse plan: ${pa.title}. ${pa.summary}`, autoBreakGround: false }, dossierUrl: p.kind === "site" ? `/sites/${p.id.slice(5)}` : null };
      return { result: { recorded: true, verdict: g.verdict }, summary: `plan recorded: ${pa.title} (${g.verdict.replace("_", " ").toLowerCase()})`, terminal: true };
    }
    if (name === "web_search") {
      if (!env.tavilyKey && !env.meta.key) return { result: { error: "web search is not configured" }, summary: "web search unavailable" };
      const r = await searchWeb(String(raw.query ?? ""), { maxResults: 4 });
      return { result: r.hits.map((h) => ({ title: h.title, url: h.url, snippet: h.content.slice(0, 300) })), summary: `searched "${raw.query}" via ${r.engine === "grounding" ? "Muse search grounding" : "Tavily"}: ${r.hits.length} results` };
    }
    return { result: { error: `unknown tool ${name}` }, summary: `unknown tool ${name}` };
  };

  const messages: ChatMessage[] = [{ role: "system", content: SYSTEM }, ...history.map((m) => ({ role: m.role, content: m.content }))];
  const work = chatWithTools("planner", messages, PLANNER_TOOLS, handler, { maxRounds: 8, reasoning: "low", onStep: (s: ToolStep) => push({ type: "tool", name: s.name, args: s.args, summary: s.summary }) })
    .then((r) => push({ type: "final", reply: r.text, plan: submitted, model: r.model, provider: r.provider, tokensIn: r.tokensIn, tokensOut: r.tokensOut }))
    .catch((e) => push({ type: "error", text: e instanceof Error ? e.message : String(e) }));

  yield { type: "status", text: `planning with ${env.llmProvider === "meta" ? env.meta.modelPlanner : env.modelAdvisor}` };
  let done = false;
  while (!done) {
    if (!queue.length) await new Promise<void>((r) => { notify = r; });
    notify = null;
    while (queue.length) { const e = queue.shift()!; if (e.type === "final" || e.type === "error") done = true; yield e; }
  }
  await work;
}
