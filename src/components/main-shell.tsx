"use client";
import { usePathname } from "next/navigation";

/** The simulation takes the full viewport; every other page sits in the reading column. */
export function MainShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  if (path === "/") return <main className="flex-1 min-h-0">{children}</main>;
  return <main className="flex-1 w-full max-w-7xl mx-auto px-5 py-7">{children}</main>;
}
