import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(100, Number(url.searchParams.get("limit") ?? 30));
  const runs = await prisma.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: limit });
  return NextResponse.json(runs);
}
