import { NextResponse } from "next/server";
import { env } from "@/lib/env";

/** Reports whether each external service accepts the configured credentials. Keys are never returned. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const testModel = url.searchParams.get("model");
  const fingerprint = (k: string) => (k ? `${k.length} chars, starts "${k.slice(0, 4)}…"` : "not set");
  const crusoe: Record<string, unknown> = { baseUrl: env.crusoeBaseUrl, key: fingerprint(env.crusoeKey), keySource: env.crusoeKeySource, shellAlsoSetsKey: !!process.env.CRUSOE_API_KEY, researchHint: env.modelResearch, advisorHint: env.modelAdvisor };
  const tavily: Record<string, unknown> = { key: fingerprint(env.tavilyKey) };
  // compare the raw .env line with what the process received, to catch dotenv expansion or comment stripping
  try {
    const fs = await import("node:fs");
    const files = [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local"];
    const found: Array<{ file: string; line: string }> = [];
    for (const file of files) { try { for (const l of fs.readFileSync(file, "utf8").split(/\r?\n/)) if (/^\s*(export\s+)?CRUSOE_API_KEY\s*=/.test(l)) found.push({ file, line: l }); } catch { /* absent */ } }
    const raw = found[found.length - 1]?.line ?? "";
    let v = raw.replace(/^\s*(export\s+)?CRUSOE_API_KEY\s*=\s*/, "");
    const quoted = /^["'].*["']\s*$/.test(v);
    const inner = quoted ? v.trim().slice(1, -1) : v;
    crusoe.envFile = {
      cwd: process.cwd(), definedIn: found.map((f) => f.file), lineFound: !!raw, quoted, rawValueLength: inner.length, loadedLength: env.crusoeKey.length, matchesLoaded: inner === env.crusoeKey,
      rawHasDollar: inner.includes("$"), rawHasHash: inner.includes("#"), rawHasWhitespace: /\s/.test(inner), rawHasQuoteInside: /["']/.test(inner),
      loadedLooksTruncated: env.crusoeKey.length < inner.length,
      rawSpecialChars: [...new Set(inner.replace(/[A-Za-z0-9]/g, "").split(""))],
      loadedIsPrefixOfRaw: inner.startsWith(env.crusoeKey), loadedIsSuffixOfRaw: inner.endsWith(env.crusoeKey), loadedIndexInRaw: inner.indexOf(env.crusoeKey),
      rawLineStartsWith: raw.slice(0, 16),
    };
    v = "";
  } catch (e) { crusoe.envFile = { error: e instanceof Error ? e.message : String(e) }; }
  try {
    const r = await fetch(`${env.crusoeBaseUrl}/models`, { headers: { authorization: `Bearer ${env.crusoeKey}` } });
    const text = await r.text();
    if (r.ok) {
      const ids = ((JSON.parse(text) as { data?: Array<{ id: string }> }).data ?? []).map((m) => m.id);
      const pick = (h: string) => ids.find((id) => id.toLowerCase().includes(h.toLowerCase())) ?? null;
      crusoe.models = { status: "ok", ids, resolved: { research: pick(env.modelResearch), advisor: pick(env.modelAdvisor) } };
    } else crusoe.models = { status: `HTTP ${r.status}: ${text.slice(0, 200)}` };
  } catch (e) { crusoe.models = { status: `unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  // a one-token chat call on the same host, with a deliberately unknown model unless ?model= is given:
  // 401 means the key is refused; 400/404 means the key is accepted and only the model id is wrong
  try {
    const r = await fetch(`${env.crusoeBaseUrl}/chat/completions`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.crusoeKey}` },
      body: JSON.stringify({ model: testModel ?? "health-probe", messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    });
    crusoe.chat = { model: testModel ?? "health-probe", status: r.ok ? "ok" : `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}` };
  } catch (e) { crusoe.chat = { status: `unreachable: ${e instanceof Error ? e.message : String(e)}` }; }
  try {
    const r = await fetch("https://api.tavily.com/search", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.tavilyKey}` }, body: JSON.stringify({ query: "data center", max_results: 1 }) });
    tavily.status = r.ok ? "ok" : `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`;
  } catch (e) { tavily.status = `unreachable: ${e instanceof Error ? e.message : String(e)}`; }
  return NextResponse.json({ mode: env.agentMode, crusoe, tavily });
}
