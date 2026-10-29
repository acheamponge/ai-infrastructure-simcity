import type { Metadata } from "next";
import "./globals.css";
import { Nav } from "@/components/nav";
import { MainShell } from "@/components/main-shell";

export const metadata: Metadata = {
  title: "AI Infrastructure SimCity",
  description: "Simulate, estimate and decide where AI data centers get built: a live registry, an estimation engine, research and advisory agents, and a playable world.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Chakra+Petch:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" />
      </head>
      <body className="min-h-full flex flex-col">
        <div className="bg-fx" aria-hidden />
        <Nav />
        <MainShell>{children}</MainShell>
        <footer className="border-t border-white/5 text-xs text-slate-3 py-5 px-5 bg-[rgba(8,12,18,.5)]">
          <div className="max-w-7xl mx-auto flex flex-wrap gap-x-6 gap-y-1 justify-between">
            <span>AI Infrastructure SimCity · screening-grade estimates, not engineering or investment advice.</span>
            <span>Model coefficients and floors are documented on the Methodology page.</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
