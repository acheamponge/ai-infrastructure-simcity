// Central place for configuration. Local development works with no .env file:
// the Postgres URL defaults to the docker container started in the README.
//
// Values in the project's .env take precedence over variables inherited from the
// shell for the keys this app owns, so a stale CRUSOE_API_KEY exported in a
// profile cannot shadow the one written here (Next.js itself never overrides
// an existing process variable from .env).
import fs from "node:fs";
import path from "node:path";

const OWNED = ["CRUSOE_API_KEY", "CRUSOE_BASE_URL", "CRUSOE_MODEL_RESEARCH", "CRUSOE_MODEL_ADVISOR", "TAVILY_API_KEY", "ATLAS_AGENT_MODE", "DATABASE_URL"];

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

export const env = {
  databaseUrl: get("DATABASE_URL") ?? "postgresql://atlas:atlas@localhost:5433/atlas?schema=public",
  /** Crusoe Cloud inference, OpenAI-compatible. */
  crusoeKey: get("CRUSOE_API_KEY") ?? "",
  crusoeBaseUrl: (get("CRUSOE_BASE_URL") ?? "https://api.inference.crusoecloud.com/v1").replace(/\/+$/, ""),
  /** Model hints resolved against /v1/models at first use; exact ids may be given instead. */
  modelResearch: get("CRUSOE_MODEL_RESEARCH") ?? "kimi", // falls back to GLM 5.3 Flash when the endpoint has no Kimi
  modelAdvisor: get("CRUSOE_MODEL_ADVISOR") ?? "glm",
  /** Tavily web search. */
  tavilyKey: get("TAVILY_API_KEY") ?? "",
  /** Where the Crusoe key came from, for the health page. */
  crusoeKeySource: fromFile.CRUSOE_API_KEY ? ".env" : process.env.CRUSOE_API_KEY ? "shell environment" : "unset",
  get agentMode(): "live" | "fixture" {
    const forced = get("ATLAS_AGENT_MODE");
    if (forced === "live" || forced === "fixture") return forced;
    return this.crusoeKey && this.tavilyKey ? "live" : "fixture";
  },
};

if (!process.env.DATABASE_URL) process.env.DATABASE_URL = env.databaseUrl;
