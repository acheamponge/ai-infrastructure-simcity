// Tavily web search. One POST per query; results carry title, url and a content snippet.
import { env } from "../env";

export interface SearchHit { title: string; url: string; content: string; score?: number; published?: string | null }

export async function tavilySearch(query: string, opts: { maxResults?: number; depth?: "basic" | "advanced"; days?: number } = {}): Promise<SearchHit[]> {
  const r = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.tavilyKey}` },
    body: JSON.stringify({ query, max_results: opts.maxResults ?? 8, search_depth: opts.depth ?? "advanced", include_answer: false, ...(opts.days ? { days: opts.days, topic: "news" } : {}) }),
  });
  if (!r.ok) throw new Error(`Tavily ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { results?: Array<{ title: string; url: string; content: string; score?: number; published_date?: string }> };
  return (j.results ?? []).map((x) => ({ title: x.title, url: x.url, content: x.content, score: x.score, published: x.published_date ?? null }));
}
