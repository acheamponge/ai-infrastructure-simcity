import { z } from "zod/v4";

export const DiscoveredSite = z.object({
  name: z.string(),
  operator: z.string().nullable(),
  country: z.string().describe("Country in English, e.g. United States"),
  region: z.string().nullable().describe("State, province or region, e.g. Texas"),
  city: z.string().nullable(),
  lat: z.number().describe("Approximate latitude of the site or its city"),
  lon: z.number().describe("Approximate longitude"),
  status: z.enum(["OPERATIONAL", "CONSTRUCTION", "PLANNED", "PROPOSED"]),
  capacityMw: z.number().nullable().describe("Facility power at full build-out in MW"),
  itMw: z.number().nullable().describe("IT load in MW if reported separately"),
  announcedAt: z.string().nullable().describe("ISO date of first public announcement if known"),
  expectedOnline: z.string().nullable().describe("Expected first operation, free text"),
  energyNotes: z.string().nullable().describe("How the site is or will be powered"),
  description: z.string().describe("One or two sentences on what is known"),
  confidence: z.number().min(0).max(1).describe("How well sourced the figures are"),
  sourceIds: z.array(z.number()).describe("Bracketed source numbers from the digest that support the entry"),
});
export const DiscoveryOutput = z.object({ sites: z.array(DiscoveredSite) });
export type DiscoveredSiteT = z.infer<typeof DiscoveredSite>;

export const EnrichOutput = z.object({
  powerPriceKwh: z.number().nullable().describe("Industrial electricity price in USD per kWh"),
  gridCarbonG: z.number().nullable().describe("Grid carbon intensity in gCO2 per kWh"),
  gridLeadMonths: z.number().nullable().describe("Typical months to interconnect a 100 MW+ load"),
  gridHeadroomMw: z.number().nullable().describe("Spare regional capacity in MW before major upgrades"),
  gridReliability: z.number().nullable().describe("0 to 1"),
  laborPool: z.number().nullable().describe("Construction trades available within commuting range"),
  wageUsdH: z.number().nullable().describe("Typical construction wage in USD per hour"),
  landIndex: z.number().nullable().describe("Industrial land cost relative to rural US baseline of 1.0"),
  sentiment: z.number().nullable().describe("0 to 100 community acceptance of data centers"),
  waterStress: z.enum(["low", "medium", "high"]).nullable(),
  climate: z.enum(["hot", "temperate", "cold"]).nullable(),
  solar: z.number().nullable().describe("0 to 1 solar resource quality"),
  wind: z.number().nullable().describe("0 to 1 wind resource quality"),
  geothermal: z.boolean().nullable(),
  flareGas: z.boolean().nullable(),
  populationNear: z.number().nullable().describe("People living within about 5 km"),
  moratorium: z.boolean().describe("Whether a data center moratorium or pause is in force"),
  notes: z.array(z.string()).describe("Short findings that matter for siting, each citing a source number"),
  sourceIds: z.array(z.number()),
});
export type EnrichOutputT = z.infer<typeof EnrichOutput>;

export const BuildPlan = z.object({
  summary: z.string().describe("Two or three sentences describing how to build it so the verdict holds"),
  energyMix: z.object({ grid: z.number(), gas: z.number(), solar: z.number(), wind: z.number(), nuclear: z.number(), geothermal: z.number(), hydro: z.number() }).describe("Shares summing to about 1"),
  itMw: z.number(),
  gpu: z.enum(["h100", "h200", "b200", "gb200", "gb300", "next"]),
  densityKw: z.union([z.literal(40), z.literal(80), z.literal(130)]),
  crew: z.number().describe("Peak construction headcount"),
  robots: z.number().min(0).max(1).describe("Share of construction automated"),
  phasing: z.array(z.string()).describe("Ordered build phases with what gates each"),
  communityMeasures: z.array(z.string()).describe("Concrete commitments that keep the community score above the floor"),
});
export type BuildPlanT = z.infer<typeof BuildPlan>;

export const AdvisorOutput = z.object({
  rationale: z.string().describe("Three to six sentences a board could read aloud"),
  conditions: z.array(z.string()).describe("What must be true for a go, empty if unconditional"),
  risks: z.array(z.string()).describe("The top risks, each one sentence"),
  personas: z.object({
    executive: z.string().describe("Two sentences for the operator's leadership"),
    policy: z.string().describe("Two sentences for the government official"),
    investor: z.string().describe("Two sentences for the investor"),
  }),
  plan: BuildPlan,
});
export type AdvisorOutputT = z.infer<typeof AdvisorOutput>;
