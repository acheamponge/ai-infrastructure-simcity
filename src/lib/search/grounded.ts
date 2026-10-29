// Search grounding on the Meta Model API: Muse Spark runs the web search itself through the Responses API and
// returns the sources it considered and the ones it cited. We turn both into the same SearchHit shape Tavily gives.
import { env } from "../env";
import type { SearchHit } from "./tavily";

interface Citation { type: string; url?: string; title?: string }
interface OutputItem { type: string; status?: string; results?: Array<{ type?: string; title?: string; url?: string; snippet?: string }>; content?: Array<{ type: string; text?: string; annotations?: Citation[] }> }

export interface GroundedResult { hits: SearchHit[]; text: string; searched: boolean; model: string }

/** Ask Muse to search the web for a query and return every source it looked at, cited ones first. */
export async function groundedSearch(query: string, opts: { maxResults?: number; context?: "low" | "medium" | "high"; model?: string } = {}): Promise<GroundedResult> {
  if (!env.meta.key) throw new Error("MODEL_API_KEY_MUSE is not set; search grounding runs on the Meta Model API");
  const model = opts.model ?? env.meta.modelResearch;
  const r = await fetch(`${env.meta.baseUrl}/responses`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.meta.key}` },
    body: JSON.stringify({
      model, tools: [{ type: "web_search", search_context_size: opts.context ?? "medium" }], include: ["web_search_call.results"], stream: false,
      input: `Search the web for: ${query}\nSummarize what the sources say in under 150 words and cite them. Prefer primary sources: operator announcements, utility and regulator filings, planning records, statistical agencies, established trade press.`,
    }),
  });
  if (!r.ok) throw new Error(`grounded search ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { output?: OutputItem[]; model?: string };
  const out = j.output ?? [];
  const searched = out.some((o) => o.type === "web_search_call");
  const seen = new Map<string, SearchHit>();
  // cited sources first: they are the ones the model stood behind
  let text = "";
  for (const o of out) if (o.type === "message") for (const c of o.content ?? []) if (c.type === "output_text") { text += (c.text ?? "") + "\n"; for (const a of c.annotations ?? []) if (a.type === "url_citation" && a.url && !seen.has(a.url)) seen.set(a.url, { title: a.title ?? a.url, url: a.url, content: "" }); }
  for (const o of out) if (o.type === "web_search_call") for (const s of o.results ?? []) if (s.url) { const prev = seen.get(s.url); if (prev) { if (!prev.content) prev.content = s.snippet ?? ""; if (!prev.title || prev.title === s.url) prev.title = s.title ?? prev.title; } else seen.set(s.url, { title: s.title ?? s.url, url: s.url, content: s.snippet ?? "" }); }
  // sources with no snippet take the model's own summary as their content, so the digest still has something to extract from
  const hits = [...seen.values()].map((h) => ({ ...h, content: h.content || text.trim().slice(0, 600) })).slice(0, opts.maxResults ?? 6);
  return { hits, text: text.trim(), searched, model: j.model ?? model };
}
