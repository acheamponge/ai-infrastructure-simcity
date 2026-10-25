import type { EnergyMix, EnergySource, RegionFactors } from "./types";

export interface SourceProfile {
  label: string;
  capexPerMw: number;        // USD per facility MW of supply
  leadMonths: number;
  opexKwh: (r: RegionFactors) => number;   // marginal USD per kWh
  carbonG: (r: RegionFactors) => number;   // gCO2 per kWh
  firmness: (r: RegionFactors) => number;  // 0..1, share of hours it can carry its load
  waterLKwh: number;         // litres of water per kWh generated
  landHaPerMw: number;       // hectares per MW of nameplate
  noise: number;             // 0..100 local noise contribution at full share
  sentiment: number;         // sentiment shift per year at full share
  note: string;
}

export const SOURCES: Record<EnergySource, SourceProfile> = {
  grid: {
    label: "Grid connection",
    capexPerMw: 1.5e6,
    leadMonths: 0,
    opexKwh: (r) => r.powerPriceKwh,
    carbonG: (r) => r.gridCarbonG,
    firmness: (r) => r.gridReliability,
    waterLKwh: 1.8,
    landHaPerMw: 0.02,
    noise: 5,
    sentiment: -0.6,
    note: "Lowest capex. Timeline and carbon follow the local grid; large loads draw community pushback over rates.",
  },
  gas: {
    label: "On-site gas turbines",
    capexPerMw: 1.3e6,
    leadMonths: 10,
    opexKwh: () => 0.048,
    carbonG: () => 420,
    firmness: () => 0.95,
    waterLKwh: 0.9,
    landHaPerMw: 0.05,
    noise: 40,
    sentiment: -2.5,
    note: "Fast and firm. Highest carbon and air-quality burden; permitting risk rises near population.",
  },
  solar: {
    label: "Solar + storage",
    capexPerMw: 4.0e6,
    leadMonths: 9,
    opexKwh: () => 0.014,
    carbonG: () => 25,
    firmness: (r) => 0.5 + 0.25 * r.solar,
    waterLKwh: 0.05,
    landHaPerMw: 2.2,
    noise: 2,
    sentiment: 1.2,
    note: "Cheap to run, land hungry. Utilization is capped unless paired with firm supply.",
  },
  wind: {
    label: "Wind + storage",
    capexPerMw: 3.4e6,
    leadMonths: 10,
    opexKwh: () => 0.018,
    carbonG: () => 12,
    firmness: (r) => 0.5 + 0.3 * r.wind,
    waterLKwh: 0.01,
    landHaPerMw: 0.4,
    noise: 12,
    sentiment: 0.4,
    note: "Strong where the resource is. Visual and noise objections are common near homes.",
  },
  nuclear: {
    label: "Small modular reactor",
    capexPerMw: 9.0e6,
    leadMonths: 34,
    opexKwh: () => 0.03,
    carbonG: () => 10,
    firmness: () => 0.97,
    waterLKwh: 2.4,
    landHaPerMw: 0.1,
    noise: 8,
    sentiment: -1.0,
    note: "Near-zero carbon and very firm, but three years to first power and a divisive permitting path.",
  },
  geothermal: {
    label: "Geothermal",
    capexPerMw: 5.0e6,
    leadMonths: 14,
    opexKwh: () => 0.024,
    carbonG: () => 40,
    firmness: () => 0.95,
    waterLKwh: 0.3,
    landHaPerMw: 0.3,
    noise: 10,
    sentiment: 0.8,
    note: "Firm and clean where the resource exists. Elsewhere it is prohibitively expensive.",
  },
  hydro: {
    label: "Hydro PPA",
    capexPerMw: 1.8e6,
    leadMonths: 12,
    opexKwh: () => 0.035,
    carbonG: () => 20,
    firmness: () => 0.9,
    waterLKwh: 4.5,
    landHaPerMw: 0.02,
    noise: 3,
    sentiment: 0.6,
    note: "Clean and firm where hydro is abundant; contracts compete with existing demand.",
  },
};

export const DEFAULT_MIX: EnergyMix = { grid: 1, gas: 0, solar: 0, wind: 0, nuclear: 0, geothermal: 0, hydro: 0 };

export function normalizeMix(mix: Partial<EnergyMix>): EnergyMix {
  const out: EnergyMix = { ...DEFAULT_MIX, grid: 0 };
  let total = 0;
  for (const k of Object.keys(SOURCES) as EnergySource[]) {
    const v = Math.max(0, Number(mix[k] ?? 0));
    out[k] = v;
    total += v;
  }
  if (total <= 0) return { ...DEFAULT_MIX };
  for (const k of Object.keys(out) as EnergySource[]) out[k] = out[k] / total;
  return out;
}

export function mixLabel(mix: EnergyMix): string {
  return (Object.keys(mix) as EnergySource[])
    .filter((k) => mix[k] >= 0.05)
    .sort((a, b) => mix[b] - mix[a])
    .map((k) => `${Math.round(mix[k] * 100)}% ${SOURCES[k].label.split(" ")[0].toLowerCase()}`)
    .join(" · ");
}
