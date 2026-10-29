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
  open: { concept: "open land", label: "Open land", color: "#7bd68a" },
};

export interface SegObject { id: string; box: { x1: number; y1: number; x2: number; y2: number } | null; path: string; maskW: number; maskH: number; areaM2: number; confidence: number | null; nearestM: number | null }
export interface Layer { key: LayerKey; concept: string; label: string; color: string; objects: SegObject[]; areaM2: number; count: number; nearestM: number | null; error?: string }
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
export async function segment(imageDataUrl: string, concept: string, spanM: number, px: number): Promise<SegObject[]> {
  if (!env.meta.key) throw new Error("MODEL_API_KEY_MUSE is not set; SAM runs on the Meta Model API");
  const r = await fetch(`${env.meta.baseUrl}/responses`, {
    method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${env.meta.key}` },
    body: JSON.stringify({ model: env.meta.samModel, stream: true, metadata: { include_confidence: "true" }, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: imageDataUrl }] }] }),
  });
  if (!r.ok || !r.body) throw new Error(`SAM ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const parsed = parseImageStream(sseEvents(r.body) as AsyncIterable<never>);
  for await (const _ of parsed) { /* drain snapshots; the final view is what we read */ }
  const result = await parsed.finalResult;
  const records = (result as unknown as { records: Rec[] }).records ?? [];
  const masks = recordsOfKind(records as never, "mask" as never) as unknown as Rec[];
  const boxes = recordsOfKind(records as never, "box" as never) as unknown as Rec[];
  const boxById = new Map<string, Rec>();
  for (const b of boxes) boxById.set(String(b.id ?? b.objectId ?? b.object ?? ""), b);
  const objects: SegObject[] = [];
  for (const m of masks) {
    const id = String(m.id ?? m.objectId ?? m.object ?? objects.length);
    const mask = (m.mask ?? m) as never;
    let raster: Uint8Array; try { raster = decodeMaskToRaster(mask); } catch { continue; }
    const mr = m.mask as Rec | undefined;
    const mw = num(m.width ?? mr?.width ?? mr?.w), mh = num(m.height ?? mr?.height ?? mr?.h);
    const W = Number.isFinite(mw) && mw > 0 ? mw : px, H = Number.isFinite(mh) && mh > 0 ? mh : Math.round(raster.length / W);
    // area, and the nearest set pixel to the centre (where the site's coordinates sit)
    let on = 0, best = Infinity; const cx = W / 2, cy = H / 2;
    for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) if (raster[row + x]) { on++; const d = (x - cx) * (x - cx) + (y - cy) * (y - cy); if (d < best) best = d; } }
    const areaM2 = (on / (W * H)) * spanM * spanM;
    const nearestM = on ? Math.sqrt(best) * (spanM / W) : null;
    const b = boxById.get(id); const bx = b?.box as Rec | undefined;
    const box = bx && Number.isFinite(num(bx.x1)) ? { x1: num(bx.x1), y1: num(bx.y1), x2: num(bx.x2), y2: num(bx.y2) } : null;
    const conf = num(b?.c ?? b?.confidence ?? m.c ?? m.confidence);
    let path = ""; try { path = decodeMaskToSVGPath(mask); } catch { path = ""; }
    objects.push({ id, box, path, maskW: W, maskH: H, areaM2, confidence: Number.isFinite(conf) ? conf : null, nearestM });
  }
  return objects.sort((a, b) => b.areaM2 - a.areaM2);
}

/** Measure a site: four concept passes over one satellite view, summarized as the inputs the estimate engine takes. */
export async function measureSite(lat: number, lon: number, opts: { spanM?: number; px?: number } = {}): Promise<SiteMeasurement> {
  const spanM = opts.spanM ?? 1400, px = opts.px ?? 768;
  const t0 = Date.now();
  const img = await satelliteImage(lat, lon, spanM, px);
  const layers = await Promise.all((Object.keys(LAYERS) as LayerKey[]).map(async (key): Promise<Layer> => {
    const L = LAYERS[key];
    try {
      const objects = await segment(img.dataUrl, L.concept, spanM, px);
      const areaM2 = objects.reduce((a, o) => a + o.areaM2, 0);
      const nearest = objects.map((o) => o.nearestM).filter((n): n is number => n != null);
      return { key, concept: L.concept, label: L.label, color: L.color, objects, areaM2, count: objects.length, nearestM: nearest.length ? Math.min(...nearest) : null };
    } catch (e) { return { key, concept: L.concept, label: L.label, color: L.color, objects: [], areaM2: 0, count: 0, nearestM: null, error: e instanceof Error ? e.message : String(e) }; }
  }));
  const by = (k: LayerKey) => layers.find((l) => l.key === k)!;
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
