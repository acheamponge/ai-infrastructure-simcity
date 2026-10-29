"use client";
import { useState } from "react";

/** A photoreal concept of the facility from Muse Image, drawn from the spec, the supply mix and what SAM measured. */
export function ConceptRender({ siteId, initialImage, initialPrompt }: { siteId: string; initialImage: string | null; initialPrompt: string | null }) {
  const [image, setImage] = useState<string | null>(initialImage);
  const [prompt, setPrompt] = useState<string | null>(initialPrompt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);

  async function run(fresh: boolean) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/vision/render", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId, fresh }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setImage(j.image); setPrompt(j.prompt ?? null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  return (
    <div className="card card-hover overflow-hidden flex flex-col">
      <div className="relative bg-black" style={{ aspectRatio: "3 / 2" }}>
        {image ? <img src={image} alt="Concept render of the facility" className="absolute inset-0 w-full h-full object-cover" />
          : <div className="absolute inset-0 grid place-items-center p-6 text-center"><div><div className="eyebrow eyebrow-dot mb-2">Concept render · Muse Image</div><p className="text-[12px] text-slate-3 max-w-xs">A photoreal aerial of this facility as specified: halls, towers, substation and supply, placed in the landscape SAM measured.</p></div></div>}
        {busy && <div className="absolute inset-0 grid place-items-center bg-black/60"><div className="text-[11px] uppercase tracking-[.2em] text-slate-2 font-display animate-pulse">Rendering with Muse Image</div></div>}
      </div>
      <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-[11px]">
        <span className="eyebrow">Concept · Muse Image 1.0</span>
        <span className="ml-auto flex gap-1.5">
          {prompt && <button type="button" className="text-slate-3 hover:text-ink" onClick={() => setShowPrompt((v) => !v)}>{showPrompt ? "Hide prompt" : "Prompt"}</button>}
          <button type="button" className="btn !py-1 !px-2.5 !text-[11px]" disabled={busy} onClick={() => run(!!image)}>{image ? "Render again" : "Render concept"}</button>
        </span>
      </div>
      {err && <div className="px-3 pb-2 text-[11px] text-crit">{err}</div>}
      {showPrompt && prompt && <div className="px-3 pb-3 text-[11px] text-slate-3 leading-relaxed">{prompt}</div>}
    </div>
  );
}
