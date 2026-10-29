import Link from "next/link";
import { env } from "@/lib/env";
import { NavMenu } from "./nav-menu";

export function Nav() {
  const live = env.agentMode === "live";
  const brain = env.llmProvider === "meta" ? `Muse · ${env.meta.modelPlanner}` : `Crusoe · ${env.modelAdvisor}`;
  return (
    <header className="sticky top-0 z-30 border-b border-white/5 bg-[rgba(10,14,20,.72)] backdrop-blur-xl">
      <div className="max-w-[1600px] mx-auto px-5 h-14 flex items-center gap-5">
        <Link href="/" className="flex items-center gap-2.5 whitespace-nowrap group">
          <span className="relative inline-grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-accent/30 to-violet/20 border border-white/10 shadow-[0_0_18px_rgba(63,216,198,.25)]" aria-hidden>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-teal"><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16" strokeLinecap="round" /></svg>
          </span>
          <span className="font-display font-semibold tracking-tight text-[15px] leading-none">
            <span className="text-ink hidden sm:inline">AI Infrastructure </span><span className="glow-text">SimCity</span>
          </span>
        </Link>
        <NavMenu status={{ live, label: live ? `agents live · ${brain}` : "agents in fixture mode", title: live ? `Primary ${env.llmProvider}${env.llmProvider === "meta" && env.crusoeKey ? ", Crusoe fallback" : ""}; Tavily search` : "No inference key configured" }} />
      </div>
    </header>
  );
}
