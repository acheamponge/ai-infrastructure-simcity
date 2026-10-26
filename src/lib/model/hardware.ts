import type { GpuClass } from "./types";

export const GPUS: Record<GpuClass, { label: string; watts: number; costUsd: number; perf: number; rateUsdHr: number }> = {
  h100: { label: "H100 (HGX)", watts: 700, costUsd: 25000, perf: 1.0, rateUsdHr: 2.0 },
  h200: { label: "H200 (HGX)", watts: 700, costUsd: 30000, perf: 1.35, rateUsdHr: 2.4 },
  b200: { label: "B200 (HGX)", watts: 1000, costUsd: 38000, perf: 2.2, rateUsdHr: 3.2 },
  gb200: { label: "GB200 NVL72", watts: 1200, costUsd: 45000, perf: 2.8, rateUsdHr: 3.8 },
  gb300: { label: "GB300 NVL72", watts: 1400, costUsd: 55000, perf: 3.5, rateUsdHr: 4.5 },
  next: { label: "Rubin NVL144 (2028)", watts: 1800, costUsd: 75000, perf: 5.5, rateUsdHr: 6.5 },
};

export const DENSITY: Record<40 | 80 | 130, { cooling: "air" | "liquid"; basePue: number; label: string }> = {
  40: { cooling: "air", basePue: 1.45, label: "40 kW · air cooled" },
  80: { cooling: "liquid", basePue: 1.18, label: "80 kW · direct liquid" },
  130: { cooling: "liquid", basePue: 1.12, label: "130 kW · direct liquid" },
};
