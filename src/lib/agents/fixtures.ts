import type { AdvisorOutputT, BuildPlanT, DiscoveredSiteT, EnrichOutputT } from "./schemas";

/** Deterministic stand-ins used when no API keys are configured. Clearly labeled in the UI. */
export function fixtureDiscovery(query: string): DiscoveredSiteT[] {
  const q = query.toLowerCase();
  const pick = (name: string, operator: string, country: string, region: string | null, city: string, lat: number, lon: number, status: DiscoveredSiteT["status"], capacityMw: number, energyNotes: string): DiscoveredSiteT => ({
    name, operator, country, region, city, lat, lon, status, capacityMw, itMw: null, announcedAt: null, expectedOnline: status === "OPERATIONAL" ? null : "2027",
    energyNotes, description: `Fixture entry generated for the query "${query}". Add CRUSOE_API_KEY and TAVILY_API_KEY to replace with sourced results.`, confidence: 0.2, sourceIds: [],
  });
  if (q.includes("texas") || q.includes("us") || q.includes("united states"))
    return [
      pick("Abilene AI campus (fixture)", "Crusoe / Oracle", "United States", "Texas", "Abilene", 32.45, -99.73, "CONSTRUCTION", 1200, "Grid plus on-site gas; wind PPA under negotiation"),
      pick("Amarillo hyperscale (fixture)", "Unknown", "United States", "Texas", "Amarillo", 35.22, -101.83, "PLANNED", 500, "Wind and grid"),
    ];
  if (q.includes("europe") || q.includes("nordic") || q.includes("finland"))
    return [pick("Hamina expansion (fixture)", "Google", "Finland", "Kymenlaakso", "Hamina", 60.57, 27.2, "OPERATIONAL", 300, "Hydro and wind PPAs")];
  return [pick(`${query} data center (fixture)`, "Unknown", "United States", "Texas", "Abilene", 32.45, -99.73, "PROPOSED", 300, "Grid")];
}

export function fixtureEnrich(): EnrichOutputT {
  return {
    powerPriceKwh: null, gridCarbonG: null, gridLeadMonths: null, gridHeadroomMw: null, gridReliability: null, laborPool: null, wageUsdH: null, landIndex: null,
    sentiment: null, waterStress: null, climate: null, solar: null, wind: null, geothermal: null, flareGas: null, populationNear: null, moratorium: false,
    notes: ["Fixture mode: no web research was performed, country priors retained."], sourceIds: [],
  };
}

export function fixtureAdvisor(input: { verdict: string; siteName: string; composite: number; bestAlt: string | null; flags: string[]; plan: BuildPlanT }): AdvisorOutputT {
  const v = input.verdict;
  return {
    rationale:
      v === "GO"
        ? `${input.siteName} clears every viability floor with a composite score of ${input.composite}. The proposed energy mix keeps carbon intensity and grid draw inside tolerance while the payback stays under seven years.`
        : v === "CONDITIONAL"
          ? `${input.siteName} does not clear the floors as proposed, but the alternative "${input.bestAlt}" does. Proceed only if the supply mix is changed before permitting; the build plan below is that alternative.`
          : `No energy mix tested makes ${input.siteName} both financeable and acceptable to the community. The plan below is the least-bad configuration and still fails at least one floor.`,
    conditions: v === "CONDITIONAL" && input.bestAlt ? [`Adopt the "${input.bestAlt}" supply mix`, "Secure interconnection or on-site supply agreements before land close"] : [],
    risks: input.flags.length ? input.flags : ["No model flags were raised; verify the region factors with the enrich agent before relying on this."],
    personas: {
      executive: "Deterministic verdict from the estimation engine. Configure the Crusoe and Tavily keys for a model-written briefing.",
      policy: "The community and environment scores above are computed from the site profile; no narrative review was run.",
      investor: "Payback, IRR and NPV are engine outputs under the stated assumptions; treat as screening-grade.",
    },
    plan: input.plan,
  };
}
