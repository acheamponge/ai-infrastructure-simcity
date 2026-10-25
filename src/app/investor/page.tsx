import { siteBundles } from "@/lib/bundles";
import { InvestorBoard } from "@/components/investor-board";
import { PageHeader, Empty } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Investor() {
  const sites = await siteBundles();
  if (!sites.length) return <Empty>No estimated sites yet.</Empty>;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Investor view" title="Risk-adjusted pipeline" lede="Sites ranked by IRR under a ten-year cash flow with a GPU refresh in year five. Stress power prices, supply firmness, GPU-hour rates and the discount rate, or swap in the advisor's plans; every row recomputes as you move the sliders. The verdict column is the advisor's, not the model's." />
      <InvestorBoard sites={sites} />
    </div>
  );
}
