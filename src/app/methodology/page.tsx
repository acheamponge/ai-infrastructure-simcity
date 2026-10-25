import { PageHeader } from "@/components/ui";
import { SOURCES } from "@/lib/model/energy";
import { GPUS, DENSITY } from "@/lib/model/hardware";
import { VIABILITY } from "@/lib/model/optimize";
import { money } from "@/lib/format";

export default function Methodology() {
  return (
    <div className="flex flex-col gap-6 max-w-5xl">
      <PageHeader eyebrow="Methodology" title="How the numbers are made" lede="Everything the dashboards show is produced by a deterministic engine from a small set of documented coefficients. Agents may replace a site's region factors with sourced values; they cannot change the engine or the verdict rule." />
      <section className="card p-5 text-sm leading-relaxed space-y-3">
        <h2 className="font-semibold text-[15px]">Estimate</h2>
        <p><b>Facility.</b> IT load is the input. PUE comes from rack density (air 1.45, 80 kW liquid 1.18, 130 kW liquid 1.12) adjusted +0.15 in hot climates and −0.07 in cold ones. Facility power is IT load times PUE. GPUs per rack use 70% of rack power at the GPU's TDP.</p>
        <p><b>Build.</b> Permitting takes 3 months plus (75 − sentiment)/8, clamped to 2–14, with 2 extra months when a mostly automated crew meets a high-wage labor market. Civil, shell, fit-out and rack phases scale with facility size and are divided by crew speed, which grows with the square root of effective crew and 50% faster with full automation. Power supply runs in parallel from the end of permitting; the longer of the two chains plus 1.5 months of commissioning is the time to live. Capex per facility MW: land $0.25M × land index, civil $1.2M, shell $3.5M, mechanical and electrical $5.5M, commissioning $0.2M, plus the supply capex below, plus racks and GPUs at list.</p>
        <p><b>Operations.</b> Utilization is the blended supply firmness × 0.72, the second factor being the commercial fill rate of a merchant GPU hall. Revenue is GPU count × hours × utilization × GPU-hour rate. Power cost is energy drawn (50% base load plus 50% scaling with utilization) × blended price. Staff is 12 plus one per 12 racks, reduced 65% by automation, at 1.4× the local wage. Maintenance is 1.2% of IT capex. NPV discounts a ten-year flow at 10% with capex split 60/40 over two years, 7% annual price decay per GPU generation, and a year-five refresh costing 70% of GPU capex that resets revenue to 85% of year one.</p>
        <p><b>Environment.</b> CO₂ is energy × blended carbon intensity. Water combines cooling (1.9 L per IT kWh evaporative, 0.6 L liquid) and generation water per source. Grid draw share is the grid portion of facility MW over regional headroom. The environment score weights carbon 45%, water 25%, grid 20%, land 10%.</p>
        <p><b>Community.</b> Local spend is permanent payroll × 1.6 plus 12% of opex; tax is 3% of revenue plus 0.4% of capex per year. Prosperity scales those against the size of the local construction economy. Sentiment shifts with the people share of the crew, the supply mix, water stress and grid draw. Noise and traffic indices grow with the logarithm of facility size and headcount and are weighted by nearby population; nuisance is 50% noise, 30% traffic, 20% land take. Build phases: campuses above 150 MW are modeled as overlapping 150 MW phases staggered four months apart. The community score weights prosperity 45%, sentiment 25%, inverse nuisance 30%.</p>
        <p><b>Composite.</b> 40% economic, 35% environment, 25% community.</p>
      </section>
      <section className="card p-5 text-sm">
        <h2 className="font-semibold text-[15px] mb-2">Viability floors</h2>
        <p className="text-slate-2 mb-3">A scenario is viable only if every floor holds. The advisor searches eleven candidate mixes; a GO needs the proposal itself to be viable with a composite of 60 or more, CONDITIONAL means the proposal or an alternative clears the floors, and NO GO means none did.</p>
        <table className="table max-w-md"><tbody>
          <tr><td>Environment score</td><td className="r">≥ {VIABILITY.minEnvironment}</td></tr>
          <tr><td>Community score</td><td className="r">≥ {VIABILITY.minCommunity}</td></tr>
          <tr><td>Payback</td><td className="r">≤ {VIABILITY.maxPaybackYears} years</td></tr>
          <tr><td>IRR</td><td className="r">≥ {Math.round(VIABILITY.minIrr * 100)}%</td></tr>
          <tr><td>Grid draw vs headroom</td><td className="r">≤ {Math.round(VIABILITY.maxGridLoadShare * 100)}%</td></tr>
        </tbody></table>
      </section>
      <section className="card p-5 text-sm overflow-x-auto">
        <h2 className="font-semibold text-[15px] mb-2">Energy sources</h2>
        <table className="table"><thead><tr><th>Source</th><th className="r">Capex / MW</th><th className="r">Lead</th><th className="r">Water L/kWh</th><th className="r">Land ha/MW</th><th className="r">Noise</th><th>Note</th></tr></thead><tbody>
          {Object.entries(SOURCES).map(([k, s]) => <tr key={k}><td>{s.label}</td><td className="r">{money(s.capexPerMw)}</td><td className="r">{s.leadMonths} mo</td><td className="r">{s.waterLKwh}</td><td className="r">{s.landHaPerMw}</td><td className="r">{s.noise}</td><td className="text-slate-2">{s.note}</td></tr>)}
        </tbody></table>
        <p className="text-xs text-slate-2 mt-2">Grid price, carbon and reliability come from the site's region profile. Geothermal costs $12M/MW with a 26-month lead where no resource is mapped. Hydro capex is 1.6× in high-water-stress regions.</p>
      </section>
      <section className="grid md:grid-cols-2 gap-5 text-sm">
        <div className="card p-5"><h2 className="font-semibold text-[15px] mb-2">Hardware</h2><table className="table"><thead><tr><th>GPU</th><th className="r">W</th><th className="r">Cost</th><th className="r">Rel. perf</th><th className="r">$/GPU-hr</th></tr></thead><tbody>{Object.values(GPUS).map((g) => <tr key={g.label}><td>{g.label}</td><td className="r">{g.watts}</td><td className="r">{money(g.costUsd)}</td><td className="r">{g.perf}</td><td className="r">{g.rateUsdHr.toFixed(2)}</td></tr>)}</tbody></table></div>
        <div className="card p-5"><h2 className="font-semibold text-[15px] mb-2">Rack density</h2><table className="table"><thead><tr><th>Option</th><th>Cooling</th><th className="r">Base PUE</th></tr></thead><tbody>{Object.values(DENSITY).map((d) => <tr key={d.label}><td>{d.label}</td><td>{d.cooling}</td><td className="r">{d.basePue}</td></tr>)}</tbody></table></div>
      </section>
      <section className="card p-5 text-sm leading-relaxed">
        <h2 className="font-semibold text-[15px] mb-2">Data provenance</h2>
        <p>Curated sites are entered from public reporting with the operator's own announcements as the primary source; their figures are approximate and marked with a confidence below 0.8. Discovered sites carry the URLs the agent relied on. Region profiles start from country priors (and US state overrides) and are replaced by sourced values when the enrich agent runs; the profile card on each site page states which it is. Nothing here constitutes engineering, legal or investment advice.</p>
      </section>
    </div>
  );
}
