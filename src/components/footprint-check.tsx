"use client";
import { useState } from "react";
import type { FootprintResult } from "@/lib/vision/sam";

const fmt = (n: number, d = 0) => n.toLocaleString(undefined, { maximumFractionDigits: d });

/** Runs SAM 3.1 over the site's satellite view and compares the built footprint with the reported capacity. */
export function FootprintCheck({ siteId, capacityMw }: { siteId: string; capacityMw: number | null }) {
  const [res, setRes] = useState<FootprintResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [concept, setConcept] = useState("building");
  const [span, setSpan] = useState(1400);
  const [sel, setSel] = useState<string | null>(null);

  async function run(fresh = false) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/vision/footprint?site=${siteId}&concept=${encodeURIComponent(concept)}&span=${span}${fresh ? "&fresh=1" : ""}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setRes(j as FootprintResult); setSel(null);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const expectedM2 = capacityMw ? capacityMw * 1000 : null;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-1"><span className="eyebrow">Find</span><input value={concept} onChange={(e) => setConcept(e.target.value)} className="!w-40" placeholder="building" /></label>
        <label className="flex flex-col gap-1"><span className="eyebrow">View span</span><select value={span} onChange={(e) => setSpan(Number(e.target.value))} className="!w-32"><option value={700}>700 m</option><option value={1400}>1.4 km</option><option value={2500}>2.5 km</option><option value={4000}>4 km</option></select></label>
        <button type="button" onClick={() => run(false)} disabled={busy} className="px-3 py-1.5 rounded-md bg-accent text-paper font-semibold disabled:opacity-50">{busy ? "Segmenting…" : res ? "Run again" : "Run footprint check"}</button>
        {res && <span className="text-slate-3 font-mono">{res.model} · {(res.tookMs / 1000).toFixed(1)} s{"cached" in res && (res as { cached?: boolean }).cached ? " · cached" : ""}</span>}
      </div>
      {err && <div className="text-crit text-[12px]">{err}</div>}
      {!res && !err && <p className="text-[12px] text-slate-3">Pulls a satellite view of the site, asks Segment Anything 3.1 for every match of the phrase, and converts the masks to square metres. A hyperscale hall runs about 1,000 m² of footprint per MW, so the result is a sanity check on reported capacity, not a survey.</p>}
      {res && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_280px] gap-4">
          <div className="relative rounded-lg overflow-hidden border border-line bg-black" style={{ aspectRatio: `${res.width} / ${res.height}` }}>
            <img src={res.image} alt="Satellite view of the site" className="absolute inset-0 w-full h-full object-cover" />
            <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${res.objects[0]?.maskW ?? res.width} ${res.objects[0]?.maskH ?? res.height}`} preserveAspectRatio="none">
              {res.objects.map((o) => o.path && <path key={o.id} d={o.path} fill={sel === o.id ? "rgba(240,180,67,.55)" : "rgba(63,216,198,.38)"} stroke={sel === o.id ? "#f0b443" : "#3fd8c6"} strokeWidth={1.5} vectorEffect="non-scaling-stroke" onMouseEnter={() => setSel(o.id)} onMouseLeave={() => setSel(null)} style={{ cursor: "pointer" }} />)}
            </svg>
            <div className="absolute bottom-1 right-2 text-[9px] text-white/70">{res.attribution}</div>
          </div>
          <div className="space-y-2 text-[12px]">
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded bg-paper px-3 py-2"><div className="eyebrow">Matches</div><div className="font-mono text-lg text-slate-1">{res.objects.length}</div></div>
              <div className="rounded bg-paper px-3 py-2"><div className="eyebrow">Built area</div><div className="font-mono text-lg text-slate-1">{fmt(res.totalAreaM2 / 1e4, 1)} ha</div></div>
              <div className="rounded bg-paper px-3 py-2"><div className="eyebrow">Implied capacity</div><div className="font-mono text-lg text-slate-1">≈ {fmt(res.mwEquivalent)} MW</div></div>
              <div className="rounded bg-paper px-3 py-2"><div className="eyebrow">Reported</div><div className="font-mono text-lg text-slate-1">{capacityMw ? `${fmt(capacityMw)} MW` : "–"}</div></div>
            </div>
            {expectedM2 && <div className="text-slate-2">Reported capacity implies about {fmt(expectedM2 / 1e4)} ha of hall. SAM found {fmt(res.totalAreaM2 / 1e4, 1)} ha of &ldquo;{res.concept}&rdquo; within {res.spanM >= 1000 ? `${res.spanM / 1000} km` : `${res.spanM} m`}, so {res.totalAreaM2 >= expectedM2 * 0.6 ? "the built footprint is consistent with the reported scale" : "most of the reported capacity is not built yet, or sits outside this view"}.</div>}
            <div className="max-h-40 overflow-y-auto border border-line rounded">
              <table className="table text-[11px]"><thead><tr><th>#</th><th className="r">m²</th><th className="r">conf.</th></tr></thead><tbody>
                {res.objects.slice(0, 20).map((o) => <tr key={o.id} onMouseEnter={() => setSel(o.id)} onMouseLeave={() => setSel(null)} className={sel === o.id ? "bg-accent/10" : ""}><td>{o.id}</td><td className="r font-mono">{fmt(o.areaM2)}</td><td className="r font-mono">{o.confidence == null ? "–" : o.confidence.toFixed(2)}</td></tr>)}
              </tbody></table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
