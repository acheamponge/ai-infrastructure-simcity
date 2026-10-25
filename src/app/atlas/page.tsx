import Link from "next/link";
import { siteBundles } from "@/lib/bundles";
import { AtlasExplorer } from "@/components/atlas-explorer";
import { PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function Atlas() {
  const sites = await siteBundles();
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Registry" title="Global atlas" lede="Every tracked site. Filters apply to the map and the table together; click a header to sort, a row for the dossier, or Simulate to build it in the game." action={<div className="flex gap-2"><Link href="/sites/new" className="btn">Register a site</Link><Link href="/agents" className="btn btn-primary">Discover more</Link></div>} />
      <AtlasExplorer sites={sites} />
    </div>
  );
}
