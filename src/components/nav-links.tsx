"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/", "Simulation"],
  ["/overview", "Overview"],
  ["/atlas", "Atlas"],
  ["/executive", "Executive"],
  ["/policy", "Policy"],
  ["/investor", "Investor"],
  ["/agents", "Agents"],
  ["/methodology", "Methodology"],
] as const;

export function NavLinks() {
  const path = usePathname();
  return (
    <nav className="flex-1 min-w-0 flex items-center gap-0.5 text-[13px] overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Primary">
      {links.map(([href, label]) => {
        const active = href === "/" ? path === "/" : path.startsWith(href) || (href === "/atlas" && path.startsWith("/sites"));
        return (
          <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`relative px-3 py-1.5 rounded-lg whitespace-nowrap transition-colors ${active ? "text-ink bg-white/8" : "text-slate-2 hover:text-ink hover:bg-white/5"}`}>
            {label}
            {active && <span className="absolute left-3 right-3 -bottom-[13px] h-[2px] rounded-full bg-accent shadow-[0_0_10px_rgba(63,216,198,.8)]" aria-hidden />}
          </Link>
        );
      })}
    </nav>
  );
}
