import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { env } from "../env";
import { structured } from "../llm/client";
import { research } from "./research";
import { startRun } from "./runs";
import { EnrichOutput, type EnrichOutputT } from "./schemas";
import { fixtureEnrich } from "./fixtures";
import { ensureProfile, reestimateSite } from "../sites";
import { measureSite, toStoredLayers } from "../vision/sam";

const LIVE = () => env.agentMode === "live";

const EXTRACT = `You are a siting analyst. From the sources, establish the local facts that decide whether a large data center is viable. Give numbers with the units the schema asks for and only when a source supports them; otherwise null. Convert currencies to USD. Keep notes short and factual, each citing a source number.`;

export async function runEnrich(siteId: string) {
  const site = await prisma.site.findUniqueOrThrow({ where: { id: siteId } });
  const run = await startRun("ENRICH", { siteId, site: site.name }, LIVE() ? `${env.llmProvider === "meta" ? env.meta.modelResearch : env.modelResearch} + tavily` : "fixture");
  try {
    const profile = await ensureProfile(site);
    let out: EnrichOutputT;
    let sourceList: Array<{ title: string; url: string }> = [];
    const usage = { model: "", tokensIn: 0, tokensOut: 0 };
    if (!LIVE()) {
      await run.log("fixture mode: keeping country priors");
      out = fixtureEnrich();
    } else {
      const where = [site.city, site.region, site.country].filter(Boolean).join(", ");
      await run.log(`researching region factors for ${where}`);
      const r = await research(`Siting factors for a ${site.capacityMw ?? 200} MW data center at ${where}: industrial electricity price, grid carbon intensity, interconnection lead time and spare capacity, grid reliability, construction labor availability and wages, industrial land cost, water stress, climate, solar and wind resource, geothermal or flare-gas opportunities, population nearby, community sentiment toward data centers, and any moratorium.`, {
        queriesHint: [
          `${where} industrial electricity price per kWh 2026`,
          `${site.region ?? site.country} grid carbon intensity gCO2 per kWh`,
          `${site.region ?? site.country} data center interconnection queue lead time MW capacity`,
          `${where} data center moratorium opposition community`,
          `${where} construction labor wages availability 2026`,
          `${where} water stress drought data center cooling`,
        ],
        log: run.log,
      });
      usage.tokensIn += r.tokensIn; usage.tokensOut += r.tokensOut;
      sourceList = r.sources;
      const x = await structured("research", EnrichOutput, EXTRACT, `Site: ${site.name} at ${where} (${site.lat.toFixed(2)}, ${site.lon.toFixed(2)}).\n\n${r.digest}`, { maxTokens: 4000 });
      usage.model = x.usage.model; usage.tokensIn += x.usage.tokensIn; usage.tokensOut += x.usage.tokensOut;
      out = x.data;
      await run.log(`${out.notes.length} findings from ${sourceList.length} sources`);
    }
    const patch: Record<string, unknown> = {};
    for (const k of ["powerPriceKwh", "gridCarbonG", "gridLeadMonths", "gridHeadroomMw", "gridReliability", "laborPool", "wageUsdH", "landIndex", "sentiment", "waterStress", "climate", "solar", "wind", "geothermal", "flareGas", "populationNear"] as const) {
      const v = out[k];
      if (v !== null && v !== undefined) patch[k] = k === "laborPool" || k === "populationNear" ? Math.round(Number(v)) : v;
    }
    if (out.moratorium) patch.sentiment = Math.min(Number(patch.sentiment ?? profile.sentiment), 25);
    const sources = out.sourceIds.map((i) => sourceList[i - 1]).filter(Boolean);
    await prisma.regionProfile.update({ where: { siteId }, data: { ...patch, enrichedBy: LIVE() ? run.id : null, sources: sources as unknown as Prisma.InputJsonValue } });
    // the SAM moment: look at the site and measure its land, water and solar instead of trusting priors
    if (LIVE() && env.meta.key) {
      try {
        await run.log("measuring the site with SAM 3.1 over satellite imagery");
        const m = await measureSite(site.lat, site.lon);
        await prisma.regionProfile.update({ where: { siteId }, data: { measuredBuiltHa: m.summary.builtHa, measuredOpenHa: m.summary.openHa, measuredWaterHa: m.summary.waterHa, measuredWaterNearM: m.summary.waterNearM, measuredSolarHa: m.summary.solarHa, measuredSpanM: m.spanM, measuredBy: m.model, measuredAt: new Date(), measuredLayers: toStoredLayers(m) as unknown as Prisma.InputJsonValue, sources: [...sources, { title: `${m.model} segmentation of Esri World Imagery`, url: "https://dev.meta.ai/docs/sam/overview" }] as unknown as Prisma.InputJsonValue } });
        patch.measured = m.summary;
        await run.log(`measured ${m.summary.openHa.toFixed(0)} ha open land, ${m.summary.builtHa.toFixed(0)} ha built, ${m.summary.waterHa.toFixed(0)} ha water, ${m.summary.solarHa.toFixed(0)} ha solar in ${(m.tookMs / 1000).toFixed(0)} s`);
      } catch (err) { await run.log(`SAM measurement skipped: ${err instanceof Error ? err.message : String(err)}`); }
    }
    await reestimateSite(siteId);
    await run.log("profile updated and scenarios re-estimated");
    await run.succeed({ patched: Object.keys(patch), notes: out.notes, moratorium: out.moratorium } as unknown as Prisma.InputJsonValue, usage);
    return { runId: run.id, patched: Object.keys(patch), notes: out.notes };
  } catch (err) {
    await run.fail(err);
    throw err;
  }
}
