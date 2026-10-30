import type { Prisma, Site } from "@prisma/client";
import { prisma } from "./db";
import { priorFor } from "./model/regions";
import { estimate } from "./model/estimate";
import { normalizeMix } from "./model/energy";
import type { EnergyMix, RegionFactors, SiteSpec } from "./model/types";

type ProfileLike = { powerPriceKwh: number; gridCarbonG: number; gridLeadMonths: number; gridHeadroomMw: number; gridReliability: number; laborPool: number; wageUsdH: number; landIndex: number; sentiment: number; climate: string; waterStress: string; solar: number; wind: number; geothermal: boolean; flareGas: boolean; populationNear: number | null; measuredBuiltHa?: number | null; measuredOpenHa?: number | null; measuredWaterHa?: number | null; measuredWaterNearM?: number | null; measuredSolarHa?: number | null; measuredSpanM?: number | null; measuredBy?: string | null };
export function profileToFactors(p: ProfileLike): RegionFactors {
  const measured = p.measuredBy && p.measuredOpenHa != null ? { builtHa: p.measuredBuiltHa ?? 0, openHa: p.measuredOpenHa, waterHa: p.measuredWaterHa ?? 0, waterNearM: p.measuredWaterNearM ?? null, solarHa: p.measuredSolarHa ?? 0, spanM: p.measuredSpanM ?? 1400, by: p.measuredBy } : null;
  return { powerPriceKwh: p.powerPriceKwh, gridCarbonG: p.gridCarbonG, gridLeadMonths: p.gridLeadMonths, gridHeadroomMw: p.gridHeadroomMw, gridReliability: p.gridReliability, laborPool: p.laborPool, wageUsdH: p.wageUsdH, landIndex: p.landIndex, sentiment: p.sentiment, climate: p.climate as RegionFactors["climate"], waterStress: p.waterStress as RegionFactors["waterStress"], solar: p.solar, wind: p.wind, geothermal: p.geothermal, flareGas: p.flareGas, populationNear: p.populationNear, measured };
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

// ---- discovery dedupe ----------------------------------------------------------------------------------------------
// A discovered record is the same facility as a tracked one when the names reduce to the same key in the same country,
// or when it sits within 25 km of a site by the same operator or with the same distinctive name words. Coordinates alone
// never merge two records, because discovery often reports a city's coordinates for several distinct campuses.
const GENERIC = new Set(["data", "center", "centre", "centers", "centres", "datacenter", "datacenters", "campus", "cluster", "ai", "project", "hyperscale", "facility", "site", "park", "tech", "technology", "the", "of", "and", "at", "in", "phase", "new", "region", "zone"]);
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const words = (s: string) => fold(s).replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter((w) => w && !GENERIC.has(w));
export const siteKey = (name: string) => words(name).sort().join(" ");
const operatorKey = (s: string) => fold(s).replace(/\b(inc|llc|ltd|corp|corporation|company|co|plc|sa|ag|gmbh)\b/g, "").replace(/[^a-z0-9]/g, "");
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180, a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export type SiteMatch = { site: Site; reason: string } | null;

export async function findExistingSite(s: { name: string; operator: string | null; country: string; lat: number; lon: number }): Promise<SiteMatch> {
  const candidates = await prisma.site.findMany({ where: { country: { equals: s.country, mode: "insensitive" } } });
  const key = siteKey(s.name);
  const byName = key ? candidates.find((c) => siteKey(c.name) === key) : undefined;
  if (byName) return { site: byName, reason: "same name" };
  const mine = new Set(words(s.name));
  let best: { site: Site; reason: string; km: number } | null = null;
  for (const c of candidates) {
    const km = haversineKm(s.lat, s.lon, c.lat, c.lon);
    if (km > 25) continue;
    const theirs = words(c.name);
    const overlap = theirs.length && mine.size ? theirs.filter((w) => mine.has(w)).length / Math.min(theirs.length, mine.size) : 0;
    const sameOperator = !!(s.operator && c.operator && operatorKey(s.operator) === operatorKey(c.operator));
    const reason = sameOperator ? `same operator ${km.toFixed(0)} km away` : overlap >= 0.5 ? `name shares "${theirs.filter((w) => mine.has(w)).join(" ")}" ${km.toFixed(0)} km away` : null;
    if (reason && (!best || km < best.km)) best = { site: c, reason, km };
  }
  return best ? { site: best.site, reason: best.reason } : null;
}
