// Recompute every scenario's estimate after a model change.
import { PrismaClient } from "@prisma/client";
import { reestimateSite } from "../src/lib/sites";

const prisma = new PrismaClient();
async function main() {
  const sites = await prisma.site.findMany({ select: { id: true } });
  for (const s of sites) await reestimateSite(s.id);
  console.log(`re-estimated ${sites.length} sites`);
}
main().finally(() => prisma.$disconnect());
