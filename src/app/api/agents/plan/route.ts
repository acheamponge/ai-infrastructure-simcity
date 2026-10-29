import { plan } from "@/lib/agents/planner";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Streams a planning turn as server-sent events: status, tool steps, then the final reply and plan. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { messages?: Array<{ role: "user" | "assistant"; content: string }> };
  const history = (body.messages ?? []).filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string").slice(-12);
  if (!history.length || history[history.length - 1].role !== "user") return new Response(JSON.stringify({ error: "messages must end with a user turn" }), { status: 400, headers: { "content-type": "application/json" } });
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try { for await (const ev of plan(history)) controller.enqueue(enc.encode(`data: ${JSON.stringify(ev)}\n\n`)); }
      catch (e) { controller.enqueue(enc.encode(`data: ${JSON.stringify({ type: "error", text: e instanceof Error ? e.message : String(e) })}\n\n`)); }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive" } });
}
