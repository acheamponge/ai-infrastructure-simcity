import { NextResponse } from "next/server";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { estimate } from "@/lib/model/estimate";
import { normalizeMix } from "@/lib/model/energy";
import { ensureProfile, profileToFactors } from "@/lib/sites";
import type { SiteSpec } from "@/lib/model/types";

/** Create a scenario for a site, or just preview the estimate when `preview` is true. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const site = await prisma.site.findUnique({ where: { id: String(body.siteId ?? "") } });
  if (!site) return NextResponse.json({ error: "site not found" }, { status: 404 });
  const profile = await ensureProfile(site);
  const spec: SiteSpec = {
    itMw: Math.max(1, Number(body.spec?.itMw ?? 100)),
    gpu: body.spec?.gpu ?? "b200",
    densityKw: Number(body.spec?.densityKw ?? 80) as SiteSpec["densityKw"],
    crew: Math.max(50, Number(body.spec?.crew ?? 600)),
    robots: Math.min(1, Math.max(0, Number(body.spec?.robots ?? 0.2))),
  };
  const energyMix = normalizeMix(body.energyMix ?? { grid: 1 });
  const result = estimate(spec, profileToFactors(profile), energyMix);
  if (body.preview) return NextResponse.json({ estimate: result, energyMix, spec });
  const scenario = await prisma.scenario.create({
    data: { siteId: site.id, name: String(body.name ?? "Scenario"), spec: spec as unknown as Prisma.InputJsonValue, energyMix: energyMix as unknown as Prisma.InputJsonValue, estimate: result as unknown as Prisma.InputJsonValue },
  });
  return NextResponse.json({ id: scenario.id, estimate: result });
}
