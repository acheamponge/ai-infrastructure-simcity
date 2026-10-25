// Minimal client for Crusoe Cloud's OpenAI-compatible chat completions API.
// No SDK: one fetch per call, JSON mode for structured answers, zod validation with one retry.
import { z } from "zod/v4";
import { env } from "../env";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string }
export interface ChatResult { text: string; model: string; tokensIn: number; tokensOut: number }

let modelCache: string[] | null = null;

/** Resolve a hint such as "glm" or "kimi" to an exact model id served by the endpoint. */
export async function resolveModel(hint: string): Promise<string> {
  if (hint.includes("/") || hint.includes("-")) return hint; // already an id
  if (!modelCache) {
    const r = await fetch(`${env.crusoeBaseUrl}/models`, { headers: { authorization: `Bearer ${env.crusoeKey}` } });
    if (!r.ok) throw new Error(`Crusoe /models ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const j = (await r.json()) as { data?: Array<{ id: string }> };
    modelCache = (j.data ?? []).map((m) => m.id);
  }
  const find = (h: string) => modelCache!.find((id) => id.toLowerCase().includes(h.toLowerCase()));
  const hit = find(hint);
  if (hit) return hit;
  // the endpoint does not serve the requested family: fall back to a fast model that is there
  for (const alt of ["glm-5.3-flash", "deepseek-v4.1-flash", "glm-5.3", "qwen"]) {
    const a = find(alt);
    if (a) { console.warn(`[crusoe] no model matching "${hint}"; using ${a}`); return a; }
  }
  throw new Error(`No model matching "${hint}" on ${env.crusoeBaseUrl}. Available: ${modelCache.join(", ")}`);
}

let thinkingFlagRejected = false;

export async function chat(modelHint: string, messages: ChatMessage[], opts: { json?: boolean; maxTokens?: number; temperature?: number } = {}): Promise<ChatResult & { finish?: string }> {
  const model = await resolveModel(modelHint);
  const send = async (withFlag: boolean) => {
    const body: Record<string, unknown> = { model, messages, max_tokens: opts.maxTokens ?? 6000, temperature: opts.temperature ?? 0.2 };
    if (opts.json) body.response_format = { type: "json_object" };
    // reasoning models answer faster and inside the token budget when thinking is off; servers that reject the field get a plain retry
    if (withFlag) { body.chat_template_kwargs = { enable_thinking: false }; body.thinking = { type: "disabled" }; }
    return fetch(`${env.crusoeBaseUrl}/chat/completions`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.crusoeKey}` }, body: JSON.stringify(body) });
  };
  let r = await send(!thinkingFlagRejected);
  if (r.status === 400 && !thinkingFlagRejected) { thinkingFlagRejected = true; r = await send(false); }
  if (!r.ok) throw new Error(`Crusoe chat ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { choices: Array<{ message: { content?: string | null; reasoning_content?: string | null }; finish_reason?: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
  const m = j.choices?.[0]?.message ?? {};
  let text = (m.content ?? "").trim();
  // some reasoning models leave the answer in the reasoning field when the budget runs out
  if (!text && m.reasoning_content) text = m.reasoning_content.trim();
  text = text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
  return { text, model, tokensIn: j.usage?.prompt_tokens ?? 0, tokensOut: j.usage?.completion_tokens ?? 0, finish: j.choices?.[0]?.finish_reason };
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced ? fenced[1] : text).trim();
  const start = raw.search(/[{[]/);
  if (start > 0) raw = raw.slice(start);
  // trim anything after the last closing brace or bracket
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (end > 0) raw = raw.slice(0, end + 1);
  return JSON.parse(raw);
}

/** Ask for JSON matching a zod schema; retry once with the validation error if the first answer does not parse. */
export async function structured<T extends z.ZodType>(modelHint: string, schema: T, system: string, user: string, opts: { maxTokens?: number } = {}): Promise<{ data: z.infer<T>; usage: { model: string; tokensIn: number; tokensOut: number } }> {
  const jsonSchema = JSON.stringify(z.toJSONSchema(schema));
  const sys = `${system}\n\nRespond with a single JSON object and nothing else. It must validate against this JSON Schema:\n${jsonSchema}`;
  const messages: ChatMessage[] = [{ role: "system", content: sys }, { role: "user", content: user }];
  let tokensIn = 0, tokensOut = 0, model = "", last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await chat(modelHint, messages, { json: true, maxTokens: opts.maxTokens ?? 6000 });
    tokensIn += r.tokensIn; tokensOut += r.tokensOut; model = r.model; last = `${r.finish ?? "?"}: ${r.text.slice(0, 240)}`;
    try {
      const parsed = schema.safeParse(extractJson(r.text));
      if (parsed.success) return { data: parsed.data, usage: { model, tokensIn, tokensOut } };
      messages.push({ role: "assistant", content: r.text }, { role: "user", content: `That did not validate: ${JSON.stringify(parsed.error.issues.slice(0, 5))}. Return the corrected JSON object only.` });
    } catch (e) {
      messages.push({ role: "assistant", content: r.text || "(empty)" }, { role: "user", content: `That was not valid JSON (${e instanceof Error ? e.message : String(e)}). Return the JSON object only, no prose.` });
    }
  }
  throw new Error(`Model ${model} did not return valid JSON after two attempts. Last reply (${last.length ? last : "empty"})`);
}
