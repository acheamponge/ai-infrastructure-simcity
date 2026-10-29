import Link from "next/link";
import { statusLabel, verdictLabel } from "@/lib/format";

export function Kpi({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" | "bad" }) {
  const color = tone === "good" ? "text-teal" : tone === "warn" ? "text-amber" : tone === "bad" ? "text-crimson" : "glow-text";
  const bar = tone === "good" ? "from-teal" : tone === "warn" ? "from-amber" : tone === "bad" ? "from-crimson" : "from-accent";
  return (
    <div className="card card-hover px-4 py-3 min-w-0 overflow-hidden">
      <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r bg-gradient-to-b ${bar} to-transparent`} aria-hidden />
      <div className="eyebrow">{label}</div>
      <div className={`num text-[24px] font-semibold mt-1 leading-tight ${color}`}>{value}</div>
      {sub && <div className="text-xs text-slate-2 mt-0.5">{sub}</div>}
    </div>
  );
}

export function StatusPill({ status }: { status: string }) {
  const cls = { OPERATIONAL: "pill-op", CONSTRUCTION: "pill-con", PLANNED: "pill-plan", PROPOSED: "pill-prop" }[status] ?? "";
  return <span className={`pill ${cls}`}>{statusLabel[status] ?? status}</span>;
}

export function VerdictPill({ verdict }: { verdict: string | null | undefined }) {
  if (!verdict) return <span className="pill">Not assessed</span>;
  const cls = { GO: "pill-go", CONDITIONAL: "pill-cond", NO_GO: "pill-nogo" }[verdict] ?? "";
  return <span className={`pill ${cls}`}>{verdictLabel[verdict] ?? verdict}</span>;
}

export function Score({ value, label }: { value: number; label?: string }) {
  const tone = value >= 65 ? "from-teal to-accent" : value >= 45 ? "from-amber to-[#f7d27a]" : "from-crimson to-[#ff8a95]";
  return (
    <div className="flex items-center gap-2 min-w-[120px]">
      <div className="flex-1 h-1.5 rounded-full bg-white/8 overflow-hidden"><div className={`h-full rounded-full bg-gradient-to-r ${tone}`} style={{ width: `${Math.max(2, Math.min(100, value))}%` }} /></div>
      <span className="num text-xs w-7 text-right">{Math.round(value)}</span>
      {label && <span className="text-xs text-slate-2">{label}</span>}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 mb-3">
      <h2 className="section-title">{children}</h2>
      {action}
    </div>
  );
}

export function PageHeader({ eyebrow, title, lede, action }: { eyebrow?: string; title: string; lede?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 mb-7 rise">
      <div className="max-w-3xl">
        {eyebrow && <div className="eyebrow eyebrow-dot mb-2">{eyebrow}</div>}
        <h1 className="text-[28px] md:text-[32px] font-semibold leading-tight hero-title">{title}</h1>
        {lede && <p className="text-[14px] text-slate-2 mt-2 leading-relaxed">{lede}</p>}
      </div>
      {action}
    </div>
  );
}

export function SiteLink({ id, name }: { id: string; name: string }) {
  return <Link href={`/sites/${id}`} className="font-medium text-accent hover:underline underline-offset-2">{name}</Link>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="card p-8 text-center text-sm text-slate-2">{children}</div>;
}
