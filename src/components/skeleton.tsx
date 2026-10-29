/** Loading placeholders that match the shape of what they replace, so no page first-paints as an empty box. */
export function Shimmer({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return <div className={`skel ${className}`} style={style} aria-hidden />;
}

export function KpiSkeleton({ n = 4 }: { n?: number }) {
  return <div className={`grid grid-cols-2 md:grid-cols-${Math.min(5, n)} gap-3`}>{Array.from({ length: n }).map((_, i) => <div key={i} className="card px-4 py-3"><Shimmer className="h-2.5 w-20 mb-3" /><Shimmer className="h-6 w-28 mb-2" /><Shimmer className="h-2.5 w-24" /></div>)}</div>;
}

export function TableSkeleton({ rows = 6, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="card overflow-hidden">
      <div className="flex gap-4 px-4 py-3 border-b border-line">{Array.from({ length: cols }).map((_, i) => <Shimmer key={i} className="h-2.5 flex-1" />)}</div>
      {Array.from({ length: rows }).map((_, r) => <div key={r} className="flex gap-4 px-4 py-3.5 border-b border-line last:border-0">{Array.from({ length: cols }).map((_, c) => <Shimmer key={c} className={`h-3 flex-1 ${c === 0 ? "max-w-[180px]" : ""}`} style={{ opacity: 1 - r * 0.1 }} />)}</div>)}
    </div>
  );
}

export function ChartSkeleton({ height = 220, bars = 6 }: { height?: number; bars?: number }) {
  return (
    <div className="card p-4"><Shimmer className="h-2.5 w-32 mb-4" />
      <div className="flex flex-col gap-2.5" style={{ height: height - 40 }}>{Array.from({ length: bars }).map((_, i) => <div key={i} className="flex items-center gap-3"><Shimmer className="h-2.5 w-20" /><Shimmer className="h-4 rounded-r" style={{ width: `${85 - i * 12}%` } as React.CSSProperties} /></div>)}</div>
    </div>
  );
}

export function MapSkeleton({ height = 480 }: { height?: number }) {
  return (
    <div className="card relative overflow-hidden grid place-items-center" style={{ height }} aria-busy>
      <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.05)_1px,transparent_1px)] [background-size:40px_40px]" />
      <div className="absolute inset-0 bg-[radial-gradient(60%_60%_at_50%_50%,rgba(63,216,198,.08),transparent_70%)]" />
      <div className="relative text-[11px] uppercase tracking-[.2em] text-slate-3 font-display animate-pulse">Loading basemap</div>
    </div>
  );
}

export function PageSkeleton({ kpis = 4, chart = true, rows = 8 }: { kpis?: number; chart?: boolean; rows?: number }) {
  return (
    <div className="flex flex-col gap-5" aria-busy>
      <div><Shimmer className="h-2.5 w-28 mb-3" /><Shimmer className="h-8 w-80 mb-3" /><Shimmer className="h-3 w-[32rem] max-w-full" /></div>
      <KpiSkeleton n={kpis} />
      {chart && <div className="grid lg:grid-cols-[1.2fr_1fr] gap-5"><ChartSkeleton /><ChartSkeleton bars={4} /></div>}
      <TableSkeleton rows={rows} />
    </div>
  );
}
