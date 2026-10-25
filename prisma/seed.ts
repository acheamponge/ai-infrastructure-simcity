// Curated starting registry: well-reported hyperscale and AI campuses, with
// approximate capacities from public announcements. Confidence is deliberately
// below 0.8 so the UI shows them as needing verification by the agents.
import { PrismaClient, type SiteStatus } from "@prisma/client";
import { priorFor } from "../src/lib/model/regions";
import { estimate } from "../src/lib/model/estimate";
import { defaultSpec, mixFromNotes } from "../src/lib/sites";

const prisma = new PrismaClient();

type Seed = [name: string, operator: string, country: string, region: string | null, city: string, lat: number, lon: number, status: SiteStatus, capacityMw: number, expectedOnline: string | null, energyNotes: string, description: string, sourceHost: string];

const SITES: Seed[] = [
  ["Stargate Abilene", "OpenAI / Oracle / Crusoe", "United States", "Texas", "Abilene", 32.45, -99.73, "CONSTRUCTION", 1200, "2026", "Grid interconnect with on-site gas turbines; wind in the ERCOT mix", "Flagship Stargate campus; first buildings energized in 2025 with expansion continuing through 2026.", "openai.com"],
  ["Colossus", "xAI", "United States", "Tennessee", "Memphis", 35.06, -90.14, "OPERATIONAL", 300, null, "Grid plus on-site gas turbines, battery storage", "Former manufacturing site converted at speed; second phase announced nearby.", "x.ai"],
  ["Hyperion", "Meta", "United States", "Louisiana", "Richland Parish", 32.4, -91.6, "CONSTRUCTION", 2000, "2028", "New gas generation under utility contract; solar additions announced", "Multi-gigawatt campus in northeast Louisiana, among the largest single sites announced.", "about.fb.com"],
  ["Prometheus", "Meta", "United States", "Ohio", "New Albany", 40.08, -82.78, "CONSTRUCTION", 1000, "2026", "Grid with on-site gas", "AI training cluster at Meta's existing New Albany footprint.", "about.fb.com"],
  ["Project Rainier", "Amazon / Anthropic", "United States", "Indiana", "New Carlisle", 41.7, -86.42, "OPERATIONAL", 2200, "2026", "Grid, largely coal and gas in the regional mix; renewable PPAs", "Cluster of data halls serving Anthropic training workloads.", "aboutamazon.com"],
  ["Fairwater", "Microsoft", "United States", "Wisconsin", "Mount Pleasant", 42.72, -87.87, "CONSTRUCTION", 900, "2026", "Grid with utility solar expansion", "AI datacenter on the former Foxconn site.", "microsoft.com"],
  ["Loudoun County cluster", "Multiple operators", "United States", "Virginia", "Ashburn", 39.04, -77.49, "OPERATIONAL", 5000, null, "Grid, PJM", "Densest data center market in the world; interconnection queue and rate pressure are active policy issues.", "loudoun.gov"],
  ["Council Bluffs", "Google", "United States", "Iowa", "Council Bluffs", 41.26, -95.86, "OPERATIONAL", 700, null, "Grid with wind PPAs", "One of Google's largest campuses, expanded repeatedly since 2007.", "google.com"],
  ["Mesa campus", "Google", "United States", "Arizona", "Mesa", 33.42, -111.83, "OPERATIONAL", 400, null, "Grid, solar PPAs", "Phoenix-area campus; water use under scrutiny in a high-stress basin.", "google.com"],
  ["Shackelford County Stargate", "OpenAI / Oracle / Vantage", "United States", "Texas", "Albany", 32.72, -99.3, "PLANNED", 1400, "2027", "Grid with gas; wind-rich region", "Second Texas Stargate site announced in 2025.", "openai.com"],
  ["Doña Ana County Stargate", "OpenAI / Oracle", "United States", "New Mexico", "Santa Teresa", 31.85, -106.63, "PLANNED", 1000, "2027", "Grid with solar", "Southern New Mexico site near the El Paso border.", "openai.com"],
  ["Lordstown Stargate", "OpenAI / SoftBank", "United States", "Ohio", "Lordstown", 41.16, -80.86, "PLANNED", 600, "2027", "Grid", "Repurposed industrial site in the Mahoning Valley.", "openai.com"],
  ["Quincy campus", "Microsoft", "United States", "Washington", "Quincy", 47.23, -119.85, "OPERATIONAL", 500, null, "Hydro from the Columbia River", "Low-carbon hydro-powered cluster; water and land use contested locally.", "microsoft.com"],
  ["Hamina", "Google", "Finland", "Kymenlaakso", "Hamina", 60.57, 27.2, "OPERATIONAL", 300, null, "Hydro and wind PPAs; seawater cooling; heat reuse to district heating", "Converted paper mill; expansions announced in 2024 and 2025.", "google.com"],
  ["Odense", "Meta", "Denmark", "Syddanmark", "Odense", 55.4, 10.4, "OPERATIONAL", 200, null, "Wind PPAs; heat reuse to district heating", "Meta's Danish campus with residual heat recovery.", "about.fb.com"],
  ["Dublin cluster", "Amazon Web Services", "Ireland", "Leinster", "Dublin", 53.35, -6.26, "OPERATIONAL", 800, null, "Grid; wind PPAs", "Subject to EirGrid connection moratorium in the Dublin area.", "aboutamazon.com"],
  ["Hyperscale campus Hesse", "Multiple operators", "Germany", "Hesse", "Frankfurt", 50.11, 8.68, "OPERATIONAL", 1200, null, "Grid; renewable certificates", "Europe's largest interconnection market; municipal heat-reuse mandates apply.", "frankfurt.de"],
  ["Stargate UAE", "OpenAI / G42 / Oracle", "United Arab Emirates", "Abu Dhabi", "Abu Dhabi", 24.45, 54.65, "CONSTRUCTION", 1000, "2026", "Grid (gas and nuclear in the mix), solar", "First phase of a 5 GW campus announced in 2025.", "openai.com"],
  ["Humain hyperscale", "Humain / PIF", "Saudi Arabia", "Riyadh", "Riyadh", 24.71, 46.68, "PLANNED", 1500, "2027", "Grid with solar", "Sovereign AI build-out announced in 2025.", "humain.ai"],
  ["Johor Bahru cluster", "Multiple operators", "Malaysia", "Johor", "Johor Bahru", 1.49, 103.74, "CONSTRUCTION", 1500, "2026", "Grid, largely gas; solar PPAs", "Spillover from Singapore's moratorium; water allocation under review.", "mida.gov.my"],
  ["Hyderabad AI campus", "Multiple operators", "India", "Telangana", "Hyderabad", 17.39, 78.49, "PLANNED", 500, "2027", "Grid with solar", "State incentives for AI compute; grid reliability a stated risk.", "telangana.gov.in"],
  ["Sines campus", "Start Campus", "Portugal", "Alentejo", "Sines", 37.95, -8.87, "CONSTRUCTION", 1200, "2027", "Grid, solar and wind PPAs, seawater cooling", "Phased 1.2 GW campus on the Atlantic coast.", "startcampus.pt"],
  ["Narvik AI campus", "Multiple operators", "Norway", "Nordland", "Narvik", 68.44, 17.43, "PLANNED", 300, "2027", "Hydro", "Arctic hydro-powered site with free cooling.", "narvik.kommune.no"],
  ["Western Sydney campus", "Multiple operators", "Australia", "New South Wales", "Sydney", -33.8, 150.9, "CONSTRUCTION", 400, "2026", "Grid, solar PPAs", "Growing cluster in Eastern Creek and surrounds.", "nsw.gov.au"],
];

async function main() {
  let created = 0;
  for (const [name, operator, country, region, city, lat, lon, status, capacityMw, expectedOnline, energyNotes, description, host] of SITES) {
    const existing = await prisma.site.findFirst({ where: { name, country } });
    if (existing) continue;
    const site = await prisma.site.create({
      data: { name, operator, country, region, city, lat, lon, status, capacityMw, expectedOnline, energyNotes, description, confidence: 0.6, curated: true, sources: [{ title: host, url: `https://${host}` }] },
    });
    const prior = priorFor(country, region, lat);
    const profile = await prisma.regionProfile.create({ data: { siteId: site.id, ...prior, sources: [] } });
    const spec = defaultSpec(capacityMw);
    const mix = mixFromNotes(energyNotes);
    const result = estimate(spec, { ...prior, climate: profile.climate as "hot" | "temperate" | "cold", waterStress: profile.waterStress as "low" | "medium" | "high" }, mix);
    await prisma.scenario.create({ data: { siteId: site.id, name: "Baseline as reported", spec: JSON.parse(JSON.stringify(spec)), energyMix: JSON.parse(JSON.stringify(mix)), estimate: JSON.parse(JSON.stringify(result)), isBaseline: true } });
    created++;
  }
  console.log(`seeded ${created} sites (${SITES.length - created} already present)`);
}

main().finally(() => prisma.$disconnect());
