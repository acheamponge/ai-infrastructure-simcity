// Site measurement with Meta's Segment Anything Model 3.1 through the Model API.
//
// We pull a satellite view of the site from Esri World Imagery and ask SAM for one concept per request:
// buildings, water, solar panels and open land. Each mask is decoded and turned into ground area from the
// image's known span, water gets a distance from the site centre, and the result feeds the estimate engine
// as measured inputs that replace the country priors for land and water.
import { parseImageStream, recordsOfKind, decodeMaskToRaster, decodeMaskToSVGPath } from "@meta-sam/parser";
import { env } from "../env";

export type LayerKey = "building" | "water" | "solar" | "open";
export const LAYERS: Record<LayerKey, { concept: string; label: string; color: string }> = {
  building: { concept: "building", label: "Buildings", color: "#3fd8c6" },
  water: { concept: "water", label: "Surface water", color: "#3a8dff" },
  solar: { concept: "solar panels", label: "Solar arrays", color: "#f0b443" },
  open: { concept: "field", label: "Open land", color: "#7bd68a" }, // SAM answers "field"; "open land" returns nothing
};

export interface SegObject { id: string; box: { x1: number; y1: number; x2: number; y2: number } | null; path: string; maskW: number; maskH: number; areaM2: number; confidence: number | null; nearestM: number | null; offset: { x: number; y: number } }
export interface Layer { key: LayerKey; concept: string; label: string; color: string; objects: SegObject[]; areaM2: number; count: number; nearestM: number | null; error?: string; debug?: unknown }
export interface SiteMeasurement {
  image: string; width: number; height: number; spanM: number; metersPerPixel: number; model: string; tookMs: number; attribution: string; measuredAt: string;
  layers: Layer[];
  summary: { builtHa: number; waterHa: number; waterNearM: number | null; solarHa: number; openHa: number };
}
/** Kept for the footprint-only route. */
export interface FootprintResult { image: string; width: number; height: number; spanM: number; metersPerPixel: number; concept: string; objects: SegObject[]; totalAreaM2: number; mwEquivalent: number; model: string; tookMs: number; attribution: string }

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";
export const ATTRIBUTION = "Imagery © Esri, Maxar, Earthstar Geographics";

async function satelliteImage(lat: number, lon: number, spanM: number, px: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const dLat = spanM / 2 / 111320, dLon = spanM / 2 / (111320 * Math.cos((lat * Math.PI) / 180));
  const bbox = `${lon - dLon},${lat - dLat},${lon + dLon},${lat + dLat}`;
  const url = `${ESRI}?bbox=${bbox}&bboxSR=4326&imageSR=4326&size=${px},${px}&format=jpg&f=image`;
  const r = await fetch(url, { headers: { accept: "image/*" } });
  if (!r.ok) throw new Error(`satellite imagery ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const type = r.headers.get("content-type")?.split(";")[0] || "image/jpeg";
  if (!type.startsWith("image/")) throw new Error(`satellite imagery returned ${type}: ${buf.toString("utf8").slice(0, 200)}`);
  return { dataUrl: `data:${type};base64,${buf.toString("base64")}`, width: px, height: px };
}

/** Turn the Responses SSE body into the event objects the SAM parser consumes. */
async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader(); const dec = new TextDecoder(); let buf = "";
  while (true) {
    const { value, done } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = chunk.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") continue;
      try { yield JSON.parse(data) as Record<string, unknown>; } catch { /* keep-alive or partial */ }
    }
  }
}

type Rec = Record<string, unknown>;
const num = (v: unknown) => (typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN);

/** One SAM pass: every match of a noun phrase in the image, with areas in square metres and distance to the image centre. */
export async function segment(imageDataUrl: string, concept: string, spanM: number, px: number, debug?: { out: Record<string, unknown> }): Promise<SegObject[]> {
  if (!env.meta.key) throw new Error("MODEL_API_KEY_MUSE is not set; SAM runs on the Meta Model API");
  const r = await fetch(`${env.meta.baseUrl}/responses`, {
    method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${env.meta.key}` },
    body: JSON.stringify({ model: env.meta.samModel, stream: true, metadata: { include_confidence: "true" }, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: imageDataUrl }] }] }),
  });
  if (!r.ok || !r.body) throw new Error(`SAM ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const events: Record<string, unknown>[] = [];
  const tap = async function* () { for await (const e of sseEvents(r.body!)) { if (debug && events.length < 400) events.push(e); yield e; } };
  const parsed = parseImageStream(tap() as AsyncIterable<never>);
  for await (const _ of parsed) { /* drain snapshots; the final view is what we read */ }
  const result = await parsed.finalResult;
  const records = (result as unknown as { records: Rec[] }).records ?? [];
  if (debug) {
    const res = result as unknown as Rec;
    debug.out = { resultKeys: Object.keys(res), outcome: res.outcome, diagnostics: res.diagnostics, rawOutputHead: typeof res.rawOutput === "string" ? (res.rawOutput as string).slice(0, 600) : res.rawOutput, recordCount: records.length, recordKinds: [...new Set(records.map((x) => String(x.kind ?? x.type ?? "?")))], firstRecord: records[0] ? Object.fromEntries(Object.entries(records[0]).map(([k, v]) => [k, typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : v])) : null, eventTypes: [...new Set(events.map((e) => String(e.type)))], eventSample: events.slice(0, 3).map((e) => JSON.stringify(e).slice(0, 300)), eventCount: events.length };
  }
  const masks = recordsOfKind(records as never, "mask" as never) as unknown as Rec[];
  const boxes = recordsOfKind(records as never, "box" as never) as unknown as Rec[];
  const boxById = new Map<string, Rec>();
  for (const b of boxes) boxById.set(String(b.objectId ?? b.id ?? b.object ?? ""), b);
  if (debug) debug.out.firstMask = masks[0] ? Object.fromEntries(Object.entries(masks[0]).map(([k, v]) => [k, typeof v === "string" && v.length > 120 ? v.slice(0, 120) + "…" : v && typeof v === "object" ? Object.fromEntries(Object.entries(v as Rec).map(([kk, vv]) => [kk, typeof vv === "string" && vv.length > 80 ? vv.slice(0, 80) + "…" : vv])) : v])) : null;
  // the parser's boxes are exclusive on the right and bottom edges, and each mask raster is the crop inside its box
  const mpp = spanM / px, cx = px / 2, cy = px / 2;
  const objects: SegObject[] = [];
  for (const m of masks) {
    const id = String(m.objectId ?? m.id ?? m.object ?? objects.length);
    const mask = (m.mask ?? m) as never;
    let raster: Uint8Array; try { raster = decodeMaskToRaster(mask); } catch { continue; }
    const b = boxById.get(id);
    const left = num(b?.left), top = num(b?.top), right = num(b?.right), bottom = num(b?.bottom);
    const hasBox = [left, top, right, bottom].every(Number.isFinite);
    const mr = (m.mask ?? {}) as Rec;
    let W = num(mr.width ?? m.width), H = num(mr.height ?? m.height);
    if (!(W > 0 && H > 0)) { if (hasBox && (right - left) * (bottom - top) === raster.length) { W = right - left; H = bottom - top; } else { W = px; H = Math.round(raster.length / W); } }
    const ox = hasBox ? left : 0, oy = hasBox ? top : 0;
    let on = 0, best = Infinity;
    for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) if (raster[row + x]) { on++; const dx = ox + x - cx, dy = oy + y - cy; const d = dx * dx + dy * dy; if (d < best) best = d; } }
    const areaM2 = on * mpp * mpp;
    const nearestM = on ? Math.sqrt(best) * mpp : null;
    const box = hasBox ? { x1: left, y1: top, x2: right, y2: bottom } : null;
    const conf = num(b?.confidence ?? m.confidence ?? b?.c ?? m.c);
    let path = ""; try { path = decodeMaskToSVGPath(mask); } catch { path = ""; }
    objects.push({ id, box, path, maskW: W, maskH: H, areaM2, confidence: Number.isFinite(conf) ? conf : null, nearestM, offset: { x: ox, y: oy } });
  }
  return objects.sort((a, b) => b.areaM2 - a.areaM2);
}

/** Measure a site: four concept passes over one satellite view, summarized as the inputs the estimate engine takes. */
export async function measureSite(lat: number, lon: number, opts: { spanM?: number; px?: number; debug?: boolean; concepts?: string[] } = {}): Promise<SiteMeasurement> {
  const spanM = opts.spanM ?? 1400, px = opts.px ?? 768;
  const t0 = Date.now();
  const img = await satelliteImage(lat, lon, spanM, px);
  const plan: Array<{ key: LayerKey; concept: string; label: string; color: string }> = opts.concepts?.length ? opts.concepts.map((c, i) => ({ key: (Object.keys(LAYERS) as LayerKey[])[i % 4], concept: c, label: c, color: "#fff" })) : (Object.keys(LAYERS) as LayerKey[]).map((key) => ({ key, ...LAYERS[key] }));
  const layers = await Promise.all(plan.map(async ({ key, ...L }): Promise<Layer> => {
    try {
      const dbg = opts.debug ? { out: {} as Record<string, unknown> } : undefined;
      const objects = await segment(img.dataUrl, L.concept, spanM, px, dbg);
      const areaM2 = objects.reduce((a, o) => a + o.areaM2, 0);
      const nearest = objects.map((o) => o.nearestM).filter((n): n is number => n != null);
      return { key, concept: L.concept, label: L.label, color: L.color, objects, areaM2, count: objects.length, nearestM: nearest.length ? Math.min(...nearest) : null, debug: dbg?.out };
    } catch (e) { return { key, concept: L.concept, label: L.label, color: L.color, objects: [], areaM2: 0, count: 0, nearestM: null, error: e instanceof Error ? e.message : String(e) }; }
  }));
  const by = (k: LayerKey) => layers.find((l) => l.key === k && l.concept === LAYERS[k].concept) ?? { areaM2: 0, nearestM: null };
  const ha = (m2: number) => m2 / 1e4;
  return {
    image: img.dataUrl, width: img.width, height: img.height, spanM, metersPerPixel: spanM / px, model: env.meta.samModel, tookMs: Date.now() - t0, attribution: ATTRIBUTION, measuredAt: new Date().toISOString(),
    layers,
    summary: { builtHa: ha(by("building").areaM2), waterHa: ha(by("water").areaM2), waterNearM: by("water").nearestM, solarHa: ha(by("solar").areaM2), openHa: ha(by("open").areaM2) },
  };
}

/** Buildings only, for the quick footprint route. */
export async function footprintCheck(lat: number, lon: number, opts: { concept?: string; spanM?: number; px?: number } = {}): Promise<FootprintResult> {
  const concept = opts.concept ?? "building", spanM = opts.spanM ?? 1400, px = opts.px ?? 768;
  const t0 = Date.now();
  const img = await satelliteImage(lat, lon, spanM, px);
  const objects = await segment(img.dataUrl, concept, spanM, px);
  const totalAreaM2 = objects.reduce((a, o) => a + o.areaM2, 0);
  return { image: img.dataUrl, width: img.width, height: img.height, spanM, metersPerPixel: spanM / px, concept, objects, totalAreaM2, mwEquivalent: totalAreaM2 / 1000, model: env.meta.samModel, tookMs: Date.now() - t0, attribution: ATTRIBUTION };
}

/** The parts of a measurement worth keeping: the view and every mask, without rasters. About 150 KB per site. */
export interface StoredLayers { image: string; width: number; height: number; spanM: number; model: string; measuredAt: string; attribution: string; layers: Array<{ key: LayerKey; label: string; color: string; concept: string; count: number; areaM2: number; nearestM: number | null; objects: Array<{ id: string; path: string; offset: { x: number; y: number }; areaM2: number; confidence: number | null }> }> }
export function toStoredLayers(m: SiteMeasurement): StoredLayers {
  return { image: m.image, width: m.width, height: m.height, spanM: m.spanM, model: m.model, measuredAt: m.measuredAt, attribution: m.attribution, layers: m.layers.map((l) => ({ key: l.key, label: l.label, color: l.color, concept: l.concept, count: l.count, areaM2: l.areaM2, nearestM: l.nearestM, objects: l.objects.slice(0, 60).map((o) => ({ id: o.id, path: o.path, offset: o.offset, areaM2: o.areaM2, confidence: o.confidence })) })) };
}
