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
      <section className="relative grid lg:grid-cols-[1.4fr_1fr] gap-6 items-end rise">
        <div className="absolute -inset-x-6 -top-10 h-56 rounded-[40px] bg-[radial-gradient(60%_80%_at_20%_0%,rgba(63,216,198,.14),transparent_70%)] pointer-events-none" aria-hidden />
        <div className="relative">
          <div className="eyebrow eyebrow-dot mb-3">AI Infrastructure SimCity · live registry · playable world</div>
          <h1 className="text-[30px] md:text-[40px] font-semibold leading-[1.08] max-w-2xl hero-title">Every data center that exists or is coming, what it will cost and emit, whether it should be built, and a simulation to build it in.</h1>
          <p className="text-sm text-slate-2 mt-3 max-w-2xl leading-relaxed">Research agents keep a registry of current and announced facilities from public sources. An estimation engine turns each one into economics, environmental footprint and community impact. An advisor searches energy mixes, issues a go, conditional or no-go verdict, and writes a build plan you can play through in the simulation.</p>
          <div className="flex flex-wrap gap-2 mt-5"><Link href="/" className="btn btn-primary">Open the simulation</Link><Link href="/atlas" className="btn">Browse the atlas</Link><Link href="/agents" className="btn">Run the agents</Link></div>
        </div>
        <div className="grid grid-cols-2 gap-3 rise rise-2">
          <Kpi label="Sites tracked" value={num(h.totalSites)} sub={`${num(h.totalMw)} MW at full build-out`} />
          <Kpi label="Operational" value={num(h.byStatus.OPERATIONAL?.count ?? 0)} sub={`${num(h.byStatus.OPERATIONAL?.mw ?? 0)} MW`} />
          <Kpi label="In pipeline" value={num((h.byStatus.CONSTRUCTION?.count ?? 0) + (h.byStatus.PLANNED?.count ?? 0) + (h.byStatus.PROPOSED?.count ?? 0))} sub={`${num((h.byStatus.CONSTRUCTION?.mw ?? 0) + (h.byStatus.PLANNED?.mw ?? 0) + (h.byStatus.PROPOSED?.mw ?? 0))} MW`} />
          <Kpi label="Verdicts" value={`${h.byVerdict.GO ?? 0} / ${h.byVerdict.CONDITIONAL ?? 0} / ${h.byVerdict.NO_GO ?? 0}`} sub="go / conditional / no go" />
        </div>
      </section>
      <section className="grid md:grid-cols-3 gap-4 rise rise-3">
        {personas.map((p, i) => (
          <Link key={p.href} href={p.href} className={`card card-hover card-accent ${i === 1 ? "card-amber" : i === 2 ? "card-violet" : ""} p-5`}>
            <div className="eyebrow mb-1">For the</div>
            <div className="text-xl font-semibold font-display">{p.title}</div>
            <p className="text-sm text-slate-2 mt-1.5 leading-relaxed">{p.lede}</p>
            <ul className="text-xs text-slate-2 mt-3 space-y-1">{p.items.map((i) => <li key={i} className="flex gap-2"><span className="text-accent">▸</span>{i}</li>)}</ul>
            <div className="text-[12px] text-accent mt-4">Open the board →</div>
          </Link>
        ))}
      </section>
      <section className="grid lg:grid-cols-[1fr_1fr] gap-6 rise rise-4">
        <div className="card overflow-hidden">
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
              ["Discover", "Muse Spark plans web searches, Tavily runs them, and the model extracts name, operator, location, status, capacity, energy supply and sources."],
              ["Enrich", "The same pair establishes the local factors: power price, grid carbon and headroom, interconnection lead time, labor, water stress, population, sentiment and any moratorium. Then SAM 3.1 looks at the site from above and measures its land, water and solar."],
              ["Estimate", "A deterministic engine computes capex, schedule, revenue, carbon, water, grid share, jobs, tax base and nuisance for a hardware spec and an energy mix. Change the mix and it recomputes."],
              ["Advise", "The engine searches alternative mixes against hard floors and fixes the verdict. Muse writes the rationale, conditions, risks, a brief per audience, and a build plan that opens in the simulation. Crusoe managed inference stands in when Muse is unavailable."],
            ].map(([t, d], i) => (
              <li key={t} className="flex gap-3"><span className="num w-6 h-6 rounded-full bg-gradient-to-br from-accent/30 to-accent/5 border border-accent/40 text-teal text-[11px] grid place-items-center shrink-0 mt-0.5">{i + 1}</span><div><b>{t}.</b> <span className="text-slate-2">{d}</span></div></li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
