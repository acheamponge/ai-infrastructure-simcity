"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

interface Run { id: string; kind: string; status: string; input: Record<string, unknown>; output: Record<string, unknown> | null; log: string; error: string | null; model: string | null; tokensIn: number | null; tokensOut: number | null; startedAt: string; finishedAt: string | null }

export function AgentConsole({ mode }: { mode: "live" | "fixture" }) {
  const [query, setQuery] = useState("AI data centers announced in Texas in 2026");
  const [limit, setLimit] = useState(10);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState<string | null>(null);
  const router = useRouter();

  async function load() { const r = await fetch("/api/runs?limit=40", { cache: "no-store" }); setRuns(await r.json()); }
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, []);

  async function discover() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch("/api/agents/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, limit }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setMsg(`${j.created.length} new sites, ${j.updated.length} refreshed`);
      router.refresh();
    } catch (e) { setMsg(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); load(); }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="card p-4">
        <div className="eyebrow mb-2">Discovery agent</div>
        <p className="text-sm text-slate-2 mb-3">Searches the public web for current and future data centers matching a query, extracts structured records with sources, and registers them with a baseline estimate. {mode === "fixture" && <span className="text-amber">Fixture mode: returns sample records until an API key is configured.</span>}</p>
        <div className="flex flex-wrap gap-2 items-center">
          <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} className="!w-[420px] max-w-full" aria-label="Discovery query" />
          <label className="text-xs text-slate-2 flex items-center gap-1">limit <input type="number" min={1} max={30} value={limit} onChange={(e) => setLimit(Number(e.target.value))} className="!w-16" /></label>
          <button className="btn btn-primary" onClick={discover} disabled={busy}>{busy ? "Searching…" : "Run discovery"}</button>
          {msg && <span className="text-xs">{msg}</span>}
        </div>
        <div className="flex flex-wrap gap-1.5 mt-3">
          {["Hyperscale campuses under construction in the United States", "Planned AI data centers in the Nordics", "Data centers announced in the Gulf 2026", "Sovereign AI compute projects in India", "Data center moratoriums and withdrawn proposals 2026"].map((q) => (
            <button key={q} className="pill hover:bg-paper" onClick={() => setQuery(q)}>{q}</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="px-4 py-3 border-b border-line flex items-center justify-between"><div className="eyebrow">Run log</div><span className="text-xs text-slate-2">{runs.length} runs · refreshes every 4 s</span></div>
        <table className="table">
          <thead><tr><th>When</th><th>Agent</th><th>Input</th><th>Status</th><th>Result</th><th className="r">Tokens</th></tr></thead>
          <tbody>
            {runs.map((r) => (
              <RunRow key={r.id} r={r} open={open === r.id} toggle={() => setOpen(open === r.id ? null : r.id)} />
            ))}
            {runs.length === 0 && <tr><td colSpan={6} className="text-center text-slate-2 py-8"><div className="font-medium text-slate-1">No runs yet</div><div className="text-xs mt-1">Run a discovery above, or open any site and press Assess. Each run appears here with its model, sources and token use.</div></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RunRow({ r, open, toggle }: { r: Run; open: boolean; toggle: () => void }) {
  const input = r.input.query ?? r.input.site ?? r.input.scenario ?? JSON.stringify(r.input);
  const result = r.error ? r.error : r.output ? summarize(r.kind, r.output) : "";
  const statusCls = r.status === "SUCCEEDED" ? "pill-go" : r.status === "FAILED" ? "pill-nogo" : "pill-cond";
  return (
    <>
      <tr onClick={toggle} className="cursor-pointer hover:bg-paper">
        <td className="whitespace-nowrap text-slate-2">{new Date(r.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
        <td><span className="pill">{r.kind.toLowerCase()}</span> <span className="text-[11px] text-slate-2">{r.model}</span></td>
        <td className="max-w-[320px] truncate">{String(input)}</td>
        <td><span className={`pill ${statusCls}`}>{r.status.toLowerCase()}</span></td>
        <td className="max-w-[320px] truncate">{result}</td>
        <td className="r num text-slate-2">{r.tokensIn || r.tokensOut ? `${(r.tokensIn ?? 0).toLocaleString()} / ${(r.tokensOut ?? 0).toLocaleString()}` : "—"}</td>
      </tr>
      {open && <tr><td colSpan={6} className="bg-paper"><pre className="text-[11px] whitespace-pre-wrap font-mono text-slate-2">{r.log || "(no log)"}{r.output ? "\n\n" + JSON.stringify(r.output, null, 2) : ""}</pre></td></tr>}
    </>
  );
}

function summarize(kind: string, o: Record<string, unknown>): string {
  if (kind === "DISCOVER") return `${(o.created as string[])?.length ?? 0} new, ${(o.updated as string[])?.length ?? 0} refreshed of ${o.candidates ?? 0}`;
  if (kind === "ENRICH") return `${(o.patched as string[])?.length ?? 0} factors updated${o.moratorium ? " · moratorium" : ""}`;
  if (kind === "ASSESS") return `verdict ${String(o.verdict ?? "")}`;
  return JSON.stringify(o).slice(0, 80);
}
