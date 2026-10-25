import Link from "next/link";
import { headline, siteRows } from "@/lib/queries";
import { Kpi, SiteLink, StatusPill, VerdictPill } from "@/components/ui";
import { money, num } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Overview() {
  const [h, rows] = await Promise.all([headline(), siteRows()]);
  const recent = rows.slice().sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()).slice(0, 8);
  const personas = [
    { href: "/executive", title: "Executive", lede: "Where to build next, what it costs, how long until first revenue, and which sites the advisor would not sign off on.", items: ["Portfolio capex and payback", "Critical path by site", "Open conditions"] },
    { href: "/policy", title: "Policy maker", lede: "What each facility does to the grid, the water table, the air, and the local economy, and whether the operator has a viable path.", items: ["Jobs, tax base, local spend", "Carbon, water, grid share", "Nuisance and sentiment"] },
    { href: "/investor", title: "Investor", lede: "Risk-adjusted ranking of the pipeline with live sensitivity to power prices and utilization, and the verdict behind each number.", items: ["IRR, NPV, payback", "Price and utilization sliders", "Go / no-go with conditions"] },
  ];
  return (
    <div className="flex flex-col gap-8">
      <section className="grid lg:grid-cols-[1.4fr_1fr] gap-6 items-end">
        <div>
          <div className="eyebrow mb-2">AI Infrastructure SimCity</div>
          <h1 className="text-3xl font-semibold leading-tight max-w-2xl">Every data center that exists or is coming, what it will cost and emit, whether it should be built, and a simulation to build it in.</h1>
          <p className="text-sm text-slate-2 mt-3 max-w-2xl leading-relaxed">Research agents keep a registry of current and announced facilities from public sources. An estimation engine turns each one into economics, environmental footprint and community impact. An advisor searches energy mixes, issues a go, conditional or no-go verdict, and writes a build plan you can play through in the simulation.</p>
          <div className="flex gap-2 mt-4"><Link href="/" className="btn btn-primary">Open the simulation</Link><Link href="/atlas" className="btn">Browse the atlas</Link><Link href="/agents" className="btn">Run the agents</Link></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Kpi label="Sites tracked" value={num(h.totalSites)} sub={`${num(h.totalMw)} MW at full build-out`} />
          <Kpi label="Operational" value={num(h.byStatus.OPERATIONAL?.count ?? 0)} sub={`${num(h.byStatus.OPERATIONAL?.mw ?? 0)} MW`} />
          <Kpi label="In pipeline" value={num((h.byStatus.CONSTRUCTION?.count ?? 0) + (h.byStatus.PLANNED?.count ?? 0) + (h.byStatus.PROPOSED?.count ?? 0))} sub={`${num((h.byStatus.CONSTRUCTION?.mw ?? 0) + (h.byStatus.PLANNED?.mw ?? 0) + (h.byStatus.PROPOSED?.mw ?? 0))} MW`} />
          <Kpi label="Verdicts" value={`${h.byVerdict.GO ?? 0} / ${h.byVerdict.CONDITIONAL ?? 0} / ${h.byVerdict.NO_GO ?? 0}`} sub="go / conditional / no go" />
        </div>
      </section>
      <section className="grid md:grid-cols-3 gap-4">
        {personas.map((p) => (
          <Link key={p.href} href={p.href} className="card p-5 hover:border-accent/50 transition-colors">
            <div className="eyebrow mb-1">For the</div>
            <div className="text-lg font-semibold">{p.title}</div>
            <p className="text-sm text-slate-2 mt-1.5 leading-relaxed">{p.lede}</p>
            <ul className="text-xs text-slate-2 mt-3 space-y-1">{p.items.map((i) => <li key={i}>· {i}</li>)}</ul>
          </Link>
        ))}
      </section>
      <section className="grid lg:grid-cols-[1fr_1fr] gap-6">
        <div className="card">
          <div className="px-4 py-3 border-b border-line flex items-center justify-between"><div className="eyebrow">Recently updated sites</div><Link href="/atlas" className="text-xs text-accent hover:underline">All sites</Link></div>
          <table className="table">
            <thead><tr><th>Site</th><th>Status</th><th className="r">MW</th><th className="r">Capex</th><th>Verdict</th></tr></thead>
            <tbody>
              {recent.map((r) => (
                <tr key={r.id}><td><SiteLink id={r.id} name={r.name} /><div className="text-[11px] text-slate-2">{[r.city, r.region, r.country].filter(Boolean).join(", ")}</div></td><td><StatusPill status={r.status} /></td><td className="r">{num(r.capacityMw)}</td><td className="r">{money(r.estimate?.build.capexUsd)}</td><td><VerdictPill verdict={r.verdict} /></td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card p-5">
          <div className="eyebrow mb-2">How a verdict is produced</div>
          <ol className="text-sm space-y-3">
            {[
              ["Discover", "Kimi plans web searches, Tavily runs them, and the model extracts name, operator, location, status, capacity, energy supply and sources."],
              ["Enrich", "The same pair establishes the local factors: power price, grid carbon and headroom, interconnection lead time, labor, land, water stress, nearby population, sentiment and any moratorium."],
              ["Estimate", "A deterministic engine computes capex, schedule, revenue, carbon, water, grid share, jobs, tax base and nuisance for a hardware spec and an energy mix. Change the mix and it recomputes."],
              ["Advise", "The engine searches alternative mixes against hard floors and fixes the verdict. GLM 5.3 writes the rationale, conditions, risks, a brief per audience, and a build plan that opens in the simulation."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3"><span className="num w-5 h-5 rounded-full bg-navy text-white text-[11px] grid place-items-center shrink-0 mt-0.5">{i + 1}</span><div><b>{t}.</b> <span className="text-slate-2">{d}</span></div></li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
