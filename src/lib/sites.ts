import type { Prisma, Site } from "@prisma/client";
import { prisma } from "./db";
import { priorFor } from "./model/regions";
import { estimate } from "./model/estimate";
import { normalizeMix } from "./model/energy";
import type { EnergyMix, RegionFactors, SiteSpec } from "./model/types";

export function profileToFactors(p: { powerPriceKwh: number; gridCarbonG: number; gridLeadMonths: number; gridHeadroomMw: number; gridReliability: number; laborPool: number; wageUsdH: number; landIndex: number; sentiment: number; climate: string; waterStress: string; solar: number; wind: number; geothermal: boolean; flareGas: boolean; populationNear: number | null }): RegionFactors {
  return { ...p, climate: p.climate as RegionFactors["climate"], waterStress: p.waterStress as RegionFactors["waterStress"] };
}

/** Infer a plausible energy mix from free-text supply notes. */
export function mixFromNotes(notes: string | null | undefined): EnergyMix {
  const n = (notes ?? "").toLowerCase();
  const mix: Partial<EnergyMix> = {};
  if (/solar/.test(n)) mix.solar = 0.35;
  if (/wind/.test(n)) mix.wind = 0.3;
  if (/nuclear|smr|reactor/.test(n)) mix.nuclear = 0.5;
  if (/geothermal/.test(n)) mix.geothermal = 0.5;
  if (/hydro/.test(n)) mix.hydro = 0.5;
  if (/gas|turbine|flare/.test(n)) mix.gas = 0.6;
  const sum = Object.values(mix).reduce((a, b) => a + b, 0);
  mix.grid = Math.max(0.2, 1 - sum);
  return normalizeMix(mix);
}

export function defaultSpec(capacityMw: number | null | undefined, itMw?: number | null): SiteSpec {
  const it = itMw ?? (capacityMw ? capacityMw / 1.25 : 100);
  return { itMw: Math.max(5, Math.round(it)), gpu: "b200", densityKw: 80, crew: Math.round(Math.min(2500, Math.max(150, it * 6))), robots: 0.2 };
}

export async function ensureProfile(site: Site) {
  const existing = await prisma.regionProfile.findUnique({ where: { siteId: site.id } });
  if (existing) return existing;
  const prior = priorFor(site.country, site.region, site.lat);
  return prisma.regionProfile.create({ data: { siteId: site.id, ...prior, sources: [] } });
}

export async function ensureBaseline(site: Site) {
  const existing = await prisma.scenario.findFirst({ where: { siteId: site.id, isBaseline: true } });
  if (existing) return existing;
  const profile = await ensureProfile(site);
  const spec = defaultSpec(site.capacityMw, site.itMw);
  const energyMix = mixFromNotes(site.energyNotes);
  const result = estimate(spec, profileToFactors(profile), energyMix);
  return prisma.scenario.create({
    data: { siteId: site.id, name: "Baseline as reported", spec: spec as unknown as Prisma.InputJsonValue, energyMix: energyMix as unknown as Prisma.InputJsonValue, estimate: result as unknown as Prisma.InputJsonValue, isBaseline: true },
  });
}

/** Re-run the estimate for every scenario of a site, used after the profile changes. */
export async function reestimateSite(siteId: string) {
  const profile = await prisma.regionProfile.findUnique({ where: { siteId } });
  if (!profile) return;
  const scenarios = await prisma.scenario.findMany({ where: { siteId } });
  for (const s of scenarios) {
    const result = estimate(s.spec as unknown as SiteSpec, profileToFactors(profile), s.energyMix as unknown as EnergyMix);
    await prisma.scenario.update({ where: { id: s.id }, data: { estimate: result as unknown as Prisma.InputJsonValue } });
  }
}
