import { prisma } from "@/lib/db";
import { siteBundles } from "@/lib/bundles";
import { ExecBoard } from "@/components/exec-board";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Executive() {
  const sites = await siteBundles();
  if (!sites.length) return <Empty>No estimated sites yet. Seed the registry or run discovery.</Empty>;
  const conds = await prisma.assessment.findMany({ where: { verdict: "CONDITIONAL" }, orderBy: { createdAt: "desc" }, take: 10, include: { scenario: { include: { site: { select: { id: true, name: true } } } } } });
  const conditions = conds.map((c) => ({ id: c.id, siteId: c.scenario.site.id, siteName: c.scenario.site.name, conditions: c.conditions as string[] }));
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Executive view" title="Portfolio and pipeline" lede="Baseline estimates for every tracked site under its reported supply mix. Push the crew, automation and hardware decisions across the whole portfolio and watch schedule, capex and payback move. Conditions come from the advisor's latest verdicts." />
      <ExecBoard sites={sites} conditions={conditions} />
    </div>
  );
}
