import { prisma } from "@/lib/db";
import { Simulation, type SimFocus } from "@/components/simulation";
import { PlannerChat } from "@/components/planner-chat";
import { Tour } from "@/components/tour";
import { toSimCfg, toSimRegion } from "@/lib/sim-bridge";
import type { EnergyMix, SiteSpec } from "@/lib/model/types";

export const dynamic = "force-dynamic";

/** The simulation is the front door. Every tracked site is on the globe and can be built; a plan link pre-configures it. */
export default async function Home({ searchParams }: { searchParams: Promise<{ site?: string; plan?: string; build?: string }> }) {
  const sp = await searchParams;
  const sites = await prisma.site.findMany({ include: { profile: true, scenarios: { where: { isBaseline: true } } } });
  const realSites = sites.filter((s) => s.profile && s.scenarios[0]).map((s) => toSimRegion(s, s.profile!, s.scenarios[0]));
  let focus: SimFocus | undefined;
  if (sp.site) {
    const s = sites.find((x) => x.id === sp.site);
    if (s && s.profile) {
      focus = { regionId: `site:${s.id}`, autoBreakGround: sp.build === "1" };
      if (sp.plan) {
        const a = await prisma.assessment.findUnique({ where: { id: sp.plan } });
        const plan = a?.plan as (SiteSpec & { energyMix: EnergyMix; summary?: string }) | null;
        if (plan) {
          focus.cfg = toSimCfg({ itMw: plan.itMw, gpu: plan.gpu, densityKw: plan.densityKw, crew: plan.crew, robots: plan.robots }, plan.energyMix, s.profile.flareGas).cfg;
          focus.label = `Playing the advisor's ${a?.verdict.replace("_", " ").toLowerCase()} plan for ${s.name}: ${plan.summary ?? ""}`;
          focus.autoBreakGround = sp.build !== "0";
        }
      }
    }
  }
  return (
    <>
      <Simulation key={`${sp.site ?? ""}:${sp.plan ?? ""}`} realSites={realSites} focus={focus} />
      <PlannerChat />
      <Tour />
    </>
  );
}
