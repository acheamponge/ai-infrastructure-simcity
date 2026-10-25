import { estimate } from "./estimate";
import { mixLabel, normalizeMix } from "./energy";
import type { EnergyMix, EstimateResult, RegionFactors, SiteSpec } from "./types";

export interface Alternative {
  name: string;
  energyMix: EnergyMix;
  estimate: EstimateResult;
  viable: boolean;
}

/** Hard constraints a scenario must clear before anyone calls it a go. */
export const VIABILITY = {
  minEnvironment: 45,
  minCommunity: 40,
  maxPaybackYears: 7,
  minIrr: 0.08,
  maxGridLoadShare: 0.6,
};

export function isViable(e: EstimateResult): boolean {
  return (
    e.scores.environment >= VIABILITY.minEnvironment &&
    e.scores.community >= VIABILITY.minCommunity &&
    e.operations.paybackYears !== null &&
    e.operations.paybackYears <= VIABILITY.maxPaybackYears &&
    (e.operations.irr ?? 0) >= VIABILITY.minIrr &&
    e.environment.gridLoadShare <= VIABILITY.maxGridLoadShare
  );
}

/**
 * Search a set of candidate energy mixes for the one that maximizes economic
 * value subject to the environmental and community floors. Returns every
 * candidate so the advisor can explain what it tried.
 */
export function searchMixes(spec: SiteSpec, r: RegionFactors, base: Partial<EnergyMix>): Alternative[] {
  const candidates: Array<[string, Partial<EnergyMix>]> = [
    ["As proposed", base],
    ["Grid only", { grid: 1 }],
    ["Grid + solar", { grid: 0.6, solar: 0.4 }],
    ["Grid + wind", { grid: 0.6, wind: 0.4 }],
    ["Solar + wind + grid backup", { solar: 0.4, wind: 0.3, grid: 0.3 }],
    ["Gas bridge", { gas: 0.7, grid: 0.3 }],
    ["Gas + solar", { gas: 0.5, solar: 0.5 }],
    ["Geothermal anchor", { geothermal: 0.6, grid: 0.4 }],
    ["Hydro PPA + grid", { hydro: 0.6, grid: 0.4 }],
    ["SMR long-term", { nuclear: 0.7, grid: 0.3 }],
    ["Renewables + SMR", { solar: 0.3, wind: 0.2, nuclear: 0.5 }],
  ];
  const seen = new Set<string>();
  const out: Alternative[] = [];
  for (const [name, mix] of candidates) {
    const m = normalizeMix(mix);
    const key = JSON.stringify(m);
    if (seen.has(key)) continue;
    seen.add(key);
    if (m.geothermal > 0 && !r.geothermal) continue;
    const e = estimate(spec, r, m);
    out.push({ name: name === "As proposed" ? `As proposed (${mixLabel(m)})` : name, energyMix: m, estimate: e, viable: isViable(e) });
  }
  // rank: viable first, then by composite, then economic
  return out.sort((a, b) => Number(b.viable) - Number(a.viable) || b.estimate.scores.composite - a.estimate.scores.composite || b.estimate.scores.economic - a.estimate.scores.economic);
}
