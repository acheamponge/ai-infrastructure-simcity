import { DENSITY, GPUS } from "./hardware";
import { SOURCES, normalizeMix } from "./energy";
import type { EnergyMix, EnergySource, EstimateResult, RegionFactors, SiteSpec } from "./types";

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const HOURS = 8760;

/** Internal rate of return for a cash flow series, bisection on NPV. */
export function irr(cashflows: number[]): number | null {
  const npv = (r: number) => cashflows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + r, t), 0);
  let lo = -0.9, hi = 1.5;
  if (npv(lo) * npv(hi) > 0) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (npv(lo) * npv(mid) <= 0) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/**
 * Deterministic estimate of what a facility costs to build and run, what it
 * emits, and what it does to the surrounding community. All coefficients are
 * documented on the Methodology page; the agents may override region factors
 * with sourced values but never the model itself.
 */
export interface EstimateOptions {
  /** Multiplier on GPU-hour rates, 1 = list. */
  priceMult?: number;
  /** Discount rate for NPV, default 0.10. */
  discount?: number;
  /** Carbon price in USD per tonne, charged against EBITDA; default 0. */
  carbonPriceUsdT?: number;
}

export function estimate(spec: SiteSpec, r: RegionFactors, mixIn: Partial<EnergyMix>, opts: EstimateOptions = {}): EstimateResult {
  const mix = normalizeMix(mixIn);
  const priceMult = opts.priceMult ?? 1, rate = opts.discount ?? 0.1, carbonPrice = opts.carbonPriceUsdT ?? 0;
  const G = GPUS[spec.gpu];
  const D = DENSITY[spec.densityKw];
  const flags: string[] = [];
  const assumptions: string[] = [];

  // ---- facility
  const pue = D.basePue + (r.climate === "hot" ? 0.15 : r.climate === "cold" ? -0.07 : 0);
  const itMw = spec.itMw;
  const facilityMw = itMw * pue;
  const racks = Math.round((itMw * 1000) / spec.densityKw);
  const gpusPerRack = Math.floor((spec.densityKw * 1000 * 0.7) / G.watts);
  const gpus = gpusPerRack * racks;
  const petaflops = (gpus * G.perf) / 1000;
  const sourceLand = (Object.keys(mix) as EnergySource[]).reduce((a, k) => a + mix[k] * SOURCES[k].landHaPerMw, 0);
  const landHa = facilityMw * 0.12 + facilityMw * sourceLand;

  // ---- energy blend
  const blendedPrice = (Object.keys(mix) as EnergySource[]).reduce((a, k) => a + mix[k] * SOURCES[k].opexKwh(r), 0);
  const carbonIntensityG = (Object.keys(mix) as EnergySource[]).reduce((a, k) => a + mix[k] * SOURCES[k].carbonG(r), 0);
  const firmness = (Object.keys(mix) as EnergySource[]).reduce((a, k) => a + mix[k] * SOURCES[k].firmness(r), 0);
  const energyCapexPerMw = (Object.keys(mix) as EnergySource[]).reduce((a, k) => {
    let c = SOURCES[k].capexPerMw;
    if (k === "geothermal" && !r.geothermal) c = 12e6;
    if (k === "hydro" && r.waterStress === "high") c *= 1.6;
    return a + mix[k] * c;
  }, 0);
  const energyLead = Math.max(0, ...(Object.keys(mix) as EnergySource[]).filter((k) => mix[k] >= 0.05).map((k) => (k === "grid" ? r.gridLeadMonths : k === "geothermal" && !r.geothermal ? 26 : SOURCES[k].leadMonths)));
  if (mix.geothermal >= 0.05 && !r.geothermal) flags.push("Geothermal selected where no resource is mapped; capex and lead time are penalized.");
  if (mix.gas + mix.grid * (r.gridCarbonG > 400 ? 1 : 0) > 0.6) flags.push("Majority of supply is high-carbon; expect scrutiny under disclosure rules.");

  // ---- build
  const robots = clamp(spec.robots, 0, 1);
  const peopleWanted = Math.round(spec.crew * (1 - robots));
  const people = Math.min(peopleWanted, r.laborPool);
  const laborShortfall = Math.max(0, peopleWanted - r.laborPool);
  const effCrew = people + spec.crew * robots;
  const speed = clamp(Math.sqrt(effCrew / 600), 0.45, 1.9) * (1 + 0.5 * robots);
  const permit = clamp(3 + (75 - r.sentiment) / 8, 2, 14) + (robots > 0.6 && r.wageUsdH > 30 ? 2 : 0);
  // campuses above ~150 MW are built as overlapping phases; each phase gets the full crew in turn
  const phases = Math.max(1, Math.ceil(facilityMw / 150));
  const phaseMw = facilityMw / phases;
  const phaseRacks = racks / phases;
  const civil = (3 * (1 + phaseMw / 400)) / speed;
  const shell = (5 + phaseMw / 25) / speed;
  const mep = (5 + phaseMw / 20) / speed;
  const rackMonths = (1.5 + phaseRacks / 350) / speed;
  const stagger = (phases - 1) * 4;
  const buildChain = permit + civil + shell + mep + rackMonths + stagger;
  const powerChain = permit + energyLead;
  const monthsToLive = Math.round(Math.max(buildChain, powerChain) + 1.5);
  const criticalPath = powerChain > buildChain ? "power supply" : phases > 1 ? `${phases} construction phases` : "construction and rack delivery";
  if (phases > 1) assumptions.push(`Built as ${phases} phases of ${Math.round(phaseMw)} MW, staggered 4 months`);
  if (laborShortfall > 0) flags.push(`Local trades cover ${people.toLocaleString()} of ${peopleWanted.toLocaleString()} requested; the rest must be imported or automated.`);

  const capexBreakdown: Record<string, number> = {
    land: facilityMw * 0.25e6 * r.landIndex,
    civil: facilityMw * 1.2e6,
    "power supply": facilityMw * energyCapexPerMw,
    shell: facilityMw * 3.5e6,
    "mechanical & electrical": facilityMw * 5.5e6,
    "racks & GPUs": racks * (25000 + (D.cooling === "liquid" ? 15000 : 0) + gpusPerRack * G.costUsd),
    "automation fleet": spec.crew * robots * 150000,
    commissioning: facilityMw * 0.2e6,
  };
  const capexUsd = Object.values(capexBreakdown).reduce((a, b) => a + b, 0);
  const laborMo = people * r.wageUsdH * 170 * (laborShortfall > 0 ? 1.15 : 1) + spec.crew * robots * 2500;
  const constructionLaborUsd = laborMo * monthsToLive;

  // ---- operations
  // firmness caps the hours the hall can run; 0.72 is the commercial fill rate on top of that
  const utilization = firmness * 0.72;
  const mwh = facilityMw * HOURS * (0.5 + 0.5 * utilization);
  const revenueUsdYr = gpus * HOURS * utilization * G.rateUsdHr * priceMult;
  const powerCostUsdYr = mwh * 1000 * blendedPrice + (mwh * carbonIntensityG / 1000) * carbonPrice;
  const permanentJobs = Math.round((12 + racks / 12) * (1 - 0.65 * robots));
  const staffUsdYr = permanentJobs * r.wageUsdH * 170 * 12 * 1.4;
  const maintUsdYr = capexBreakdown["racks & GPUs"] * 0.012 + spec.crew * robots * 800 * 12;
  const opexUsdYr = powerCostUsdYr + staffUsdYr + maintUsdYr;
  const ebitdaUsdYr = revenueUsdYr - opexUsdYr;
  const paybackYears = ebitdaUsdYr > 0 ? capexUsd / ebitdaUsdYr : null;
  // ten-year cash flow: GPU-hour prices decay 7%/yr on a given generation; the year-5 refresh
  // costs 70% of the GPU capex and resets revenue to 85% of year one on new silicon
  const flows = [-capexUsd * 0.6, -capexUsd * 0.4];
  for (let y = 1; y <= 10; y++) {
    const decay = y <= 5 ? Math.pow(0.93, y - 1) : 0.85 * Math.pow(0.93, y - 6);
    const refresh = y === 5 ? -capexBreakdown["racks & GPUs"] * 0.7 : 0;
    flows.push(revenueUsdYr * decay - opexUsdYr * (0.7 + 0.3 * decay) + refresh);
  }
  const npv10Usd = flows.reduce((acc, cf, t) => acc + cf / Math.pow(1 + rate, t), 0);
  const irrValue = irr(flows);

  // ---- environment
  const co2TonnesYr = (mwh * carbonIntensityG) / 1000;
  const coolingWater = D.cooling === "air" ? 1.9 : 0.6; // L per kWh of IT load, evaporative vs liquid
  const sourceWater = (Object.keys(mix) as EnergySource[]).reduce((a, k) => a + mix[k] * SOURCES[k].waterLKwh, 0);
  const waterM3Yr = (itMw * HOURS * 1000 * coolingWater + mwh * 1000 * sourceWater) / 1000;
  const waterStressFlag = r.waterStress === "high" && coolingWater > 1;
  if (waterStressFlag) flags.push("Evaporative cooling in a water-stressed basin.");
  const gridLoadShare = mix.grid * facilityMw / Math.max(1, r.gridHeadroomMw);
  if (gridLoadShare > 0.5) flags.push(`Grid draw is ${Math.round(gridLoadShare * 100)}% of regional headroom; rate impacts for other customers are likely.`);
  const landUseScore = clamp(100 - landHa / facilityMw * 25, 0, 100);
  const carbonScore = clamp(100 - carbonIntensityG / 6.5, 0, 100);
  const waterScore = clamp(100 - (waterM3Yr / (facilityMw * 1000)) * (r.waterStress === "high" ? 40 : r.waterStress === "medium" ? 18 : 8), 0, 100);
  const gridScore = clamp(100 - gridLoadShare * 110, 0, 100);
  const environmentScore = Math.round(0.45 * carbonScore + 0.25 * waterScore + 0.2 * gridScore + 0.1 * landUseScore);

  // ---- community
  const localSpendUsdYr = permanentJobs * r.wageUsdH * 170 * 12 * 1.6 + opexUsdYr * 0.12;
  const taxRevenueUsdYr = revenueUsdYr * 0.03 + capexUsd * 0.004;
  const econSize = r.laborPool * r.wageUsdH * 170 * 12 * 4;
  const prosperityIndex = clamp(((localSpendUsdYr + taxRevenueUsdYr) / Math.max(1, econSize)) * 400 + (people / Math.max(1, r.laborPool)) * 30, 0, 100);
  const sourceSent = (Object.keys(mix) as EnergySource[]).reduce((a, k) => a + mix[k] * SOURCES[k].sentiment, 0);
  const sentimentShift = 1.8 * (1 - robots) + sourceSent - (waterStressFlag ? 3 : 0) - (gridLoadShare > 0.5 ? 2.5 : 0);
  const pop = r.populationNear ?? 5000;
  const popWeight = clamp(Math.log10(Math.max(100, pop)) / 6, 0.3, 1);
  // size enters on a log scale: a campus ten times larger is louder and busier, not ten times so
  const noiseIndex = clamp(((Object.keys(mix) as EnergySource[]).reduce((a, k) => a + mix[k] * SOURCES[k].noise, 0) + (D.cooling === "air" ? 25 : 12) + 12 * Math.log10(Math.max(1, facilityMw))) * popWeight, 0, 100);
  const trafficIndex = clamp((10 * Math.log10(Math.max(1, spec.crew)) + 8 * Math.log10(Math.max(1, permanentJobs))) * popWeight, 0, 100);
  const nuisanceScore = Math.round(0.5 * noiseIndex + 0.3 * trafficIndex + 0.2 * clamp(landHa / 4, 0, 100));
  const communityScore = Math.round(clamp(0.45 * prosperityIndex + 0.25 * (50 + sentimentShift * 6) + 0.3 * (100 - nuisanceScore), 0, 100));

  // ---- scores
  const economic = Math.round(clamp(
    (paybackYears ? clamp(60 - (paybackYears - 3) * 10, 0, 60) : 0) +
    (irrValue !== null ? clamp(irrValue * 100, 0, 30) : 0) +
    clamp(10 - monthsToLive / 6, 0, 10), 0, 100));
  const composite = Math.round(0.4 * economic + 0.35 * environmentScore + 0.25 * communityScore);

  assumptions.push(
    `PUE ${pue.toFixed(2)} from ${D.label} in a ${r.climate} climate`,
    `GPU-hour rate $${G.rateUsdHr.toFixed(2)} decaying 7%/yr per generation; utilization ${Math.round(utilization * 100)}% from supply firmness and fill`,
    `Blended power $${blendedPrice.toFixed(3)}/kWh, ${Math.round(carbonIntensityG)} gCO2/kWh`,
    `Ten-year cash flow at 10% discount with a GPU refresh in year 5`,
  );

  return {
    facility: { itMw, facilityMw, pue, racks, gpus, petaflops, landHa },
    build: { capexUsd, capexBreakdown, monthsToLive, criticalPath, constructionJobs: people, constructionLaborUsd, laborShortfall },
    operations: { revenueUsdYr, opexUsdYr, powerCostUsdYr, ebitdaUsdYr, paybackYears, npv10Usd, irr: irrValue, utilization, permanentJobs, blendedPowerPriceKwh: blendedPrice },
    environment: { co2TonnesYr, carbonIntensityG, waterM3Yr, waterStressFlag, gridLoadShare, landUseScore, environmentScore },
    community: { localSpendUsdYr, taxRevenueUsdYr, prosperityIndex, sentimentShift, noiseIndex, trafficIndex, nuisanceScore, communityScore },
    scores: { economic, environment: environmentScore, community: communityScore, composite },
    flags,
    assumptions,
  };
}
