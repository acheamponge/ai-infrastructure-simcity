// Translates registry records into the shapes the simulation understands, and back.
import type { RegionProfile, Site } from "@prisma/client";
import type { EnergyMix, EnergySource, SiteSpec } from "./model/types";

/** The sim models one supply source per facility; pick the dominant share. */
export function dominantSimEnergy(mix: EnergyMix, flareAvailable: boolean): string {
  const order = (Object.keys(mix) as EnergySource[]).sort((a, b) => mix[b] - mix[a]);
  const top = order[0];
  const map: Record<EnergySource, string> = { grid: "grid", gas: flareAvailable ? "flare" : "gas", solar: "solar", wind: "wind", nuclear: "smr", geothermal: "geo", hydro: "grid" };
  return map[top] ?? "grid";
}

const round50 = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, Math.round(v / 50) * 50));

/** Phase-one build config for the sim from an engine spec and mix. */
export function toSimCfg(spec: SiteSpec, mix: EnergyMix, flareAvailable: boolean) {
  const facilityMw = spec.itMw * (spec.densityKw === 40 ? 1.45 : spec.densityKw === 80 ? 1.18 : 1.12);
  const phases = Math.max(1, Math.ceil(facilityMw / 150));
  const racks = round50((spec.itMw * 1000) / spec.densityKw / phases, 50, 3000);
  return {
    phases,
    cfg: {
      energy: dominantSimEnergy(mix, flareAvailable),
      gpu: spec.gpu === "next" ? "gb300" : spec.gpu,
      gpuMix: { h100: 0, b200: 0, gb300: 0, next: 0, [spec.gpu === "next" ? "gb300" : spec.gpu]: 100 },
      dens: spec.densityKw,
      racks,
      crew: round50(spec.crew / Math.min(phases, 3), 100, 2500),
      robots: 0, // the simulation has no workforce-mix control; crews are people
    },
  };
}

/** A registry site as a sim "region" with its own economics, so it can be built in the game. */
export function toSimRegion(site: Site, p: RegionProfile, baseline: { spec: unknown; energyMix: unknown }) {
  const spec = baseline.spec as SiteSpec, mix = baseline.energyMix as EnergyMix;
  const { phases, cfg } = toSimCfg(spec, mix, p.flareGas);
  return {
    id: `site:${site.id}`, siteId: site.id, real: true, name: site.name, operator: site.operator, country: site.country, lat: site.lat, lon: site.lon, status: site.status, phases, cfg,
    power: p.powerPriceKwh, carbon: p.gridCarbonG, labor: p.laborPool, wage: p.wageUsdH, land: p.landIndex, sent: p.sentiment,
    climate: p.climate, water: p.waterStress === "medium" ? "med" : p.waterStress, gridLead: p.gridLeadMonths, gridRel: p.gridReliability, headroom: p.gridHeadroomMw,
    solar: p.solar, wind: p.wind, geo: p.geothermal, flare: p.flareGas,
  };
}
export type SimRegion = ReturnType<typeof toSimRegion>;
