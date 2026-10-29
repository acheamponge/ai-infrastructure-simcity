"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { SiteMeasurement, LayerKey } from "@/lib/vision/sam";

interface Measured { builtHa: number; openHa: number; waterHa: number; waterNearM: number | null; solarHa: number; spanM: number; by: string; at: string | null }
interface Scores { composite: number; environment: number; economic: number; community: number; capexUsd: number; flags: string[] }
interface Outcome { measurement: SiteMeasurement; before: Scores | null; after: Scores | null }

const fmt = (n: number | null | undefined, d = 0) => (n == null ? "–" : n.toLocaleString(undefined, { maximumFractionDigits: d }));

/** The SAM moment: look at the site, measure land, water, solar and buildings, and feed them into the estimate. */
export function SiteMeasure({ siteId, capacityMw, measured }: { siteId: string; capacityMw: number | null; measured: Measured | null }) {
  const router = useRouter();
  const [out, setOut] = useState<Outcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [span, setSpan] = useState(measured?.spanM ?? 1400);
  const [show, setShow] = useState<Record<LayerKey, boolean>>({ building: true, water: true, solar: true, open: true });

  async function run() {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/vision/measure", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ siteId, spanM: span }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? `HTTP ${r.status}`);
      setOut(j as Outcome);
      router.refresh();
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }

  const m = out?.measurement; const s = m ? { ...m.summary, spanM: m.spanM } : measured;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-3 text-[12px]">
        <label className="flex flex-col gap-1"><span className="eyebrow">View span</span><select value={span} onChange={(e) => setSpan(Number(e.target.value))} className="!w-32"><option value={700}>700 m</option><option value={1400}>1.4 km</option><option value={2500}>2.5 km</option><option value={4000}>4 km</option></select></label>
        <button type="button" onClick={run} disabled={busy} className="px-3 py-1.5 rounded-md bg-accent text-paper font-semibold disabled:opacity-50">{busy ? "Segmenting four layers…" : measured || out ? "Measure again" : "Measure the site with SAM 3.1"}</button>
        {m && <span className="text-slate-3 font-mono">{m.model} · {(m.tookMs / 1000).toFixed(1)} s</span>}
        {!m && measured && <span className="text-slate-3 font-mono">measured by {measured.by}{measured.at ? ` · ${new Date(measured.at).toLocaleDateString()}` : ""}</span>}
      </div>
      {err && <div className="text-crit text-[12px]">{err}</div>}
      {!s && !err && <p className="text-[12px] text-slate-3">Pulls a satellite view of the site and asks Segment Anything 3.1 for buildings, surface water, solar arrays and open land. The masks become hectares and distances, which replace the country priors for land and water in every estimate of this site, labelled as measured.</p>}
      {s && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-[12px]">
          <Stat l="Open land" v={`${fmt(s.openHa)} ha`} sub="buildable" />
          <Stat l="Built" v={`${fmt(s.builtHa)} ha`} sub={capacityMw ? `≈ ${fmt(s.builtHa * 10)} MW of hall vs ${fmt(capacityMw)} reported` : "existing footprint"} />
          <Stat l="Surface water" v={`${fmt(s.waterHa)} ha`} sub={s.waterNearM != null ? `${fmt(s.waterNearM)} m from the site` : "none in view"} />
          <Stat l="Solar arrays" v={`${fmt(s.solarHa)} ha`} sub={s.solarHa > 0 ? `≈ ${fmt(s.solarHa / 2.5)} MW existing` : "none in view"} />
          <Stat l="View" v={`${(s.spanM / 1000).toFixed(1)} km`} sub={`square, ${fmt(s.spanM * s.spanM / 1e4)} ha`} />
        </div>
      )}
      {out && out.before && out.after && (
        <div className="rounded-lg border border-line bg-paper/60 px-3 py-2 text-[12px] flex flex-wrap gap-x-6 gap-y-1">
          <span className="text-slate-2">Baseline composite <b className="text-slate-1 font-mono">{out.before.composite}</b> → <b className={`font-mono ${out.after.composite >= out.before.composite ? "text-good" : "text-crit"}`}>{out.after.composite}</b></span>
          <span className="text-slate-2">Environment {out.before.environment} → {out.after.environment}</span>
          <span className="text-slate-2">Economic {out.before.economic} → {out.after.economic}</span>
          <span className="text-slate-2">Capex ${fmt(out.before.capexUsd / 1e9, 2)}B → ${fmt(out.after.capexUsd / 1e9, 2)}B</span>
        </div>
      )}
      {m && (
        <div className="grid lg:grid-cols-[minmax(0,1fr)_260px] gap-4">
          <div className="relative rounded-lg overflow-hidden border border-line bg-black" style={{ aspectRatio: `${m.width} / ${m.height}` }}>
            <img src={m.image} alt="Satellite view of the site" className="absolute inset-0 w-full h-full object-cover" />
            <svg className="absolute inset-0 w-full h-full" viewBox={`0 0 ${m.width} ${m.height}`} preserveAspectRatio="none">
              {m.layers.filter((l) => show[l.key]).map((l) => l.objects.map((o) => o.path && <g key={`${l.key}-${o.id}`} transform={`translate(${o.offset.x} ${o.offset.y})`}><path d={o.path} fill={l.color + "66"} stroke={l.color} strokeWidth={1.2} vectorEffect="non-scaling-stroke"><title>{l.label} · {fmt(o.areaM2 / 1e4, 1)} ha</title></path></g>))}
              <circle cx={m.width / 2} cy={m.height / 2} r={6} fill="none" stroke="#fff" strokeWidth={2} vectorEffect="non-scaling-stroke" />
            </svg>
            <div className="absolute bottom-1 right-2 text-[9px] text-white/70">{m.attribution}</div>
          </div>
          <div className="space-y-1.5 text-[12px]">
            {m.layers.map((l) => (
              <label key={l.key} className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={show[l.key]} onChange={(e) => setShow({ ...show, [l.key]: e.target.checked })} />
                <span className="inline-block w-3 h-3 rounded-sm" style={{ background: l.color }} />
                <span className="text-slate-1">{l.label}</span>
                <span className="ml-auto font-mono text-slate-2">{l.error ? "failed" : `${l.count} · ${fmt(l.areaM2 / 1e4, 1)} ha`}</span>
              </label>
            ))}
            <p className="text-slate-3 pt-1">Each layer is one SAM pass with a noun phrase. Areas come from mask pixels over the known ground span; the white ring marks the site's coordinates.</p>
          </div>
        </div>
      )}
    </div>
  );
}
const Stat = ({ l, v, sub }: { l: string; v: string; sub?: string }) => <div className="rounded bg-paper px-3 py-2"><div className="eyebrow">{l}</div><div className="font-mono text-lg text-slate-1">{v}</div>{sub && <div className="text-[10px] text-slate-3">{sub}</div>}</div>;
