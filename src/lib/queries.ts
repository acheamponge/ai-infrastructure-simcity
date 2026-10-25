import { prisma } from "./db";
import type { EstimateResult } from "./model/types";

export interface SiteRow {
  id: string; name: string; operator: string | null; country: string; region: string | null; city: string | null; lat: number; lon: number; status: string;
  capacityMw: number | null; confidence: number; curated: boolean; updatedAt: Date;
  estimate: EstimateResult | null; verdict: string | null; assessmentScore: number | null; enriched: boolean; scenarioId: string | null;
}

/** Every site with its baseline estimate and latest baseline assessment, for the dashboards. */
export async function siteRows(): Promise<SiteRow[]> {
  const sites = await prisma.site.findMany({
    orderBy: [{ status: "asc" }, { capacityMw: "desc" }],
    include: { profile: { select: { enrichedBy: true } }, scenarios: { where: { isBaseline: true }, include: { assessments: { orderBy: { createdAt: "desc" }, take: 1 } } } },
  });
  return sites.map((s) => {
    const base = s.scenarios[0];
    const a = base?.assessments[0];
    return {
      id: s.id, name: s.name, operator: s.operator, country: s.country, region: s.region, city: s.city, lat: s.lat, lon: s.lon, status: s.status,
      capacityMw: s.capacityMw, confidence: s.confidence, curated: s.curated, updatedAt: s.updatedAt,
      estimate: (base?.estimate as unknown as EstimateResult) ?? null, verdict: a?.verdict ?? null, assessmentScore: a?.score ?? null, enriched: !!s.profile?.enrichedBy, scenarioId: base?.id ?? null,
    };
  });
}

export async function headline() {
  const [sites, assessments, runs] = await Promise.all([
    prisma.site.groupBy({ by: ["status"], _count: { _all: true }, _sum: { capacityMw: true } }),
    prisma.assessment.groupBy({ by: ["verdict"], _count: { _all: true } }),
    prisma.agentRun.count(),
  ]);
  const byStatus = Object.fromEntries(sites.map((s) => [s.status, { count: s._count._all, mw: s._sum.capacityMw ?? 0 }]));
  const byVerdict = Object.fromEntries(assessments.map((a) => [a.verdict, a._count._all]));
  return { byStatus, byVerdict, runs, totalSites: sites.reduce((a, s) => a + s._count._all, 0), totalMw: sites.reduce((a, s) => a + (s._sum.capacityMw ?? 0), 0) };
}
