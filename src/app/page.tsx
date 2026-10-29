import { prisma } from "@/lib/db";
import { Simulation, type SimFocus } from "@/components/simulation";
import { PlannerChat } from "@/components/planner-chat";
import { Tour } from "@/components/tour";
import { toSimCfg, toSimRegion } from "@/lib/sim-bridge";
import type { EnergyMix, SiteSpec } from "@/lib/model/types";

export const dynamic = "force-dynamic";

/** The simulation is the front door. Every tracked site is on the globe and can be built; a plan link pre-configures it. */
export default async function Home({ searchParams }: { searchParams: Promise<{ site?: string; plan?: string; build?: string; focus?: string }> }) {
  const sp = await searchParams;
  const sites = await prisma.site.findMany({ include: { profile: true, scenarios: { where: { isBaseline: true }, include: { assessments: { orderBy: { createdAt: "desc" }, take: 1, select: { verdict: true } } } } } });
  const realSites = sites.filter((s) => s.profile && s.scenarios[0]).map((s) => toSimRegion(s, s.profile!, s.scenarios[0]));
  let focus: SimFocus | undefined;
  if (sp.focus) {
    // a shared planner plan: the focus object, base64url-encoded by the chat panel
    try { const f = JSON.parse(Buffer.from(sp.focus, "base64url").toString("utf8")) as SimFocus; if (f && typeof f.regionId === "string") focus = { regionId: f.regionId, cfg: f.cfg, label: typeof f.label === "string" ? f.label.slice(0, 300) : undefined, autoBreakGround: !!f.autoBreakGround }; } catch { /* ignore a malformed link */ }
  }
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
      <Simulation key={`${sp.site ?? ""}:${sp.plan ?? ""}:${sp.focus ? sp.focus.slice(0, 24) : ""}`} realSites={realSites} focus={focus} />
      <PlannerChat />
      <Tour />
    </>
  );
}
