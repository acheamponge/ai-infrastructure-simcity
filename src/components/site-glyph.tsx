import Link from "next/link";

/** An isometric glyph of the facility the simulation would build: hall with rack rows, towers, generators, substation.
 *  Drawn from the spec so every dossier carries a picture of its own site; the link opens the real 3D view. */
export function SiteGlyph({ siteId, racks, facilityMw, live, label }: { siteId: string; racks: number; facilityMw: number; live: boolean; label?: string }) {
  const cols = Math.min(40, Math.ceil(Math.sqrt(racks * 2.2))), rows = Math.max(1, Math.ceil(racks / cols));
  const towers = Math.min(8, Math.max(2, Math.ceil(facilityMw / 14))), gens = Math.min(10, Math.max(2, Math.ceil(facilityMw / 40)));
  const W = 150, D = Math.min(130, 36 + rows * 6);
  const iso = (x: number, y: number, z = 0) => [150 + (x - y) * 0.87, 70 + (x + y) * 0.5 - z] as const;
  const poly = (pts: Array<readonly [number, number]>) => pts.map((p) => p.join(",")).join(" ");
  const box = (x: number, y: number, w: number, d: number, h: number, top: string, left: string, right: string, key: string) => {
    const a = iso(x, y, h), b = iso(x + w, y, h), c = iso(x + w, y + d, h), e = iso(x, y + d, h), f = iso(x, y + d, 0), g = iso(x + w, y + d, 0), k = iso(x + w, y, 0);
    return <g key={key}><polygon points={poly([a, b, c, e])} fill={top} /><polygon points={poly([e, c, g, f])} fill={left} /><polygon points={poly([c, b, k, g])} fill={right} /></g>;
  };
  const accent = live ? "#3fd8c6" : "#f0b443";
  return (
    <Link href={`/?site=${siteId}`} className="group block card card-hover overflow-hidden" aria-label="Open this site in the simulation">
      <svg viewBox="0 0 300 190" className="w-full h-auto block" role="img">
        <defs><radialGradient id="pad" cx="50%" cy="45%" r="60%"><stop offset="0" stopColor="#1b2a22" /><stop offset="1" stopColor="#0d141a" /></radialGradient></defs>
        <rect width="300" height="190" fill="url(#pad)" />
        <polygon points={poly([iso(-30, -30), iso(W + 60, -30), iso(W + 60, D + 60), iso(-30, D + 60)])} fill="#141d26" stroke="#223040" />
        {/* substation and feeder */}
        {box(-22, 10, 10, 14, 10, "#6b7684", "#4b5563", "#56616f", "sub")}
        <polyline points={poly([iso(-12, 17, 12), iso(10, 17, 16), iso(40, 17, 16)])} fill="none" stroke={accent} strokeOpacity=".8" strokeWidth="1" />
        {/* generator yard */}
        {Array.from({ length: gens }).map((_, i) => box(-22 + (i % 2) * 7, 40 + Math.floor(i / 2) * 9, 5, 7, 5, "#5a6572", "#3f4852", "#4a545f", `g${i}`))}
        {/* hall */}
        {box(0, 0, W, D, 18, "#2a3a4f", "#1b2838", "#223346", "hall")}
        {Array.from({ length: rows }).map((_, r) => <line key={`r${r}`} x1={iso(6, 8 + r * ((D - 16) / Math.max(1, rows)), 18)[0]} y1={iso(6, 8 + r * ((D - 16) / Math.max(1, rows)), 18)[1]} x2={iso(W - 6, 8 + r * ((D - 16) / Math.max(1, rows)), 18)[0]} y2={iso(W - 6, 8 + r * ((D - 16) / Math.max(1, rows)), 18)[1]} stroke={accent} strokeOpacity={live ? .55 : .3} strokeWidth="1.2" />)}
        {/* rooftop chillers */}
        {Array.from({ length: Math.min(8, Math.max(2, Math.ceil(facilityMw / 20))) }).map((_, i) => box(8 + i * (W - 16) / Math.max(1, Math.min(8, Math.max(2, Math.ceil(facilityMw / 20))) - 1) - 3, 2, 7, 5, 4, "#a9b4c0", "#7d8894", "#8e99a5", `c${i}`))}
        {/* cooling towers */}
        {Array.from({ length: towers }).map((_, i) => { const [cx, cy] = iso(W + 14, 8 + i * ((D - 10) / Math.max(1, towers - 1))); return <g key={`t${i}`}><ellipse cx={cx} cy={cy - 9} rx="5" ry="2.6" fill="#8d99a6" /><rect x={cx - 5} y={cy - 9} width="10" height="9" fill="#6f7a86" /><ellipse cx={cx} cy={cy} rx="5" ry="2.6" fill="#5c6672" /><ellipse cx={cx} cy={cy - 9} rx="3" ry="1.5" fill={accent} fillOpacity={live ? .9 : .25} /></g>; })}
        <text x="10" y="178" fill="#93a1b6" fontSize="9" fontFamily="var(--font-mono)">{label ?? `${racks.toLocaleString()} racks · ${rows} rows · ${Math.round(facilityMw)} MW · ${live ? "live" : "to build"}`}</text>
        <text x="290" y="178" fill={accent} fontSize="9" fontFamily="var(--font-display)" textAnchor="end" className="group-hover:underline">OPEN IN 3D →</text>
      </svg>
    </Link>
  );
}
