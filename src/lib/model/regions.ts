import type { RegionFactors } from "./types";

/**
 * Country-level priors for the region factors. These seed every site's
 * profile until the enrich agent replaces them with sourced numbers.
 * Values are indicative 2026 figures for industrial customers.
 */
type Prior = Omit<RegionFactors, "climate" | "populationNear"> & { climate?: RegionFactors["climate"] };

const P = (
  powerPriceKwh: number, gridCarbonG: number, gridLeadMonths: number, gridHeadroomMw: number, gridReliability: number,
  laborPool: number, wageUsdH: number, landIndex: number, sentiment: number, waterStress: RegionFactors["waterStress"],
  solar: number, wind: number, geothermal = false, flareGas = false,
): Prior => ({ powerPriceKwh, gridCarbonG, gridLeadMonths, gridHeadroomMw, gridReliability, laborPool, wageUsdH, landIndex, sentiment, waterStress, solar, wind, geothermal, flareGas });

export const COUNTRY_PRIORS: Record<string, Prior> = {
  "United States": P(0.075, 370, 24, 600, 0.96, 12000, 42, 1.6, 52, "medium", 0.75, 0.6, false, true),
  Canada: P(0.05, 120, 16, 700, 0.97, 7000, 40, 0.8, 64, "low", 0.5, 0.7),
  Mexico: P(0.08, 430, 16, 400, 0.88, 18000, 7, 0.8, 66, "high", 0.9, 0.5),
  Brazil: P(0.065, 95, 16, 700, 0.9, 22000, 9, 0.9, 65, "medium", 0.85, 0.7),
  Chile: P(0.045, 200, 14, 600, 0.94, 3000, 14, 0.5, 58, "high", 1.0, 0.5),
  "United Kingdom": P(0.19, 210, 36, 150, 0.97, 10000, 40, 3.0, 40, "low", 0.4, 0.9),
  Ireland: P(0.14, 280, 36, 120, 0.96, 9000, 46, 2.6, 30, "low", 0.4, 0.9),
  Germany: P(0.18, 350, 24, 300, 0.98, 12000, 52, 3.6, 46, "low", 0.5, 0.6),
  France: P(0.12, 60, 20, 500, 0.98, 11000, 44, 2.0, 55, "low", 0.6, 0.6),
  Netherlands: P(0.17, 300, 30, 100, 0.98, 8000, 48, 4.0, 34, "low", 0.4, 0.9),
  Spain: P(0.09, 160, 20, 500, 0.97, 7000, 30, 0.9, 62, "medium", 0.9, 0.9),
  Portugal: P(0.085, 140, 18, 400, 0.97, 4000, 26, 0.8, 64, "medium", 0.9, 0.8),
  Italy: P(0.17, 300, 24, 250, 0.96, 8000, 34, 2.2, 50, "medium", 0.8, 0.5),
  Norway: P(0.03, 15, 12, 400, 0.98, 1500, 50, 0.6, 64, "low", 0.3, 0.9),
  Sweden: P(0.04, 25, 12, 500, 0.98, 2000, 46, 0.5, 66, "low", 0.3, 0.85),
  Finland: P(0.055, 70, 14, 450, 0.98, 3000, 44, 0.6, 66, "low", 0.3, 0.8),
  Denmark: P(0.12, 130, 18, 250, 0.98, 4000, 48, 2.0, 55, "low", 0.4, 0.95),
  Iceland: P(0.035, 20, 12, 250, 0.95, 1200, 45, 0.7, 60, "low", 0.3, 0.9, true),
  Poland: P(0.13, 600, 20, 300, 0.96, 9000, 18, 0.9, 58, "medium", 0.5, 0.6),
  "United Arab Emirates": P(0.06, 450, 10, 1200, 0.97, 20000, 18, 1.5, 72, "high", 1.0, 0.3),
  "Saudi Arabia": P(0.05, 500, 9, 1500, 0.93, 15000, 16, 0.5, 74, "high", 1.0, 0.6, false, true),
  Qatar: P(0.045, 480, 9, 800, 0.97, 8000, 17, 1.0, 72, "high", 1.0, 0.3, false, true),
  Israel: P(0.09, 480, 18, 200, 0.96, 6000, 30, 1.2, 58, "high", 1.0, 0.3),
  Egypt: P(0.05, 470, 14, 500, 0.85, 35000, 4, 0.6, 66, "high", 1.0, 0.6),
  Morocco: P(0.06, 600, 16, 400, 0.9, 5000, 5, 0.4, 66, "high", 1.0, 1.0),
  Kenya: P(0.07, 80, 12, 500, 0.85, 12000, 5, 0.5, 74, "medium", 0.9, 0.6, true),
  Nigeria: P(0.09, 400, 10, 300, 0.7, 30000, 4, 1.0, 68, "medium", 0.8, 0.3, false, true),
  "South Africa": P(0.08, 700, 18, 250, 0.75, 20000, 8, 0.7, 62, "medium", 0.9, 0.5),
  India: P(0.075, 650, 13, 650, 0.84, 42000, 9, 1.4, 73, "medium", 0.85, 0.45),
  Singapore: P(0.17, 400, 30, 80, 0.99, 6000, 40, 6.0, 34, "high", 0.7, 0.2),
  Malaysia: P(0.075, 550, 12, 600, 0.95, 15000, 10, 1.0, 66, "medium", 0.7, 0.2),
  Indonesia: P(0.07, 650, 14, 500, 0.9, 25000, 6, 0.9, 66, "medium", 0.8, 0.3, true),
  Thailand: P(0.09, 480, 14, 400, 0.95, 15000, 8, 1.0, 64, "medium", 0.8, 0.3),
  Vietnam: P(0.075, 500, 14, 400, 0.9, 20000, 5, 0.9, 66, "medium", 0.8, 0.5),
  Japan: P(0.14, 440, 22, 250, 0.99, 7000, 37, 2.6, 56, "low", 0.5, 0.6, true),
  "South Korea": P(0.11, 430, 24, 200, 0.99, 12000, 34, 3.0, 50, "low", 0.5, 0.4),
  Taiwan: P(0.1, 520, 20, 150, 0.97, 9000, 24, 2.4, 56, "high", 0.7, 0.8),
  China: P(0.085, 550, 12, 900, 0.97, 50000, 9, 1.2, 66, "medium", 0.7, 0.6),
  Australia: P(0.1, 520, 18, 400, 0.97, 8000, 44, 2.4, 55, "medium", 0.85, 0.7),
  "New Zealand": P(0.08, 90, 16, 200, 0.98, 4000, 38, 1.5, 62, "low", 0.6, 0.8, true),
};

const FALLBACK: Prior = P(0.1, 450, 18, 300, 0.9, 8000, 15, 1.0, 58, "medium", 0.7, 0.5);

/** US states that differ materially from the national prior. */
const US_STATE_OVERRIDES: Record<string, Partial<Prior>> = {
  Texas: { powerPriceKwh: 0.048, gridCarbonG: 380, gridLeadMonths: 14, gridHeadroomMw: 900, laborPool: 9000, wageUsdH: 33, landIndex: 1.0, sentiment: 64, waterStress: "medium", solar: 0.9, wind: 0.95, flareGas: true },
  Virginia: { powerPriceKwh: 0.082, gridCarbonG: 320, gridLeadMonths: 30, gridHeadroomMw: 400, laborPool: 15000, wageUsdH: 48, landIndex: 3.2, sentiment: 38, waterStress: "low", solar: 0.6, wind: 0.4 },
  Oregon: { powerPriceKwh: 0.05, gridCarbonG: 110, gridLeadMonths: 20, gridHeadroomMw: 500, laborPool: 5000, wageUsdH: 42, landIndex: 1.3, sentiment: 56, waterStress: "medium", solar: 0.6, wind: 0.85, geothermal: true },
  Washington: { powerPriceKwh: 0.045, gridCarbonG: 90, gridLeadMonths: 22, gridHeadroomMw: 400, laborPool: 6000, wageUsdH: 45, landIndex: 1.6, sentiment: 54, waterStress: "low", solar: 0.5, wind: 0.7 },
  Arizona: { powerPriceKwh: 0.07, gridCarbonG: 330, gridLeadMonths: 22, gridHeadroomMw: 500, laborPool: 14000, wageUsdH: 40, landIndex: 1.6, sentiment: 48, waterStress: "high", solar: 1.0, wind: 0.3 },
  Nevada: { powerPriceKwh: 0.065, gridCarbonG: 300, gridLeadMonths: 20, gridHeadroomMw: 450, laborPool: 7000, wageUsdH: 38, landIndex: 1.2, sentiment: 55, waterStress: "high", solar: 1.0, wind: 0.4, geothermal: true },
  Ohio: { powerPriceKwh: 0.065, gridCarbonG: 420, gridLeadMonths: 24, gridHeadroomMw: 600, laborPool: 11000, wageUsdH: 42, landIndex: 1.4, sentiment: 58, waterStress: "low", solar: 0.6, wind: 0.6 },
  Georgia: { powerPriceKwh: 0.06, gridCarbonG: 360, gridLeadMonths: 26, gridHeadroomMw: 450, laborPool: 13000, wageUsdH: 40, landIndex: 1.7, sentiment: 55, waterStress: "low", solar: 0.7, wind: 0.3 },
  Wisconsin: { powerPriceKwh: 0.075, gridCarbonG: 450, gridLeadMonths: 22, gridHeadroomMw: 500, laborPool: 8000, wageUsdH: 40, landIndex: 1.1, sentiment: 56, waterStress: "low", solar: 0.5, wind: 0.6 },
  Iowa: { powerPriceKwh: 0.06, gridCarbonG: 260, gridLeadMonths: 18, gridHeadroomMw: 600, laborPool: 5000, wageUsdH: 38, landIndex: 0.8, sentiment: 60, waterStress: "low", solar: 0.6, wind: 0.95 },
  Louisiana: { powerPriceKwh: 0.055, gridCarbonG: 400, gridLeadMonths: 16, gridHeadroomMw: 800, laborPool: 9000, wageUsdH: 34, landIndex: 0.8, sentiment: 62, waterStress: "low", solar: 0.7, wind: 0.3, flareGas: true },
  Tennessee: { powerPriceKwh: 0.06, gridCarbonG: 330, gridLeadMonths: 20, gridHeadroomMw: 500, laborPool: 9000, wageUsdH: 36, landIndex: 1.1, sentiment: 57, waterStress: "low", solar: 0.65, wind: 0.3 },
  Indiana: { powerPriceKwh: 0.065, gridCarbonG: 560, gridLeadMonths: 22, gridHeadroomMw: 600, laborPool: 9000, wageUsdH: 40, landIndex: 1.0, sentiment: 58, waterStress: "low", solar: 0.6, wind: 0.6 },
  Pennsylvania: { powerPriceKwh: 0.075, gridCarbonG: 340, gridLeadMonths: 26, gridHeadroomMw: 500, laborPool: 12000, wageUsdH: 44, landIndex: 1.5, sentiment: 54, waterStress: "low", solar: 0.5, wind: 0.5 },
  "New Mexico": { powerPriceKwh: 0.06, gridCarbonG: 400, gridLeadMonths: 18, gridHeadroomMw: 500, laborPool: 4000, wageUsdH: 34, landIndex: 0.7, sentiment: 60, waterStress: "high", solar: 1.0, wind: 0.8, flareGas: true },
  Wyoming: { powerPriceKwh: 0.055, gridCarbonG: 650, gridLeadMonths: 14, gridHeadroomMw: 600, laborPool: 2000, wageUsdH: 36, landIndex: 0.5, sentiment: 60, waterStress: "medium", solar: 0.7, wind: 0.95, flareGas: true },
  "North Dakota": { powerPriceKwh: 0.055, gridCarbonG: 600, gridLeadMonths: 14, gridHeadroomMw: 500, laborPool: 2500, wageUsdH: 36, landIndex: 0.5, sentiment: 62, waterStress: "low", solar: 0.6, wind: 0.95, flareGas: true },
  Utah: { powerPriceKwh: 0.06, gridCarbonG: 540, gridLeadMonths: 20, gridHeadroomMw: 400, laborPool: 6000, wageUsdH: 36, landIndex: 1.3, sentiment: 56, waterStress: "high", solar: 0.9, wind: 0.5, geothermal: true },
};

export function priorFor(country: string, region?: string | null, lat?: number): RegionFactors {
  const base = COUNTRY_PRIORS[country] ?? FALLBACK;
  const override = country === "United States" && region ? US_STATE_OVERRIDES[region] ?? {} : {};
  const merged = { ...base, ...override };
  const absLat = Math.abs(lat ?? 40);
  const climate: RegionFactors["climate"] = merged.climate ?? (absLat < 30 ? "hot" : absLat > 52 ? "cold" : "temperate");
  return { ...merged, climate, populationNear: null };
}
