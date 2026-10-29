import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { measureSite } from "@/lib/vision/sam";
import { reestimateSite } from "@/lib/sites";
import type { EstimateResult } from "@/lib/model/types";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/** POST { siteId, spanM? } — measures the site with SAM 3.1, stores the result on its profile, re-estimates every scenario,
 *  and returns the measurement with the baseline composite before and after so the change is visible. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { siteId?: string; spanM?: number; debug?: boolean; clear?: boolean; concepts?: string[] };
  if (!body.siteId) return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  const site = await prisma.site.findUnique({ where: { id: body.siteId }, include: { profile: true, scenarios: { where: { isBaseline: true } } } });
  if (!site || !site.profile) return NextResponse.json({ error: "unknown site or no profile" }, { status: 404 });
  const before = site.scenarios[0]?.estimate as unknown as EstimateResult | undefined;
  if (body.clear) {
    await prisma.regionProfile.update({ where: { siteId: site.id }, data: { measuredBuiltHa: null, measuredOpenHa: null, measuredWaterHa: null, measuredWaterNearM: null, measuredSolarHa: null, measuredSpanM: null, measuredBy: null, measuredAt: null } });
    await reestimateSite(site.id);
    return NextResponse.json({ cleared: true });
  }
  try {
    const m = await measureSite(site.lat, site.lon, { spanM: Math.min(4000, Math.max(400, body.spanM ?? 1400)), debug: !!body.debug, concepts: body.debug && Array.isArray(body.concepts) ? body.concepts.slice(0, 12) : undefined });
    if (body.debug) return NextResponse.json({ debug: m.layers.map((l) => ({ key: l.key, concept: l.concept, count: l.count, areaHa: +(l.areaM2 / 1e4).toFixed(2), nearestM: l.nearestM, error: l.error, objects: l.objects.slice(0, 3).map((o) => ({ id: o.id, box: o.box, maskW: o.maskW, maskH: o.maskH, areaM2: Math.round(o.areaM2), conf: o.confidence, offset: o.offset })), ...(l.debug as Record<string, unknown>) })), summary: m.summary, tookMs: m.tookMs });
    const prev = (site.profile.sources as Array<{ title: string; url: string }>) ?? [];
    const sources = prev.some((s) => s.title.startsWith(m.model)) ? prev : [...prev, { title: `${m.model} segmentation of Esri World Imagery`, url: "https://dev.meta.ai/docs/sam/overview" }];
    await prisma.regionProfile.update({ where: { siteId: site.id }, data: { measuredBuiltHa: m.summary.builtHa, measuredOpenHa: m.summary.openHa, measuredWaterHa: m.summary.waterHa, measuredWaterNearM: m.summary.waterNearM, measuredSolarHa: m.summary.solarHa, measuredSpanM: m.spanM, measuredBy: m.model, measuredAt: new Date(), sources } });
    await reestimateSite(site.id);
    const afterRow = await prisma.scenario.findFirst({ where: { siteId: site.id, isBaseline: true } });
    const after = afterRow?.estimate as unknown as EstimateResult | undefined;
    const pick = (e?: EstimateResult) => (e ? { composite: e.scores.composite, environment: e.scores.environment, economic: e.scores.economic, community: e.scores.community, capexUsd: e.build.capexUsd, flags: e.flags } : null);
    return NextResponse.json({ measurement: m, before: pick(before), after: pick(after) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
