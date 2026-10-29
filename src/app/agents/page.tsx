import { AgentConsole } from "@/components/agent-console";
import { Lead, PageHeader } from "@/components/ui";
import { env } from "@/lib/env";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function Agents() {
  const runs = await prisma.agentRun.findMany({ orderBy: { startedAt: "desc" }, take: 200 });
  const last = runs[0]; const dayAgo = Date.now() - 86400e3;
  const today = runs.filter((r) => r.startedAt.getTime() > dayAgo);
  const tokens = today.reduce((a, r) => a + (r.tokensIn ?? 0) + (r.tokensOut ?? 0), 0);
  const input = (last?.input ?? {}) as Record<string, unknown>;
  const what = last ? `${last.kind.toLowerCase()} · ${String(input.site ?? input.query ?? input.scenario ?? "")}` : "";
  return (
    <div className="flex flex-col gap-5">
      <PageHeader eyebrow="Agent console" title="Research and advisory agents" lede={env.agentMode === "live" ? (env.llmProvider === "meta" ? `Research, extraction and the advisor run on Meta's Muse Spark (${env.meta.modelResearch}), with Crusoe managed inference${env.crusoeKey ? " standing by as the fallback" : " not configured"}. SAM 3.1 measures each enriched site from satellite imagery, and Tavily runs the web searches. Every run is logged with its sources, model and token use.` : `Research and extraction run on ${env.modelResearch} and the advisor on ${env.modelAdvisor}, both on Crusoe managed inference, with Tavily for web search. Every run is logged with its sources and token use.`) : "No inference key is configured (MODEL_API_KEY_MUSE or CRUSOE_API_KEY) or TAVILY_API_KEY is missing, so agents run in fixture mode: discovery returns sample records, enrichment keeps country priors, and the advisor writes a templated narrative and plan around the deterministic verdict. Add the keys to .env and restart to go live."} />
      {last && <Lead tone="violet" eyebrow="Latest run" title={what} stats={[{ l: "Runs today", v: String(today.length) }, { l: "Succeeded", v: String(today.filter((r) => r.status === "SUCCEEDED").length) }, { l: "Tokens today", v: tokens.toLocaleString() }]} note={<>{last.status.toLowerCase()} on {last.model ?? "unknown model"} at {last.startedAt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}{last.finishedAt ? `, ${Math.round((last.finishedAt.getTime() - last.startedAt.getTime()) / 1000)} s` : ""}. {runs.length} runs on record; every one keeps its sources, model and token use.</>} />}
      <AgentConsole mode={env.agentMode} />
      <div className="grid md:grid-cols-2 xl:grid-cols-4 gap-4 text-sm">
        {[
          ["Discovery", "Web search over operator newsrooms, utility filings and trade press, then structured extraction. Dedupes by name and country; never overwrites curated entries."],
          ["Enrichment", "Per-site research into power price, grid carbon and headroom, interconnection queues, labor, land, water stress, population and sentiment, written into the region profile with sources. Then SAM 3.1 looks at the site from above and measures its open land, buildings, water and solar, which replace the priors in every estimate."],
          ["Advisor", "Runs the energy-mix search against the viability floors, fixes the verdict deterministically, then asks the model for the rationale, conditions, risks and a brief per audience. Run it from any site page."],
          ["Planner", "A conversation over the same engine, on the simulation page. Describe a facility and a place; the model looks the place up, estimates it, compares power mixes and hands back a plan you can build in the 3D world."],
        ].map(([t, d]) => <div key={t} className="card p-4"><div className="font-semibold mb-1">{t}</div><div className="text-slate-2">{d}</div></div>)}
      </div>
    </div>
  );
}
