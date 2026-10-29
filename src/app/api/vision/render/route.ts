import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { conceptRender, type RenderInput } from "@/lib/vision/render";
import { profileToFactors } from "@/lib/sites";
import { estimate } from "@/lib/model/estimate";
import type { EnergyMix, SiteSpec } from "@/lib/model/types";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/** GET ?site=<id> streams the stored concept image as JPEG.
 *  POST { siteId } renders and stores a concept image for a tracked site.
 *  POST { place, country, climate, spec, mix } renders one for a planner plan without storing it. */
export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get("site");
  if (!id) return NextResponse.json({ error: "site is required" }, { status: 400 });
  const site = await prisma.site.findUnique({ where: { id }, select: { conceptImage: true, updatedAt: true } });
  if (!site?.conceptImage) return NextResponse.json({ error: "no concept render stored" }, { status: 404 });
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(site.conceptImage);
  if (!m) return NextResponse.redirect(site.conceptImage);
  return new Response(Buffer.from(m[2], "base64"), { headers: { "content-type": m[1], "cache-control": "public, max-age=31536000, immutable" } });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { siteId?: string; place?: string; country?: string; climate?: RenderInput["climate"]; spec?: SiteSpec; mix?: EnergyMix; fresh?: boolean };
  try {
    if (body.siteId) {
      const site = await prisma.site.findUnique({ where: { id: body.siteId }, include: { profile: true, scenarios: { where: { isBaseline: true } } } });
      if (!site || !site.profile || !site.scenarios[0]) return NextResponse.json({ error: "unknown site or no baseline" }, { status: 404 });
      if (site.conceptImage && !body.fresh) return NextResponse.json({ image: `/api/vision/render?site=${site.id}&v=${site.updatedAt.getTime()}`, prompt: site.conceptPrompt, cached: true });
      const p = site.profile, spec = site.scenarios[0].spec as unknown as SiteSpec, mix = site.scenarios[0].energyMix as unknown as EnergyMix;
      const e = estimate(spec, profileToFactors(p), mix);
      const r = await conceptRender({ place: [site.city, site.region].filter(Boolean).join(", ") || site.name, country: site.country, climate: p.climate as RenderInput["climate"], spec, mix, facilityMw: e.facility.facilityMw, racks: e.facility.racks, status: site.status, measured: p.measuredBy ? { waterHa: p.measuredWaterHa ?? 0, waterNearM: p.measuredWaterNearM ?? null, solarHa: p.measuredSolarHa ?? 0, openHa: p.measuredOpenHa ?? 0, builtHa: p.measuredBuiltHa ?? 0 } : null });
      const updated = await prisma.site.update({ where: { id: site.id }, data: { conceptImage: r.image, conceptPrompt: r.prompt }, select: { updatedAt: true } });
      return NextResponse.json({ image: `/api/vision/render?site=${site.id}&v=${updated.updatedAt.getTime()}`, prompt: r.prompt, model: r.model, tookMs: r.tookMs });
    }
    if (body.place && body.spec && body.mix) {
      const e = estimate(body.spec, { powerPriceKwh: .06, gridCarbonG: 300, gridLeadMonths: 18, gridHeadroomMw: 1000, gridReliability: .95, laborPool: 10000, wageUsdH: 30, landIndex: 1, sentiment: 60, climate: body.climate ?? "temperate", waterStress: "medium", solar: .6, wind: .5, geothermal: false, flareGas: false }, body.mix);
      const r = await conceptRender({ place: body.place, country: body.country ?? "", climate: body.climate ?? "temperate", spec: body.spec, mix: body.mix, facilityMw: e.facility.facilityMw, racks: e.facility.racks, status: "PLANNED" });
      return NextResponse.json({ image: r.image, prompt: r.prompt, model: r.model, tookMs: r.tookMs });
    }
    return NextResponse.json({ error: "siteId, or place with spec and mix, is required" }, { status: 400 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
