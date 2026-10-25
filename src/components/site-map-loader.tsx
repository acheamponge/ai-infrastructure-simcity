"use client";
import dynamic from "next/dynamic";
import type { MapSite } from "./site-map";

const SiteMap = dynamic(() => import("./site-map"), { ssr: false, loading: () => <div className="card h-[480px] grid place-items-center text-sm text-slate-2">Loading map…</div> });

export function SiteMapLoader(props: { sites: MapSite[]; center?: [number, number]; zoom?: number; height?: number }) {
  return <SiteMap {...props} />;
}
