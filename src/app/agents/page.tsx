import { AgentConsole } from "@/components/agent-console";
import { PageHeader } from "@/components/ui";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";

export default function Agents() {
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Agent console" title="Research and advisory agents" lede={env.agentMode === "live" ? `Research and extraction run on ${env.modelResearch}, the advisor on ${env.modelAdvisor}, both on Crusoe Cloud, with Tavily for web search. Every run is logged with its sources and token use.` : "CRUSOE_API_KEY and TAVILY_API_KEY are not both configured, so agents run in fixture mode: discovery returns sample records, enrichment keeps country priors, and the advisor writes a templated narrative and plan around the deterministic verdict. Add the keys to .env and restart to go live."} />
      <AgentConsole mode={env.agentMode} />
      <div className="grid md:grid-cols-3 gap-4 text-sm">
        {[
          ["Discovery", "Web search over operator newsrooms, utility filings and trade press, then structured extraction. Dedupes by name and country; never overwrites curated entries."],
          ["Enrichment", "Per-site research into power price, grid carbon and headroom, interconnection queues, labor, land, water stress, population and sentiment. Writes sourced values into the region profile and re-estimates every scenario."],
          ["Advisor", "Runs the energy-mix search against the viability floors, fixes the verdict deterministically, then asks the model for the rationale, conditions, risks and a brief per audience. Run it from any site page."],
        ].map(([t, d]) => <div key={t} className="card p-4"><div className="font-semibold mb-1">{t}</div><div className="text-slate-2">{d}</div></div>)}
      </div>
    </div>
  );
}
