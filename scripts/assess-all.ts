// Run the advisor on every baseline scenario (fixture narrative when no key is set).
import { PrismaClient } from "@prisma/client";
import { runAssessment } from "../src/lib/agents/assess";

const prisma = new PrismaClient();
async function main() {
  const baselines = await prisma.scenario.findMany({ where: { isBaseline: true }, include: { site: { select: { name: true } } } });
  const tally: Record<string, number> = {};
  for (const s of baselines) {
    const a = await runAssessment(s.id);
    tally[a.verdict] = (tally[a.verdict] ?? 0) + 1;
    console.log(`${a.verdict.padEnd(12)} ${String(Math.round(a.score)).padStart(3)}  ${s.site.name}`);
  }
  console.log(JSON.stringify(tally));
}
main().finally(() => prisma.$disconnect());
