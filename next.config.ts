import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false, // the simulation is an imperative game loop; double-mounting it would attach handlers twice
  serverExternalPackages: ["@prisma/client", "prisma"],
};

export default nextConfig;
