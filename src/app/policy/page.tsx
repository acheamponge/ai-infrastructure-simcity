import { siteBundles } from "@/lib/bundles";
import { PolicyBoard } from "@/components/policy-board";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Policy() {
  const sites = await siteBundles();
  if (!sites.length) return <Empty>No estimated sites yet.</Empty>;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Policy view" title="Community and environmental impact" lede="What each facility does to the grid, the water table, the air and the local economy. Filter by country, put a price on carbon, add transmission headroom, or apply the advisor's plans and see the totals and flags move." />
      <PolicyBoard sites={sites} />
    </div>
  );
}
