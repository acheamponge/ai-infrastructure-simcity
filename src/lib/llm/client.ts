// One chat client, two OpenAI-compatible providers.
//
//   meta    Meta Model API: Muse Spark / Muse Wonder. json_schema structured output, function tools, reasoning_effort.
//   crusoe  Crusoe Cloud managed inference: GLM, DeepSeek, Nemotron and friends. json_object mode, thinking flags.
//
// Callers ask for a role (research, advisor, planner) rather than a model. The primary provider answers; if it is
// unreachable, rate limited or rejects the model, the call is retried on the other provider when it is configured.
import { z } from "zod/v4";
import { env, type LlmProvider } from "../env";

export type Role = "research" | "advisor" | "planner";
export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface ToolDef { type: "function"; function: { name: string; description: string; parameters: Record<string, unknown> } }
export interface ChatMessage { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }
export interface ChatResult { text: string; model: string; provider: LlmProvider; tokensIn: number; tokensOut: number; finish?: string; toolCalls: ToolCall[]; usageRaw?: unknown }
export interface ChatOptions { json?: Record<string, unknown> | true; tools?: ToolDef[]; maxTokens?: number; temperature?: number; reasoning?: "minimal" | "low" | "medium" | "high"; timeoutMs?: number }

interface Provider { id: LlmProvider; baseUrl: string; key: string; models: Record<Role, string>; listModels: boolean; jsonMode: "schema" | "object"; thinkingFlags: boolean; fallbackModels: string[] }

export class ProviderError extends Error {
  constructor(public provider: LlmProvider, public status: number, message: string) { super(message); }
}

export function providers(): Provider[] {
  const meta: Provider | null = env.meta.key ? { id: "meta", baseUrl: env.meta.baseUrl, key: env.meta.key, models: { research: env.meta.modelResearch, advisor: env.meta.modelAdvisor, planner: env.meta.modelPlanner }, listModels: false, jsonMode: "schema", thinkingFlags: false, fallbackModels: ["muse-spark-1.3"] } : null;
  const crusoe: Provider | null = env.crusoeKey ? { id: "crusoe", baseUrl: env.crusoeBaseUrl, key: env.crusoeKey, models: { research: env.modelResearch, advisor: env.modelAdvisor, planner: env.modelAdvisor }, listModels: true, jsonMode: "object", thinkingFlags: true, fallbackModels: ["glm-5.3-flash", "deepseek-v4.1-flash", "glm-5.3", "qwen"] } : null;
  const order = env.llmProvider === "crusoe" ? [crusoe, meta] : [meta, crusoe];
  return order.filter((p): p is Provider => !!p);
}

const modelCache = new Map<string, string[]>();
async function listModels(p: Provider): Promise<string[]> {
  const cached = modelCache.get(p.id); if (cached) return cached;
  const r = await fetch(`${p.baseUrl}/models`, { headers: { authorization: `Bearer ${p.key}` } });
  if (!r.ok) throw new ProviderError(p.id, r.status, `${p.id} /models ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const j = (await r.json()) as { data?: Array<{ id: string }> };
  const ids = (j.data ?? []).map((m) => m.id); modelCache.set(p.id, ids); return ids;
}

/** Resolve a hint such as "glm", "kimi" or "spark" to a model id the provider serves. */
export async function resolveModel(p: Provider, hint: string): Promise<string> {
  if (!p.listModels) {
    if (hint.includes("-") || hint.includes("/")) return hint;
    const h = hint.toLowerCase();
    if (h.includes("wonder")) return "muse-wonder-1.0";
    if (h.includes("spark")) return "muse-spark-1.3";
    return p.models.research;
  }
  if (hint.includes("/") || hint.includes("-")) return hint;
  const ids = await listModels(p);
  const find = (h: string) => ids.find((id) => id.toLowerCase().includes(h.toLowerCase()));
  const hit = find(hint); if (hit) return hit;
  for (const alt of p.fallbackModels) { const a = find(alt); if (a) { console.warn(`[llm] ${p.id} has no model matching "${hint}"; using ${a}`); return a; } }
  throw new ProviderError(p.id, 404, `No model matching "${hint}" on ${p.baseUrl}. Available: ${ids.join(", ")}`);
}

let crusoeThinkingFlagRejected = false;

async function send(p: Provider, model: string, messages: ChatMessage[], opts: ChatOptions): Promise<ChatResult> {
  const body: Record<string, unknown> = { model, messages: messages.map((m) => ({ ...m, content: m.content ?? "" })) };
  if (opts.temperature != null) body.temperature = opts.temperature;
  if (p.id === "meta") { body.max_completion_tokens = opts.maxTokens ?? 6000; body.reasoning_effort = opts.reasoning ?? "low"; }
  else { body.max_tokens = opts.maxTokens ?? 6000; if (opts.temperature == null) body.temperature = 0.2; }
  if (opts.json) {
    if (p.jsonMode === "schema" && opts.json !== true) body.response_format = { type: "json_schema", json_schema: { name: "Output", schema: opts.json } };
    else body.response_format = { type: "json_object" };
  }
  if (opts.tools?.length) { body.tools = opts.tools; body.tool_choice = "auto"; }
  const post = async (withFlag: boolean) => {
    const b = { ...body };
    if (withFlag) { b.chat_template_kwargs = { enable_thinking: false }; b.thinking = { type: "disabled" }; }
    const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? 240000);
    try { return await fetch(`${p.baseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${p.key}` }, body: JSON.stringify(b), signal: ctl.signal }); }
    catch (e) { throw new ProviderError(p.id, 0, `${p.id} chat ${ctl.signal.aborted ? "timed out after " + Math.round((opts.timeoutMs ?? 240000) / 1000) + " s" : "unreachable: " + (e instanceof Error ? e.message : String(e))}`); }
    finally { clearTimeout(timer); }
  };
  let r = await post(p.thinkingFlags && !crusoeThinkingFlagRejected);
  if (p.thinkingFlags && r.status === 400 && !crusoeThinkingFlagRejected) { crusoeThinkingFlagRejected = true; r = await post(false); }
  if (!r.ok) throw new ProviderError(p.id, r.status, `${p.id} chat ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content?: string | null; reasoning_content?: string | null; tool_calls?: ToolCall[] }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const m = j.choices?.[0]?.message ?? {};
  let text = (m.content ?? "").trim();
  if (!text && m.reasoning_content && !m.tool_calls?.length) text = m.reasoning_content.trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { text, model, provider: p.id, tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0, finish: j.choices?.[0]?.finish_reason, toolCalls: m.tool_calls ?? [], usageRaw: j.usage };
}

const retriable = (e: unknown) => !(e instanceof ProviderError) || e.status === 0 || e.status === 401 || e.status === 403 || e.status === 404 || e.status === 429 || e.status >= 500;

/** Chat with the primary provider for the role, falling back to the other provider when it cannot answer. */
export async function chat(role: Role, messages: ChatMessage[], opts: ChatOptions = {}): Promise<ChatResult> {
  const ps = providers();
  if (!ps.length) throw new Error("No inference provider configured: set MODEL_API_KEY_MUSE (Meta) or CRUSOE_API_KEY in .env");
  let last: unknown = null;
  for (const p of ps) {
    try {
      const model = await resolveModel(p, p.models[role]);
      try { return await send(p, model, messages, opts); }
      catch (e) {
        // a preview model may be unavailable to this key, rate limited or slow: try the provider's own fallback before leaving it
        if (e instanceof ProviderError && (e.status === 0 || e.status === 400 || e.status === 404 || e.status === 429 || e.status >= 500) && p.fallbackModels[0] && !p.listModels && model !== p.fallbackModels[0]) {
          console.warn(`[llm] ${p.id} ${model} failed (${e.message.slice(0, 80)}); retrying on ${p.fallbackModels[0]}`);
          return await send(p, p.fallbackModels[0], messages, opts);
        }
        throw e;
      }
    } catch (e) {
      last = e;
      if (!retriable(e)) throw e;
      console.warn(`[llm] ${p.id} failed for ${role}: ${e instanceof Error ? e.message : String(e)}${ps.indexOf(p) < ps.length - 1 ? "; trying the next provider" : ""}`);
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced ? fenced[1] : text).trim();
  const start = raw.search(/[{[]/);
  if (start > 0) raw = raw.slice(start);
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (end > 0) raw = raw.slice(0, end + 1);
  return JSON.parse(raw);
}

/** Ask for JSON matching a zod schema; retry once with the validation error if the first answer does not parse. */
export async function structured<T extends z.ZodType>(role: Role, schema: T, system: string, user: string, opts: { maxTokens?: number } = {}): Promise<{ data: z.infer<T>; usage: { model: string; provider: LlmProvider; tokensIn: number; tokensOut: number; attempts: number; raw?: unknown } }> {
  const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
  const sys = `${system}\n\nRespond with a single JSON object and nothing else. It must validate against this JSON Schema:\n${JSON.stringify(jsonSchema)}`;
  const messages: ChatMessage[] = [{ role: "system", content: sys }, { role: "user", content: user }];
  let tokensIn = 0, tokensOut = 0, model = "", provider: LlmProvider = env.llmProvider, last = "", raw: unknown = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await chat(role, messages, { json: jsonSchema, maxTokens: opts.maxTokens ?? 6000 });
    tokensIn += r.tokensIn; tokensOut += r.tokensOut; model = r.model; provider = r.provider; last = `${r.finish ?? "?"}: ${r.text.slice(0, 240)}`; raw = r.usageRaw;
    try {
      const parsed = schema.safeParse(extractJson(r.text));
      if (parsed.success) return { data: parsed.data, usage: { model: `${provider}/${model}`, provider, tokensIn, tokensOut, attempts: attempt + 1, raw } };
      messages.push({ role: "assistant", content: r.text }, { role: "user", content: `That did not validate: ${JSON.stringify(parsed.error.issues.slice(0, 5))}. Return the corrected JSON object only.` });
    } catch (e) {
      messages.push({ role: "assistant", content: r.text || "(empty)" }, { role: "user", content: `That was not valid JSON (${e instanceof Error ? e.message : String(e)}). Return the JSON object only, no prose.` });
    }
  }
  throw new Error(`Model ${provider}/${model} did not return valid JSON after two attempts. Last reply (${last.length ? last : "empty"})`);
}

export interface ToolStep { name: string; args: Record<string, unknown>; result: unknown; summary: string }

/** Run a function-calling loop: the model calls tools, we execute them, until it answers in prose or a terminal tool fires. */
export async function chatWithTools(role: Role, messages: ChatMessage[], tools: ToolDef[], handler: (name: string, args: Record<string, unknown>) => Promise<{ result: unknown; summary: string; terminal?: boolean }>, opts: { maxRounds?: number; onStep?: (s: ToolStep) => void | Promise<void>; maxTokens?: number; reasoning?: ChatOptions["reasoning"] } = {}): Promise<{ text: string; steps: ToolStep[]; model: string; provider: LlmProvider; tokensIn: number; tokensOut: number; terminalStep: ToolStep | null }> {
  const history = [...messages]; const steps: ToolStep[] = []; let tokensIn = 0, tokensOut = 0, model = "", provider: LlmProvider = env.llmProvider;
  for (let round = 0; round < (opts.maxRounds ?? 8); round++) {
    const r = await chat(role, history, { tools, maxTokens: opts.maxTokens ?? 3000, reasoning: opts.reasoning ?? "low" });
    tokensIn += r.tokensIn; tokensOut += r.tokensOut; model = r.model; provider = r.provider;
    if (!r.toolCalls.length) return { text: r.text, steps, model, provider, tokensIn, tokensOut, terminalStep: null };
    history.push({ role: "assistant", content: r.text || "", tool_calls: r.toolCalls });
    let terminal: ToolStep | null = null;
    for (const tc of r.toolCalls) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.function.arguments || "{}"); } catch { args = {}; }
      let out: { result: unknown; summary: string; terminal?: boolean };
      try { out = await handler(tc.function.name, args); }
      catch (e) { out = { result: { error: e instanceof Error ? e.message : String(e) }, summary: `${tc.function.name} failed: ${e instanceof Error ? e.message : String(e)}` }; }
      const step: ToolStep = { name: tc.function.name, args, result: out.result, summary: out.summary }; steps.push(step); await opts.onStep?.(step);
      history.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(out.result).slice(0, 12000) });
      if (out.terminal) terminal = step;
    }
    if (terminal) {
      // one more short turn so the model can write its reply over the submitted plan
      const r2 = await chat(role, [...history, { role: "user", content: 'The plan is recorded. Reply with a JSON object {"reply": string}: under 120 words, written to the user, saying what you planned and the one thing they should watch. No preamble.' }], { maxTokens: 600, reasoning: "minimal", json: { type: "object", properties: { reply: { type: "string" } }, required: ["reply"] } }).catch(() => null);
      if (r2) { tokensIn += r2.tokensIn; tokensOut += r2.tokensOut; }
      let text = r2?.text ?? "";
      try { text = String((extractJson(text) as { reply?: string }).reply ?? text); } catch { text = text.replace(/^[\s\S]*?(?=\*\*|[A-Z][^.]{0,80}\.)/, "").trim(); }
      return { text, steps, model, provider, tokensIn, tokensOut, terminalStep: terminal };
    }
  }
  return { text: "I ran out of steps before finishing. Try a narrower request.", steps, model, provider, tokensIn, tokensOut, terminalStep: null };
}
