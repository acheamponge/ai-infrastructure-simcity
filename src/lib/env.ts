// Central place for configuration. Local development works with no .env file:
// the Postgres URL defaults to the docker container started in the README.
//
// Values in the project's .env take precedence over variables inherited from the
// shell for the keys this app owns, so a stale key exported in a profile cannot
// shadow the one written here (Next.js itself never overrides an existing
// process variable from .env).
import fs from "node:fs";
import path from "node:path";

const OWNED = [
  "MODEL_API_KEY_MUSE", "META_BASE_URL", "META_MODEL_RESEARCH", "META_MODEL_ADVISOR", "META_MODEL_PLANNER", "LLM_PROVIDER",
  "CRUSOE_API_KEY", "CRUSOE_BASE_URL", "CRUSOE_MODEL_RESEARCH", "CRUSOE_MODEL_ADVISOR",
  "TAVILY_API_KEY", "ATLAS_AGENT_MODE", "DATABASE_URL",
];

function fileValues(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const file of [".env", ".env.local"]) {
    let text = "";
    try { text = fs.readFileSync(path.join(process.cwd(), file), "utf8"); } catch { continue; }
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      else v = v.replace(/\s+#.*$/, "").trim();
      if (OWNED.includes(m[1])) out[m[1]] = v;
    }
  }
  return out;
}

const fromFile = typeof window === "undefined" ? fileValues() : {};
const get = (k: string): string | undefined => (fromFile[k] !== undefined && fromFile[k] !== "" ? fromFile[k] : process.env[k]);

export type LlmProvider = "meta" | "crusoe";

export const env = {
  databaseUrl: get("DATABASE_URL") ?? "postgresql://atlas:atlas@localhost:5433/atlas?schema=public",
  /** Meta Model API (Muse Spark, Muse Wonder, SAM 3.1). OpenAI-compatible chat completions plus the Responses API for SAM. */
  meta: {
    key: get("MODEL_API_KEY_MUSE") ?? "",
    baseUrl: (get("META_BASE_URL") ?? "https://api.meta.ai/v1").replace(/\/+$/, ""),
    modelResearch: get("META_MODEL_RESEARCH") ?? "muse-spark-1.3",
    modelAdvisor: get("META_MODEL_ADVISOR") ?? "muse-wonder-1.0", // the verdict and plan; Spark gathers, Wonder decides
    modelPlanner: get("META_MODEL_PLANNER") ?? "muse-spark-1.3",
    samModel: "sam-3.1",
  },
  /** Crusoe Cloud managed inference, OpenAI-compatible. The fallback when Muse is unavailable, or the primary when LLM_PROVIDER=crusoe. */
  crusoeKey: get("CRUSOE_API_KEY") ?? "",
  crusoeBaseUrl: (get("CRUSOE_BASE_URL") ?? "https://api.inference.crusoecloud.com/v1").replace(/\/+$/, ""),
  /** Model hints resolved against Crusoe's /v1/models at first use; exact ids may be given instead. */
  modelResearch: get("CRUSOE_MODEL_RESEARCH") ?? "kimi",
  modelAdvisor: get("CRUSOE_MODEL_ADVISOR") ?? "glm",
  /** Tavily web search. */
  tavilyKey: get("TAVILY_API_KEY") ?? "",
  /** Where the keys came from, for the health page. */
  crusoeKeySource: fromFile.CRUSOE_API_KEY ? ".env" : process.env.CRUSOE_API_KEY ? "shell environment" : "unset",
  metaKeySource: fromFile.MODEL_API_KEY_MUSE ? ".env" : process.env.MODEL_API_KEY_MUSE ? "shell environment" : "unset",
  /** Which provider answers first. Muse when a Meta key exists, otherwise Crusoe; LLM_PROVIDER forces it. */
  get llmProvider(): LlmProvider {
    const forced = get("LLM_PROVIDER");
    if (forced === "meta" || forced === "crusoe") return forced;
    return this.meta.key ? "meta" : "crusoe";
  },
  get agentMode(): "live" | "fixture" {
    const forced = get("ATLAS_AGENT_MODE");
    if (forced === "live" || forced === "fixture") return forced;
    return (this.meta.key || this.crusoeKey) && this.tavilyKey ? "live" : "fixture";
  },
};

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = env.databaseUrl;
