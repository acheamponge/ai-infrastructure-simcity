"use client";
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "./use-focus-trap";
import type { PlannerPlan, PlannerEvent } from "@/lib/agents/planner";

interface Turn { role: "user" | "assistant"; content: string; steps?: Array<{ name: string; summary: string }>; plan?: PlannerPlan | null; model?: string; error?: string }

declare global { interface Window { __simcity?: { applyFocus: (f: { regionId: string; cfg?: Record<string, unknown>; label?: string; autoBreakGround?: boolean }) => void; selectRegion?: (id: string) => void } } }

const SUGGESTIONS = [
  "Plan a 300 MW GB200 campus in Québec on hydro",
  "Where in Europe is the cheapest place to run 100 MW of H200 with low carbon?",
  "Compare Texas Panhandle and Phoenix for a 500 MW B200 build",
  "Is the Stargate Abilene site a go at 1 GW on gas plus solar?",
];

const fmt = (n: number | null | undefined, d = 0) => (n == null ? "–" : n.toLocaleString(undefined, { maximumFractionDigits: d }));

/** A chat panel over the planner agent. Muse calls the estimation engine, then the plan plays in the simulation. */
export function PlannerChat() {
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [live, setLive] = useState<{ steps: Array<{ name: string; summary: string }>; status: string }>({ steps: [], status: "" });
  const listRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useFocusTrap(panelRef, open);
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [turns, live, open]);

  async function send(text: string) {
    const q = text.trim(); if (!q || busy) return;
    const history = [...turns.filter((t) => !t.error).map((t) => ({ role: t.role, content: t.content })), { role: "user" as const, content: q }];
    setTurns((t) => [...t, { role: "user", content: q }]); setInput(""); setBusy(true); setLive({ steps: [], status: "thinking" });
    const steps: Array<{ name: string; summary: string }> = [];
    try {
      const r = await fetch("/api/agents/plan", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ messages: history }) });
      if (!r.ok || !r.body) throw new Error(`planner ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
      let final: PlannerEvent | null = null;
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        let i; while ((i = buf.indexOf("\n\n")) >= 0) {
          const line = buf.slice(0, i).trim(); buf = buf.slice(i + 2);
          if (!line.startsWith("data:")) continue;
          const ev = JSON.parse(line.slice(5)) as PlannerEvent;
          if (ev.type === "status") setLive((l) => ({ ...l, status: ev.text ?? "" }));
          else if (ev.type === "tool") { steps.push({ name: ev.name ?? "", summary: ev.summary ?? "" }); setLive({ steps: [...steps], status: ev.summary ?? "" }); }
          else if (ev.type === "final" || ev.type === "error") final = ev;
        }
      }
      if (!final) throw new Error("the planner stream ended without a reply");
      if (final.type === "error") throw new Error(final.text);
      if (final.plan) window.__simcity?.selectRegion?.(final.plan.focus.regionId);
      setTurns((t) => [...t, { role: "assistant", content: final!.reply || (final!.plan ? "Plan recorded." : "I could not finish a plan from that."), steps, plan: final!.plan, model: final!.provider && final!.model ? `${final!.provider} · ${final!.model}` : undefined }]);
    } catch (e) {
      setTurns((t) => [...t, { role: "assistant", content: "", error: e instanceof Error ? e.message : String(e), steps }]);
    } finally { setBusy(false); setLive({ steps: [], status: "" }); }
  }

  function build(p: PlannerPlan) {
    const sim = window.__simcity; if (!sim) return;
    sim.applyFocus({ ...p.focus, autoBreakGround: true });
    setOpen(false);
  }

  return (
    <>
      {!open && (
        <button type="button" onClick={() => setOpen(true)} className="fixed bottom-5 right-5 z-40 px-4 py-2.5 rounded-full bg-accent text-paper font-semibold shadow-lg shadow-black/40 hover:brightness-110 flex items-center gap-2" aria-label="Open the planner">
          <span className="text-base">✦</span> Plan with Muse
        </button>
      )}
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Plan with Muse" className="fixed bottom-5 right-5 z-40 w-[min(420px,calc(100vw-24px))] h-[min(620px,calc(100vh-110px))] flex flex-col rounded-xl border border-line bg-panel/95 backdrop-blur shadow-2xl shadow-black/60 text-sm">
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-line">
            <div><div className="font-semibold text-slate-1">Plan with Muse</div><div className="text-[11px] text-slate-3">Muse Spark over the SimCity estimation engine</div></div>
            <button type="button" onClick={() => setOpen(false)} className="text-slate-3 hover:text-slate-1 text-lg leading-none" aria-label="Close">×</button>
          </div>
          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {!turns.length && (
              <div className="space-y-2">
                <p className="text-slate-2">Describe a facility and a place. I look the place up, run the estimate engine, compare power mixes, and hand you a plan you can build in the simulation.</p>
                <div className="flex flex-wrap gap-1.5">{SUGGESTIONS.map((s) => <button key={s} type="button" onClick={() => send(s)} className="text-left text-[12px] px-2.5 py-1.5 rounded-md border border-line bg-paper/60 hover:border-accent/60 text-slate-2">{s}</button>)}</div>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={t.role === "user" ? "flex justify-end" : ""}>
                <div className={t.role === "user" ? "max-w-[85%] rounded-lg bg-accent/15 border border-accent/30 px-3 py-2 text-slate-1" : "space-y-2"}>
                  {t.steps && t.steps.length > 0 && <ol className="text-[11px] text-slate-3 space-y-0.5 font-mono">{t.steps.map((s, j) => <li key={j}><span className="text-accent">{s.name}</span> · {s.summary}</li>)}</ol>}
                  {t.error ? <div className="text-crit text-[12px]">{t.error}</div> : <div className="whitespace-pre-wrap text-slate-1">{t.content}</div>}
                  {t.plan && <PlanCard p={t.plan} onBuild={() => build(t.plan!)} />}
                  {t.model && <div className="text-[10px] text-slate-3 font-mono">{t.model}</div>}
                </div>
              </div>
            ))}
            {busy && (
              <div className="text-[11px] font-mono text-slate-3 space-y-0.5">
                {live.steps.map((s, j) => <div key={j}><span className="text-accent">{s.name}</span> · {s.summary}</div>)}
                <div className="animate-pulse">{live.status || "thinking"}…</div>
              </div>
            )}
          </div>
          <form className="flex gap-2 p-3 border-t border-line" onSubmit={(e) => { e.preventDefault(); send(input); }}>
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Plan a 200 MW H200 site in Norway…" className="flex-1 !m-0" disabled={busy} aria-label="Message the planner" />
            <button type="submit" disabled={busy || !input.trim()} className="px-3 rounded-md bg-accent text-paper font-semibold disabled:opacity-40">Send</button>
          </form>
        </div>
      )}
    </>
  );
}

function PlanCard({ p, onBuild }: { p: PlannerPlan; onBuild: () => void }) {
  const e = p.estimate; const v = p.verdict.replace("_", " ").toLowerCase();
  const [copied, setCopied] = useState(false);
  const share = async () => { const enc = btoa(unescape(encodeURIComponent(JSON.stringify({ ...p.focus, autoBreakGround: true })))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); const url = `${location.origin}/?focus=${enc}`; try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { prompt("Copy this link", url); } };
  return (
    <div className="rounded-lg border border-line bg-paper/70 p-3 space-y-2">
      <div className="flex items-start justify-between gap-2"><div className="font-semibold text-slate-1">{p.title}</div><span className={`pill ${p.verdict === "GO" ? "pill-go" : p.verdict === "NO_GO" ? "pill-nogo" : "pill-cond"}`}>{v}</span></div>
      <div className="text-[12px] text-slate-2">{p.place.name}, {p.place.country} · {p.itMw} MW IT · {p.gpu.toUpperCase()} @ {p.densityKw} kW · {p.mixLabel}</div>
      <div className="grid grid-cols-3 gap-2 text-[11px]">
        <Stat l="Capex" v={`$${fmt(e.capexUsdB, 2)}B`} /><Stat l="To live" v={`${e.monthsToLive} mo`} /><Stat l="EBITDA / yr" v={`$${fmt(e.ebitdaUsdMyr)}M`} />
        <Stat l="Payback" v={e.paybackYears == null ? "–" : `${fmt(e.paybackYears, 1)} yrs`} /><Stat l="CO₂ / yr" v={`${fmt(e.co2KtYr)} kt`} /><Stat l="Composite" v={fmt(e.scores.composite)} />
      </div>
      <ul className="text-[12px] text-slate-2 list-disc pl-4 space-y-0.5">{p.rationale.map((r, i) => <li key={i}>{r}</li>)}</ul>
      {p.risks.length > 0 && <div className="text-[11px] text-warn">Watch: {p.risks.join(" · ")}</div>}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onBuild} className="px-3 py-1.5 rounded-md bg-build text-paper font-semibold text-[12px]">Build it in the simulation</button>
        {p.dossierUrl && <a href={p.dossierUrl} className="px-3 py-1.5 rounded-md border border-line text-[12px] text-slate-1">Open dossier</a>}
        <button type="button" onClick={share} className="px-3 py-1.5 rounded-md border border-line text-[12px] text-slate-2 hover:text-ink">{copied ? "Link copied" : "Share plan"}</button>
      </div>
    </div>
  );
}
const Stat = ({ l, v }: { l: string; v: string }) => <div className="rounded bg-panel px-2 py-1"><div className="text-slate-3 uppercase tracking-wide text-[9px]">{l}</div><div className="font-mono text-slate-1">{v}</div></div>;
