import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { ensureBaseline, ensureProfile } from "@/lib/sites";

export async function GET() {
  const sites = await prisma.site.findMany({ orderBy: { updatedAt: "desc" }, include: { profile: true, scenarios: { where: { isBaseline: true } } } });
  return NextResponse.json(sites);
}

/** Register a proposed site by hand. */
export async function POST(req: Request) {
  const b = await req.json().catch(() => ({}));
  if (!b.name || !b.country || b.lat == null || b.lon == null) return NextResponse.json({ error: "name, country, lat and lon are required" }, { status: 400 });
  const site = await prisma.site.create({
    data: {
      name: String(b.name), operator: b.operator ?? null, country: String(b.country), region: b.region ?? null, city: b.city ?? null,
      lat: Number(b.lat), lon: Number(b.lon), status: b.status ?? "PROPOSED", capacityMw: b.capacityMw != null ? Number(b.capacityMw) : null,
      energyNotes: b.energyNotes ?? null, description: b.description ?? "Entered manually.", confidence: 0.4, sources: [],
    },
  });
  await ensureProfile(site);
  await ensureBaseline(site);
  return NextResponse.json({ id: site.id });
}
