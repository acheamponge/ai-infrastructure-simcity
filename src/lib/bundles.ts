// Serializable per-site bundles for client-side recomputation: everything the engine needs.
import { prisma } from "./db";
import { profileToFactors } from "./sites";
import type { EnergyMix, RegionFactors, SiteSpec } from "./model/types";

export interface SiteBundle {
  id: string; name: string; operator: string | null; country: string; region: string | null; city: string | null; lat: number; lon: number; status: string;
  capacityMw: number | null; enriched: boolean; verdict: string | null; assessmentId: string | null;
  spec: SiteSpec; mix: EnergyMix; factors: RegionFactors;
  planSpec: SiteSpec | null; planMix: EnergyMix | null;
}

export async function siteBundles(): Promise<SiteBundle[]> {
  const sites = await prisma.site.findMany({
    orderBy: [{ status: "asc" }, { capacityMw: "desc" }],
    include: { profile: true, scenarios: { where: { isBaseline: true }, include: { assessments: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  return sites.filter((s) => s.profile && s.scenarios[0]).map((s) => {
    const base = s.scenarios[0];
    const a = base.assessments[0];
    const plan = a?.plan as (SiteSpec & { energyMix: EnergyMix }) | null | undefined;
    return {
      id: s.id, name: s.name, operator: s.operator, country: s.country, region: s.region, city: s.city, lat: s.lat, lon: s.lon, status: s.status,
      capacityMw: s.capacityMw, enriched: !!s.profile!.enrichedBy, verdict: a?.verdict ?? null, assessmentId: a?.id ?? null,
      spec: base.spec as unknown as SiteSpec, mix: base.energyMix as unknown as EnergyMix, factors: profileToFactors(s.profile!),
      planSpec: plan ? { itMw: plan.itMw, gpu: plan.gpu, densityKw: plan.densityKw, crew: plan.crew, robots: plan.robots } : null,
      planMix: plan?.energyMix ?? null,
    };
  });
}
