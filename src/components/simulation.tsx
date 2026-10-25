"use client";
import { useEffect } from "react";
import "@/sim/sim.css";
import { MARKUP } from "@/sim/markup";
import type { SimRegion } from "@/lib/sim-bridge";

export interface SimFocus { regionId: string; cfg?: Record<string, unknown>; autoBreakGround?: boolean; label?: string }

/** Mounts the game loop onto static markup. The sim owns everything inside .simroot. */
export function Simulation({ realSites, focus }: { realSites: SimRegion[]; focus?: SimFocus }) {
  useEffect(() => {
    let sim: { stop: () => void } | null = null;
    let cancelled = false;
    import("@/sim/sim").then((m) => {
      if (cancelled) return;
      sim = m.startSim({ realSites, focus });
    });
    return () => { cancelled = true; sim?.stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return <div className="simroot h-[calc(100vh-56px)] min-h-[560px]" dangerouslySetInnerHTML={{ __html: MARKUP }} />;
}
