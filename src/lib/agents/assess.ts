import type { Prisma, Verdict } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { structured } from "../llm/client";
import { startRun } from "./runs";
import { AdvisorOutput, type AdvisorOutputT, type BuildPlanT } from "./schemas";
import { fixtureAdvisor } from "./fixtures";
import { isViable, searchMixes, VIABILITY } from "../model/optimize";
import { mixLabel, normalizeMix } from "../model/energy";
import { estimate } from "../model/estimate";
import { profileToFactors } from "../sites";
import type { EnergyMix, EstimateResult, RegionFactors, SiteSpec } from "../model/types";

const LIVE = () => env.agentMode === "live";

const SYSTEM = `You advise executives, government officials and investors on whether a specific AI data center should be built, and how. You are given the engine's estimate for the proposal, the alternatives it searched, the deterministic verdict and the floors applied, and a draft build plan. Write numbers the way an analyst says them: whole percentages (12% IRR, not 0.1218), money in $M or $B, emissions in kt or Mt, and never paste raw decimals from the brief. Explain the verdict plainly, name the conditions that would change it, state the risks honestly, write one short paragraph per audience, and refine the build plan so that it is concrete: supply mix, hardware, crew and automation, phasing, and the community commitments that keep the community score above its floor. Do not change the verdict. Do not invent numbers that are not in the inputs. Keep the plan's energy mix within the alternatives that were shown to be viable when any exist.`;

/** Rounds every number in a brief so the advisory reads like an analyst wrote it: 3 significant digits below 100, whole numbers above. */
function roundDeep<T>(v: T): T {
  if (typeof v === "number") return (!isFinite(v) ? v : Math.abs(v) >= 100 ? Math.round(v) : +v.toPrecision(3)) as T;
  if (Array.isArray(v)) return v.map(roundDeep) as T;
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, roundDeep(x)])) as T;
  return v;
}

/** Deterministic gate. The model explains it but never overrides it. */
export function gate(e: EstimateResult, alternatives: ReturnType<typeof searchMixes>): { verdict: Verdict; bestAlt: ReturnType<typeof searchMixes>[number] | null } {
  const viable = isViable(e);
  const bestAlt = alternatives.find((a) => a.viable && !a.name.startsWith("As proposed")) ?? null;
  if (viable && e.scores.composite >= 60) return { verdict: "GO", bestAlt };
  if (viable || bestAlt) return { verdict: "CONDITIONAL", bestAlt };
  return { verdict: "NO_GO", bestAlt: null };
}

/** Draft plan from the engine: the proposal if viable, else the best viable alternative, else the top-ranked mix. */
export function draftPlan(spec: SiteSpec, mix: EnergyMix, e: EstimateResult, alternatives: ReturnType<typeof searchMixes>, r: RegionFactors): BuildPlanT {
  const chosen = isViable(e) ? { name: "as proposed", energyMix: mix, estimate: e } : alternatives[0];
  const robots = r.laborPool < spec.crew * 0.8 ? Math.min(0.6, spec.robots + 0.25) : spec.robots;
  const est = robots !== spec.robots ? estimate({ ...spec, robots }, r, chosen.energyMix) : chosen.estimate;
  const phases = Math.max(1, Math.ceil(est.facility.facilityMw / 150));
  return {
    summary: `Build ${est.facility.facilityMw.toFixed(0)} MW on ${mixLabel(chosen.energyMix)} in ${phases} phase${phases > 1 ? "s" : ""}; first power in about ${est.build.monthsToLive} months, gated by ${est.build.criticalPath}.`,
    energyMix: chosen.energyMix, itMw: spec.itMw, gpu: spec.gpu, densityKw: spec.densityKw, crew: spec.crew, robots,
    phasing: [
      "Permitting and community agreement before land close",
      chosen.energyMix.grid >= 0.5 ? "Interconnection agreement signed before civil works" : "On-site supply procurement in parallel with civil works",
      ...Array.from({ length: phases }, (_, i) => `Phase ${i + 1}: ${Math.round(est.facility.facilityMw / phases)} MW hall, racks energized as supply lands`),
    ],
    communityMeasures: [
      robots > 0.4 ? "Local hiring target for the non-automated trades" : "Local-first hiring for construction trades",
      est.environment.waterStressFlag ? "Closed-loop liquid cooling with no evaporative water draw" : "Heat reuse or water offset agreement with the municipality",
      "Published noise and traffic limits with a community liaison",
    ],
  };
}

export async function runAssessment(scenarioId: string) {
  const scenario = await prisma.scenario.findUniqueOrThrow({ where: { id: scenarioId }, include: { site: { include: { profile: true } } } });
  const run = await startRun("ASSESS", { scenarioId, site: scenario.site.name, scenario: scenario.name }, LIVE() ? (env.llmProvider === "meta" ? env.meta.modelAdvisor : env.modelAdvisor) : "fixture");
  try {
    const profile = scenario.site.profile ?? (await prisma.regionProfile.findUniqueOrThrow({ where: { siteId: scenario.siteId } }));
    const r = profileToFactors(profile);
    const spec = scenario.spec as unknown as SiteSpec;
    const mix = scenario.energyMix as unknown as EnergyMix;
    const e = scenario.estimate as unknown as EstimateResult;
    const alternatives = searchMixes(spec, r, mix);
    const { verdict, bestAlt } = gate(e, alternatives);
    const draft = draftPlan(spec, mix, e, alternatives, r);
    await run.log(`gate: ${verdict}; ${alternatives.filter((a) => a.viable).length} of ${alternatives.length} mixes viable`);

    let out: AdvisorOutputT;
    const usage = { model: "", tokensIn: 0, tokensOut: 0 };
    if (!LIVE()) {
      out = fixtureAdvisor({ verdict, siteName: scenario.site.name, composite: e.scores.composite, bestAlt: bestAlt?.name ?? null, flags: e.flags, plan: draft });
    } else {
      const brief = {
        site: { name: scenario.site.name, operator: scenario.site.operator, location: [scenario.site.city, scenario.site.region, scenario.site.country].filter(Boolean).join(", "), status: scenario.site.status, description: scenario.site.description },
        proposal: { spec, energyMix: mixLabel(mix), estimate: e },
        floors: VIABILITY,
        verdict,
        draftPlan: draft,
        alternatives: alternatives.map((a) => ({ name: a.name, mix: a.energyMix, viable: a.viable, composite: a.estimate.scores.composite, economic: a.estimate.scores.economic, environment: a.estimate.scores.environment, community: a.estimate.scores.community, paybackYears: a.estimate.operations.paybackYears, irr: a.estimate.operations.irr, co2TonnesYr: a.estimate.environment.co2TonnesYr, flags: a.estimate.flags })),
        // numbers only: never the source list, the stored satellite imagery or any other large blob
        profile: Object.fromEntries(Object.entries(profile).filter(([k, v]) => k !== "sources" && k !== "measuredLayers" && !(typeof v === "string" && v.length > 2000))),
      };
      await run.log(`verdict fixed by the engine; asking ${env.llmProvider === "meta" ? env.meta.modelAdvisor : env.modelAdvisor} for the rationale, conditions and plan (research ran on ${env.llmProvider === "meta" ? env.meta.modelResearch : env.modelResearch})`);
      const x = await structured("advisor", AdvisorOutput, SYSTEM, `Write the advisory for this brief.\n\n${JSON.stringify(roundDeep(brief), null, 1)}`, { maxTokens: 6000 });
      await run.log(`advisory written by ${x.usage.model} in ${x.usage.tokensOut} output tokens, ${x.usage.attempts} attempt(s); brief ${JSON.stringify(brief).length} chars; usage ${JSON.stringify(x.usage.raw)}`);
      usage.model = x.usage.model; usage.tokensIn = x.usage.tokensIn; usage.tokensOut = x.usage.tokensOut;
      out = x.data;
      out.plan.energyMix = normalizeMix(out.plan.energyMix);
      await run.log(`narrative and plan written by ${x.usage.model}`);
    }
    const planEstimate = estimate({ itMw: out.plan.itMw, gpu: out.plan.gpu, densityKw: out.plan.densityKw, crew: out.plan.crew, robots: out.plan.robots }, r, out.plan.energyMix);

    const assessment = await prisma.assessment.create({
      data: {
        scenarioId, verdict, score: e.scores.composite, economic: e.scores.economic, environment: e.scores.environment, community: e.scores.community,
        rationale: out.rationale, conditions: out.conditions, risks: out.risks, personas: out.personas,
        plan: { ...out.plan, estimate: { composite: planEstimate.scores.composite, economic: planEstimate.scores.economic, environment: planEstimate.scores.environment, community: planEstimate.scores.community, monthsToLive: planEstimate.build.monthsToLive, capexUsd: planEstimate.build.capexUsd, paybackYears: planEstimate.operations.paybackYears, irr: planEstimate.operations.irr, co2TonnesYr: planEstimate.environment.co2TonnesYr, viable: isViable(planEstimate) } } as unknown as Prisma.InputJsonValue,
        alternatives: alternatives.map((a) => ({ name: a.name, energyMix: a.energyMix, viable: a.viable, composite: a.estimate.scores.composite, economic: a.estimate.scores.economic, environment: a.estimate.scores.environment, community: a.estimate.scores.community, paybackYears: a.estimate.operations.paybackYears, irr: a.estimate.operations.irr, co2TonnesYr: a.estimate.environment.co2TonnesYr })) as unknown as Prisma.InputJsonValue,
        model: LIVE() ? usage.model || (env.llmProvider === "meta" ? env.meta.modelAdvisor : env.modelAdvisor) : "deterministic gate (fixture narrative)", runId: run.id,
      },
    });
    await run.succeed({ assessmentId: assessment.id, verdict, planViable: isViable(planEstimate) } as unknown as Prisma.InputJsonValue, usage);
    return assessment;
  } catch (err) {
    await run.fail(err);
    throw err;
  }
}
