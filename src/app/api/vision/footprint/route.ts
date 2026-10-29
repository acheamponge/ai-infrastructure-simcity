import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { footprintCheck, type FootprintResult } from "@/lib/vision/sam";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const cache = new Map<string, FootprintResult>();

/** GET ?site=<id>&concept=building&span=1400 — segments the site's satellite view with SAM 3.1 and sizes the buildings. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const siteId = u.searchParams.get("site"); const concept = u.searchParams.get("concept") ?? "building"; const spanM = Math.min(4000, Math.max(400, Number(u.searchParams.get("span") ?? 1400)));
  if (!siteId) return NextResponse.json({ error: "site is required" }, { status: 400 });
  const site = await prisma.site.findUnique({ where: { id: siteId } });
  if (!site) return NextResponse.json({ error: "unknown site" }, { status: 404 });
  const key = `${siteId}:${concept}:${spanM}`;
  if (!u.searchParams.has("fresh") && cache.has(key)) return NextResponse.json({ ...cache.get(key)!, cached: true });
  try {
    const result = await footprintCheck(site.lat, site.lon, { concept, spanM });
    cache.set(key, result);
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
