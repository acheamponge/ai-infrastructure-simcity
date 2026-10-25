import { NextResponse } from "next/server";
import { runAssessment } from "@/lib/agents/assess";

export const maxDuration = 300;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (!body.scenarioId) return NextResponse.json({ error: "scenarioId is required" }, { status: 400 });
  try {
    const a = await runAssessment(String(body.scenarioId));
    return NextResponse.json({ assessmentId: a.id, verdict: a.verdict, score: a.score });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
