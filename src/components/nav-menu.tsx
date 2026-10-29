"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

const links = [
  ["/", "Simulation", "Globe, planner and the 3D world"],
  ["/overview", "Overview", "What the registry holds today"],
  ["/atlas", "Atlas", "Every tracked site on a map"],
  ["/executive", "Executive", "Pipeline, capex, critical paths"],
  ["/policy", "Policy", "Grid, water, carbon, community"],
  ["/investor", "Investor", "IRR, NPV and what flips them"],
  ["/agents", "Agents", "Runs, sources and token use"],
  ["/methodology", "Methodology", "How every number is made"],
] as const;

/** Primary navigation: inline links on wide screens, a hamburger with a drawer below that. */
export function NavMenu({ status }: { status: { live: boolean; label: string; title: string } }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => { setOpen(false); }, [path]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey); document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = ""; };
  }, [open]);
  const isActive = (href: string) => (href === "/" ? path === "/" : path.startsWith(href) || (href === "/atlas" && path.startsWith("/sites")));
  return (
    <>
      <nav className="hidden lg:flex flex-1 min-w-0 items-center gap-0.5 text-[13px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Primary">
        {links.map(([href, label]) => {
          const active = isActive(href);
          return (
            <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`relative px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${active ? "text-ink bg-white/8" : "text-slate-2 hover:text-ink hover:bg-white/5"}`}>
              {label}
              {active && <span className="absolute left-3 right-3 -bottom-[13px] h-[2px] rounded-full bg-accent shadow-[0_0_10px_rgba(63,216,198,.8)]" aria-hidden />}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto hidden lg:flex items-center gap-3 text-[12px] shrink-0">
        <span className="hidden xl:inline-block"><span className={`pill ${status.live ? "pill-go pill-live" : "pill-cond"}`} title={status.title}>{status.label}</span></span>
        <span className={`xl:hidden w-2 h-2 rounded-full ${status.live ? "bg-good shadow-[0_0_8px_#5fd483]" : "bg-amber"}`} title={status.title} aria-label={status.label} />
        <Link href="/sites/new" className="btn btn-primary !py-1.5 !px-3 !text-[11px]">Register a site</Link>
      </div>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="mobile-menu" aria-label={open ? "Close menu" : "Open menu"} className="ml-auto lg:hidden relative w-10 h-10 rounded-lg border border-white/10 bg-white/5 grid place-items-center">
        <span className="relative block w-[18px] h-[12px]" aria-hidden>
          <span className="absolute left-0 right-0 h-[2px] rounded bg-ink transition-all duration-200" style={{ top: open ? 5 : 0, transform: open ? "rotate(45deg)" : "none" }} />
          <span className="absolute left-0 right-0 h-[2px] rounded bg-ink transition-opacity duration-200" style={{ top: 5, opacity: open ? 0 : 1 }} />
          <span className="absolute left-0 right-0 h-[2px] rounded bg-ink transition-all duration-200" style={{ top: open ? 5 : 10, transform: open ? "rotate(-45deg)" : "none" }} />
        </span>
      </button>
      {open && typeof document !== "undefined" && createPortal(
        <div className="lg:hidden fixed inset-x-0 top-14 bottom-0 z-40" role="dialog" aria-modal="true" id="mobile-menu">
          <div className="absolute inset-0" style={{ background: "rgba(0,0,0,.55)", backdropFilter: "blur(2px)" }} onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-0 bottom-0 w-[min(360px,88vw)] border-l border-white/8 shadow-2xl shadow-black/60 flex flex-col overflow-y-auto drawer-in" style={{ background: "rgba(12,17,24,.98)" }}>
            <div className="px-4 py-3 border-b border-white/8"><span className={`pill ${status.live ? "pill-go pill-live" : "pill-cond"}`} title={status.title}>{status.label}</span></div>
            <ul className="py-2">
              {links.map(([href, label, hint]) => {
                const active = isActive(href);
                return (
                  <li key={href}>
                    <Link href={href} aria-current={active ? "page" : undefined} className={`flex items-center gap-3 px-4 py-3 border-l-2 transition-colors ${active ? "border-accent bg-white/6 text-ink" : "border-transparent text-slate-2 hover:text-ink hover:bg-white/4"}`}>
                      <span className="flex-1"><span className="block text-[15px] font-display font-semibold">{label}</span><span className="block text-[11px] text-slate-3">{hint}</span></span>
                      {active && <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-[0_0_8px_rgba(63,216,198,.8)]" aria-hidden />}
                    </Link>
                  </li>
                );
              })}
            </ul>
            <div className="mt-auto p-4 border-t border-white/8"><Link href="/sites/new" className="btn btn-primary w-full justify-center">Register a site</Link></div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
