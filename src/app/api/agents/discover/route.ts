import { NextResponse } from "next/server";
import { runDiscovery } from "@/lib/agents/discover";

export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const query = String(body.query ?? "").trim();
  if (!query) return NextResponse.json({ error: "query is required" }, { status: 400 });
  try {
    const result = await runDiscovery(query, Number(body.limit ?? 12));
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
