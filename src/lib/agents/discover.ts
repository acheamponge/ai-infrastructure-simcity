import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { structured } from "../llm/client";
import { research } from "./research";
import { startRun } from "./runs";
import { DiscoveryOutput, type DiscoveredSiteT } from "./schemas";
import { fixtureDiscovery } from "./fixtures";
import { ensureBaseline, ensureProfile, findExistingSite } from "../sites";

const LIVE = () => env.agentMode === "live";

const EXTRACT = `You are a research analyst building a registry of AI and cloud data centers from web sources. Report facility power in megawatts at full build-out and say when a figure is IT load instead. Distinguish operational sites, sites under construction, sites with approved plans, and proposals that are only announced. Keep only entries with a real name and location. Use null for unknown numbers rather than guessing; coordinates may be the city's. Cite the bracketed source numbers that support each entry.`;

export async function runDiscovery(query: string, limit = 12) {
  const run = await startRun("DISCOVER", { query, limit }, LIVE() ? `${env.llmProvider === "meta" ? env.meta.modelResearch : env.modelResearch} + tavily` : "fixture");
  try {
    let found: DiscoveredSiteT[];
    let sourceList: Array<{ title: string; url: string }> = [];
    const usage = { model: "", tokensIn: 0, tokensOut: 0 };
    if (!LIVE()) {
      await run.log("fixture mode: no Crusoe/Tavily keys configured, returning sample sites");
      found = fixtureDiscovery(query);
    } else {
      await run.log(`planning searches for: ${query}`);
      const r = await research(`Find current and future AI or cloud data centers matching: "${query}". Cover both existing facilities and announced or planned ones, with operator, location, status, capacity in MW, timeline and power supply.`, { log: run.log, perQuery: 7 });
      usage.tokensIn += r.tokensIn; usage.tokensOut += r.tokensOut;
      sourceList = r.sources;
      const x = await structured("research", DiscoveryOutput, EXTRACT, `Extract up to ${limit} data centers for the query "${query}" from these sources.\n\n${r.digest}`, { maxTokens: 8000 });
      usage.model = x.usage.model; usage.tokensIn += x.usage.tokensIn; usage.tokensOut += x.usage.tokensOut;
      found = x.data.sites;
      await run.log(`extracted ${found.length} candidate sites with ${x.usage.model}`);
    }

    const created: string[] = [];
    const updated: string[] = [];
    for (const s of found.slice(0, limit)) {
      const match = await findExistingSite(s);
      const existing = match?.site ?? null;
      if (match && match.reason !== "same name") await run.log(`"${s.name}" is already tracked as "${match.site.name}" (${match.reason})`);
      const sources = s.sourceIds.map((i) => sourceList[i - 1]).filter(Boolean);
      const data = {
        name: s.name, operator: s.operator, country: s.country, region: s.region, city: s.city, lat: s.lat, lon: s.lon, status: s.status,
        capacityMw: s.capacityMw, itMw: s.itMw, announcedAt: s.announcedAt ? safeDate(s.announcedAt) : null, expectedOnline: s.expectedOnline,
        energyNotes: s.energyNotes, description: s.description, confidence: s.confidence,
        sources: sources as unknown as Prisma.InputJsonValue, discoveredBy: run.id,
      };
      let site;
      if (existing && existing.curated) { updated.push(existing.name); continue; }
      if (existing) { site = await prisma.site.update({ where: { id: existing.id }, data }); updated.push(site.name); }
      else { site = await prisma.site.create({ data }); created.push(site.name); }
      await ensureProfile(site);
      await ensureBaseline(site);
    }
    await run.log(`stored ${created.length} new, ${updated.length} refreshed`);
    await run.succeed({ created, updated, candidates: found.length, sources: sourceList.length } as unknown as Prisma.InputJsonValue, usage);
    return { runId: run.id, created, updated };
  } catch (err) {
    await run.fail(err);
    throw err;
  }
}

function safeDate(s: string): Date | null {
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}
