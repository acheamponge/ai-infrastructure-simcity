// Concept renders with Muse Image: a photoreal still of the facility a spec describes, in the landscape SAM measured.
// This is a picture, not geometry; the three.js campus stays the navigable model.
import { env } from "../env";
import type { EnergyMix, SiteSpec } from "../model/types";
import { mixLabel } from "../model/energy";

export interface RenderInput {
  place: string; country: string; climate: "hot" | "temperate" | "cold";
  spec: SiteSpec; mix: EnergyMix; facilityMw: number; racks: number;
  measured?: { waterHa: number; waterNearM: number | null; solarHa: number; openHa: number; builtHa: number } | null;
  status?: string | null;
}

export function renderPrompt(i: RenderInput): string {
  const cols = Math.min(40, Math.ceil(Math.sqrt(i.racks * 2.2))), rows = Math.max(1, Math.ceil(i.racks / cols));
  const towers = Math.min(8, Math.max(2, Math.ceil(i.facilityMw / 14)));
  const land = i.measured ? [i.measured.waterHa > 2 && i.measured.waterNearM != null && i.measured.waterNearM < 1500 ? "a lake or fjord shoreline beside the site" : null, i.measured.openHa > 20 ? "wide open fields around it" : null, i.measured.solarHa > 1 ? "existing solar arrays nearby" : null, i.measured.builtHa > 5 ? "existing warehouse-scale buildings next door" : null].filter(Boolean).join(", ") : "";
  const climate = i.climate === "cold" ? "northern landscape, cool light, conifers" : i.climate === "hot" ? "dry sunlit landscape, hard shadows" : "temperate countryside, soft light";
  const supply = [i.mix.solar > 0.15 ? "fields of solar panels" : null, i.mix.wind > 0.15 ? "wind turbines on the horizon" : null, i.mix.gas > 0.2 ? "a gas turbine plant with exhaust stacks" : null, i.mix.nuclear > 0.2 ? "a compact modular reactor building" : null, i.mix.hydro > 0.2 ? "a hydroelectric dam in the distance" : null].filter(Boolean).join(", ");
  const phase = i.status === "OPERATIONAL" ? "fully built and operating" : i.status === "CONSTRUCTION" ? "partly built, with cranes and construction yards on one side" : "newly completed";
  return `Photorealistic aerial photograph at golden hour of a ${Math.round(i.facilityMw)} MW AI data center campus, ${phase}, near ${i.place}, ${i.country}. ${rows} long windowless concrete halls with white roofs lined with rooftop chillers, ${towers} cooling towers in a row, a fenced electrical substation with transformers, a diesel generator yard with fuel tanks, service roads and a parking lot. ${supply ? supply + ". " : ""}${land ? land + ". " : ""}${climate}. Power supply: ${mixLabel(i.mix)}. Documentary architectural photography, 24 mm lens, high detail, no text, no watermarks, no people.`;
}

export interface ConceptRender { image: string; prompt: string; model: string; tookMs: number; size: string }

/** One generation call; returns a JPEG data URL. Muse Image is billed per image, so callers store the result. */
export async function conceptRender(input: RenderInput, opts: { size?: string } = {}): Promise<ConceptRender> {
  if (!env.meta.key) throw new Error("MODEL_API_KEY_MUSE is not set; Muse Image runs on the Meta Model API");
  const prompt = renderPrompt(input), size = opts.size ?? "1536x1024", t0 = Date.now();
  const r = await fetch(`${env.meta.baseUrl}/images/generations`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${env.meta.key}` },
    body: JSON.stringify({ model: "muse-image-1.0", prompt, n: 1, size, response_format: "b64_json", output_format: "jpeg" }),
  });
  if (!r.ok) throw new Error(`Muse Image ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const j = (await r.json()) as { data?: Array<{ b64_json?: string; url?: string }>; output_format?: string };
  const d = j.data?.[0];
  if (!d) throw new Error("Muse Image returned no image");
  const image = d.b64_json ? `data:image/${j.output_format ?? "jpeg"};base64,${d.b64_json}` : d.url!;
  return { image, prompt, model: "muse-image-1.0", tookMs: Date.now() - t0, size };
}
