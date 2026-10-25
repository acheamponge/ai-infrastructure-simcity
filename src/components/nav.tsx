import Link from "next/link";
import { env } from "@/lib/env";

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

export function Nav() {
  return (
    <header className="bg-navy text-white">
      <div className="max-w-[1600px] mx-auto px-5 h-14 flex items-center gap-6">
        <Link href="/" className="font-semibold tracking-tight text-[15px] flex items-center gap-2 whitespace-nowrap">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-400" aria-hidden />
          AI Infrastructure SimCity
        </Link>
        <nav className="flex items-center gap-1 text-[13px] overflow-x-auto">
          {links.map(([href, label]) => (
            <Link key={href} href={href} className="px-3 py-1.5 rounded hover:bg-white/10 whitespace-nowrap">
              {label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-3 text-[12px] text-white/70">
          <span className={`pill hidden md:inline-block ${env.agentMode === "live" ? "pill-go" : "pill-cond"}`}>{env.agentMode === "live" ? `agents live · ${env.modelAdvisor} / ${env.modelResearch} · tavily` : "agents in fixture mode"}</span>
          <Link href="/sites/new" className="btn !py-1 !px-2.5 !text-[12px] !bg-white/10 !text-white !border-white/20">Register a site</Link>
        </div>
      </div>
    </header>
  );
}
