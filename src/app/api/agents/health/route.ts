import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { searchWeb } from "@/lib/search/web";

/** Reports whether each inference provider and the search service accept the configured credentials. Keys are never returned. */
export async function GET(req: Request) {
  // ?search=<query> runs one web search through the agents' helper and reports which engine answered
  const q = new URL(req.url).searchParams.get("search");
  if (q) { try { const t0 = Date.now(); const r = await searchWeb(q, { maxResults: 5 }); return NextResponse.json({ query: q, engine: r.engine, note: r.note, tookMs: Date.now() - t0, hits: r.hits.map((h) => ({ title: h.title, url: h.url, snippet: h.content.slice(0, 160) })) }); } catch (e) { return NextResponse.json({ query: q, error: e instanceof Error ? e.message : String(e) }, { status: 502 }); } }
  const fingerprint = (k: string) => (k ? `${k.length} chars, starts "${k.slice(0, 4)}…"` : "not set");
  const probe = async (baseUrl: string, key: string, model: string) => {
    try {
      const r = await fetch(`${baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ model, messages: [{ role: "user", content: "Reply with the single word pong." }], max_tokens: 8 }) });
      const text = await r.text();
      if (!r.ok) return { status: `HTTP ${r.status}: ${text.slice(0, 200)}` };
      const j = JSON.parse(text) as { choices?: Array<{ message?: { content?: string } }>; model?: string };
      return { status: "ok", model: j.model ?? model, reply: (j.choices?.[0]?.message?.content ?? "").trim().slice(0, 40) };
    } catch (e) { return { status: `unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  };
  const meta: Record<string, unknown> = { configured: !!env.meta.key, baseUrl: env.meta.baseUrl, key: fingerprint(env.meta.key), keySource: env.metaKeySource, models: { research: env.meta.modelResearch, advisor: env.meta.modelAdvisor, planner: env.meta.modelPlanner, sam: env.meta.samModel } };
  if (env.meta.key) meta.chat = await probe(env.meta.baseUrl, env.meta.key, env.meta.modelPlanner);
  const crusoe: Record<string, unknown> = { configured: !!env.crusoeKey, baseUrl: env.crusoeBaseUrl, key: fingerprint(env.crusoeKey), keySource: env.crusoeKeySource, hints: { research: env.modelResearch, advisor: env.modelAdvisor } };
  if (env.crusoeKey) {
    try {
      const r = await fetch(`${env.crusoeBaseUrl}/models`, { headers: { authorization: `Bearer ${env.crusoeKey}` } });
      const text = await r.text();
      if (r.ok) { const ids = ((JSON.parse(text) as { data?: Array<{ id: string }> }).data ?? []).map((m) => m.id); const pick = (h: string) => ids.find((id) => id.toLowerCase().includes(h.toLowerCase())) ?? null; crusoe.models = { status: "ok", ids, resolved: { research: pick(env.modelResearch), advisor: pick(env.modelAdvisor) } }; }
      else crusoe.models = { status: `HTTP ${r.status}: ${text.slice(0, 200)}` };
    } catch (e) { crusoe.models = { status: `unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  }
  const tavily: Record<string, unknown> = { key: fingerprint(env.tavilyKey) };
  try {
    const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.tavilyKey}` }, body: JSON.stringify({ query: "data center", max_results: 1 }) });
    tavily.status = r.ok ? "ok" : `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
  } catch (e) { tavily.status = `unreachable: ${e instanceof Error ? e.message : String(e)}`; }
  return NextResponse.json({ mode: env.agentMode, primary: env.llmProvider, fallback: env.llmProvider === "meta" ? (env.crusoeKey ? "crusoe" : null) : env.meta.key ? "meta" : null, meta, crusoe, tavily });
}
