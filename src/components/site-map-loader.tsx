"use client";
import dynamic from "next/dynamic";
import type { MapSite } from "./site-map";
import { MapSkeleton } from "./skeleton";

const SiteMap = dynamic(() => import("./site-map"), { ssr: false, loading: () => <MapSkeleton /> });

export function SiteMapLoader(props: { sites: MapSite[]; center?: [number, number]; zoom?: number; height?: number }) {
  return <SiteMap {...props} />;
}
