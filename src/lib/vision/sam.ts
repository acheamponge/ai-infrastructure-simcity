// Footprint check with Meta's Segment Anything Model 3.1 through the Model API.
// We pull a satellite view of the site from Esri World Imagery, ask SAM for every building in it from a short noun
// phrase, decode the masks, and convert mask pixels to square metres from the image's ground span.
import { parseImageStream, recordsOfKind, decodeMaskToRaster, decodeMaskToSVGPath } from "@meta-sam/parser";
import { env } from "../env";

export interface FootprintObject { id: string; box: { x1: number; y1: number; x2: number; y2: number } | null; path: string; maskW: number; maskH: number; areaM2: number; confidence: number | null }
export interface FootprintResult { image: string; width: number; height: number; spanM: number; metersPerPixel: number; concept: string; objects: FootprintObject[]; totalAreaM2: number; mwEquivalent: number; model: string; tookMs: number; attribution: string }

const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export";

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

export async function footprintCheck(lat: number, lon: number, opts: { concept?: string; spanM?: number; px?: number } = {}): Promise<FootprintResult> {
  if (!env.meta.key) throw new Error("MODEL_API_KEY is not set; SAM runs on the Meta Model API");
  const concept = opts.concept ?? "building", spanM = opts.spanM ?? 1400, px = opts.px ?? 768;
  const t0 = Date.now();
  const img = await satelliteImage(lat, lon, spanM, px);
  const r = await fetch(`${env.meta.baseUrl}/responses`, {
    method: "POST", headers: { "content-type": "application/json", accept: "text/event-stream", authorization: `Bearer ${env.meta.key}` },
    body: JSON.stringify({ model: env.meta.samModel, stream: true, metadata: { include_confidence: "true" }, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: concept }, { type: "input_image", image_url: img.dataUrl }] }] }),
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
  const metersPerPixel = spanM / px;
  const objects: FootprintObject[] = [];
  for (const m of masks) {
    const id = String(m.id ?? m.objectId ?? m.object ?? objects.length);
    const mask = (m.mask ?? m) as never;
    let raster: Uint8Array; try { raster = decodeMaskToRaster(mask); } catch { continue; }
    const mw = num((m as Rec).width ?? (m.mask as Rec | undefined)?.width ?? (m.mask as Rec | undefined)?.w), mh = num((m as Rec).height ?? (m.mask as Rec | undefined)?.height ?? (m.mask as Rec | undefined)?.h);
    const W = Number.isFinite(mw) && mw > 0 ? mw : px, H = Number.isFinite(mh) && mh > 0 ? mh : Math.round(raster.length / W);
    let on = 0; for (let i = 0; i < raster.length; i++) on += raster[i];
    const areaM2 = (on / (W * H)) * spanM * spanM;
    const b = boxById.get(id); const bx = b?.box as Rec | undefined;
    const box = bx && Number.isFinite(num(bx.x1)) ? { x1: num(bx.x1), y1: num(bx.y1), x2: num(bx.x2), y2: num(bx.y2) } : null;
    const conf = num(b?.c ?? b?.confidence ?? m.c ?? m.confidence);
    let path = ""; try { path = decodeMaskToSVGPath(mask); } catch { path = ""; }
    objects.push({ id, box, path, maskW: W, maskH: H, areaM2, confidence: Number.isFinite(conf) ? conf : null });
  }
  objects.sort((a, b) => b.areaM2 - a.areaM2);
  const totalAreaM2 = objects.reduce((a, o) => a + o.areaM2, 0);
  // rule of thumb: roughly 1,000 m² of hall footprint per MW of facility power for hyperscale halls
  return { image: img.dataUrl, width: img.width, height: img.height, spanM, metersPerPixel, concept, objects, totalAreaM2, mwEquivalent: totalAreaM2 / 1000, model: env.meta.samModel, tookMs: Date.now() - t0, attribution: "Imagery © Esri, Maxar, Earthstar Geographics" };
}
