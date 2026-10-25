"use client";
import { MapContainer, TileLayer, CircleMarker, Popup } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import Link from "next/link";
import { statusLabel } from "@/lib/format";

export interface MapSite { id: string; name: string; operator: string | null; lat: number; lon: number; status: string; capacityMw: number | null; country: string; verdict?: string | null }

const colors: Record<string, string> = { OPERATIONAL: "#7fc4ff", CONSTRUCTION: "#f0b443", PLANNED: "#3fd8c6", PROPOSED: "#8d9bb0" };

export default function SiteMap({ sites, center, zoom, height = 480 }: { sites: MapSite[]; center?: [number, number]; zoom?: number; height?: number }) {
  const c = center ?? [25, 10];
  return (
    <div style={{ height }} className="rounded-[10px] overflow-hidden border border-line">
      <MapContainer center={c} zoom={zoom ?? 2} minZoom={2} style={{ height: "100%", width: "100%" }} scrollWheelZoom worldCopyJump>
        <TileLayer attribution="Tiles &copy; Esri &mdash; Esri, DeLorme, NAVTEQ" url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}" maxZoom={16} />
        {sites.map((s) => (
          <CircleMarker key={s.id} center={[s.lat, s.lon]} radius={Math.max(5, Math.min(18, 4 + Math.sqrt(s.capacityMw ?? 50) / 2))} pathOptions={{ color: colors[s.status] ?? "#64748b", fillColor: colors[s.status] ?? "#64748b", fillOpacity: 0.55, weight: 1.5 }}>
            <Popup>
              <div className="text-[13px] leading-snug">
                <Link href={`/sites/${s.id}`} className="font-semibold text-accent">{s.name}</Link>
                <div className="text-slate-2">{s.operator ?? "Operator unknown"} · {s.country}</div>
                <div>{statusLabel[s.status]} · {s.capacityMw ? `${Math.round(s.capacityMw)} MW` : "capacity unknown"}</div>
                {s.verdict && <div className="mt-1 text-xs">Verdict: <b>{s.verdict.replace("_", " ")}</b></div>}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
}
