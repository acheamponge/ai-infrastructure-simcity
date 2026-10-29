// One search call for every agent: Meta search grounding first when a Meta key exists, Tavily as the fallback,
// and Tavily alone when there is no Meta key. Each result says which engine answered, so runs can log it.
import { env } from "../env";
import { groundedSearch } from "./grounded";
import { tavilySearch, type SearchHit } from "./tavily";

export type SearchEngine = "grounding" | "tavily";
export interface WebSearchResult { hits: SearchHit[]; engine: SearchEngine; note?: string }

export async function searchWeb(query: string, opts: { maxResults?: number; days?: number } = {}): Promise<WebSearchResult> {
  const max = opts.maxResults ?? 6;
  if (env.meta.key) {
    try {
      const g = await groundedSearch(query, { maxResults: max });
      if (g.hits.length) return { hits: g.hits, engine: "grounding" };
      if (!env.tavilyKey) return { hits: [], engine: "grounding", note: g.searched ? "grounded search ran but returned no sources" : "the model chose not to search" };
    } catch (e) {
      if (!env.tavilyKey) throw e;
      return { hits: await tavilySearch(query, { maxResults: max, days: opts.days }), engine: "tavily", note: `grounding failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
    }
    return { hits: await tavilySearch(query, { maxResults: max, days: opts.days }), engine: "tavily", note: "grounding returned nothing" };
  }
  if (!env.tavilyKey) throw new Error("No search configured: set MODEL_API_KEY_MUSE for search grounding or TAVILY_API_KEY");
  return { hits: await tavilySearch(query, { maxResults: max, days: opts.days }), engine: "tavily" };
}
