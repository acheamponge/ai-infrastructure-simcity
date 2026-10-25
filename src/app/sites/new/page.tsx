import { SiteForm } from "@/components/site-form";
import { PageHeader } from "@/components/ui";
import { COUNTRY_PRIORS } from "@/lib/model/regions";

export default function NewSite() {
  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Registry" title="Register a proposed site" lede="Enter a site the agents have not found, or a greenfield proposal you want assessed. Coordinates can be the nearest town." />
      <SiteForm countries={Object.keys(COUNTRY_PRIORS).sort()} />
    </div>
  );
}
