export type EnergySource = "grid" | "gas" | "solar" | "wind" | "nuclear" | "geothermal" | "hydro";
export const ENERGY_SOURCES: EnergySource[] = ["grid", "gas", "solar", "wind", "nuclear", "geothermal", "hydro"];

/** Shares of facility power supplied by each source. They sum to 1. */
export type EnergyMix = Record<EnergySource, number>;

export type GpuClass = "h100" | "b200" | "gb300" | "next";

export interface SiteSpec {
  itMw: number;          // IT load in MW
  gpu: GpuClass;
  densityKw: 40 | 80 | 130;
  crew: number;          // peak construction headcount
  robots: number;        // 0..1 share of construction done by automation
}

export interface RegionFactors {
  powerPriceKwh: number;
  gridCarbonG: number;
  gridLeadMonths: number;
  gridHeadroomMw: number;
  gridReliability: number;
  laborPool: number;
  wageUsdH: number;
  landIndex: number;
  sentiment: number;
  climate: "hot" | "temperate" | "cold";
  waterStress: "low" | "medium" | "high";
  solar: number;
  wind: number;
  geothermal: boolean;
  flareGas: boolean;
  populationNear?: number | null;
}

export interface EstimateResult {
  facility: {
    itMw: number;
    facilityMw: number;
    pue: number;
    racks: number;
    gpus: number;
    petaflops: number;
    landHa: number;
  };
  build: {
    capexUsd: number;
    capexBreakdown: Record<string, number>;
    monthsToLive: number;
    criticalPath: string;
    constructionJobs: number;
    constructionLaborUsd: number;
    laborShortfall: number; // people short of the requested crew
  };
  operations: {
    revenueUsdYr: number;
    opexUsdYr: number;
    powerCostUsdYr: number;
    ebitdaUsdYr: number;
    paybackYears: number | null;
    npv10Usd: number;
    irr: number | null;
    utilization: number;
    permanentJobs: number;
    blendedPowerPriceKwh: number;
  };
  environment: {
    co2TonnesYr: number;
    carbonIntensityG: number;
    waterM3Yr: number;
    waterStressFlag: boolean;
    gridLoadShare: number;     // facility MW over regional headroom
    landUseScore: number;      // 0..100, higher is better
    environmentScore: number;  // 0..100, higher is better
  };
  community: {
    localSpendUsdYr: number;
    taxRevenueUsdYr: number;
    prosperityIndex: number;   // 0..100
    sentimentShift: number;    // points per year during operation
    noiseIndex: number;        // 0..100, higher is worse
    trafficIndex: number;      // 0..100, higher is worse
    nuisanceScore: number;     // 0..100, higher is worse
    communityScore: number;    // 0..100, higher is better
  };
  scores: {
    economic: number;    // 0..100
    environment: number; // 0..100
    community: number;   // 0..100
    composite: number;   // 0..100
  };
  flags: string[];
  assumptions: string[];
}
