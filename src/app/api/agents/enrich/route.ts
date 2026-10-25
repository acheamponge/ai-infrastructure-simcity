import { NextResponse } from "next/server";
import { runEnrich } from "@/lib/agents/enrich";

export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body.siteId) return NextResponse.json({ error: "siteId is required" }, { status: 400 });
  try {
    return NextResponse.json(await runEnrich(String(body.siteId)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
