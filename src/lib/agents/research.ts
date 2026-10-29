// Research pass: the research model proposes search queries, Tavily runs them,
// and the hits are returned as a numbered digest the extraction step can cite.
import { z } from "zod/v4";
import { env } from "../env";
import { chat, structured } from "../llm/client";
import { tavilySearch, type SearchHit } from "../search/tavily";

export interface SourceRef { title: string; url: string }
export interface ResearchResult { digest: string; sources: SourceRef[]; queries: string[]; tokensIn: number; tokensOut: number; model: string }

const QuerySet = z.object({ queries: z.array(z.string()).min(2).max(6) });

export async function research(goal: string, opts: { queriesHint?: string[]; perQuery?: number; log?: (s: string) => Promise<void>; recentDays?: number } = {}): Promise<ResearchResult> {
  let tokensIn = 0, tokensOut = 0, model = "";
  let queries = opts.queriesHint ?? [];
  if (!queries.length) {
    const q = await structured("research", QuerySet, "You plan web research. Write specific, diverse search queries that together would answer the goal. Prefer queries that surface primary sources: operator press releases, utility and regulator filings, planning records, statistical agencies.", `Goal: ${goal}`, { maxTokens: 2000 });
    queries = q.data.queries; tokensIn += q.usage.tokensIn; tokensOut += q.usage.tokensOut; model = q.usage.model;
  }
  await opts.log?.(`queries: ${queries.join(" | ")}`);
  const seen = new Map<string, SearchHit>();
  for (const q of queries) {
    try {
      const hits = await tavilySearch(q, { maxResults: opts.perQuery ?? 6, days: opts.recentDays });
      for (const h of hits) if (!seen.has(h.url)) seen.set(h.url, h);
    } catch (e) { await opts.log?.(`search failed for "${q}": ${e instanceof Error ? e.message : String(e)}`); }
  }
  const hits = [...seen.values()];
  await opts.log?.(`${hits.length} unique sources`);
  const digest = hits.map((h, i) => `[${i + 1}] ${h.title}\n${h.url}${h.published ? `\n${h.published}` : ""}\n${h.content.slice(0, 1200)}`).join("\n\n");
  return { digest, sources: hits.map((h) => ({ title: h.title, url: h.url })), queries, tokensIn, tokensOut, model };
}

/** Free-text synthesis over a digest, for logs and notes. */
export async function summarize(goal: string, digest: string): Promise<string> {
  const r = await chat("research", [{ role: "system", content: "Summarize the sources for the goal in under 200 words. Cite sources by their bracketed number." }, { role: "user", content: `Goal: ${goal}\n\n${digest}` }], { maxTokens: 600 });
  return r.text;
}
