export const money = (v: number | null | undefined, digits = 1): string => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v), s = v < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(digits)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(a >= 1e8 ? 0 : digits)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}k`;
  return `${s}$${a.toFixed(0)}`;
};
export const num = (v: number | null | undefined, digits = 0): string => (v == null || !isFinite(v) ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: digits }));
export const pct = (v: number | null | undefined, digits = 0): string => (v == null || !isFinite(v) ? "—" : `${(v * 100).toFixed(digits)}%`);
export const years = (v: number | null | undefined): string => (v == null || !isFinite(v) ? "never" : `${v.toFixed(1)} yrs`);
export const statusLabel: Record<string, string> = { OPERATIONAL: "Operational", CONSTRUCTION: "Under construction", PLANNED: "Planned", PROPOSED: "Proposed" };
export const verdictLabel: Record<string, string> = { GO: "Go", CONDITIONAL: "Conditional", NO_GO: "No go" };
export const dateShort = (d: Date | string | null | undefined): string => (d ? new Date(d).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" }) : "—");

/** Headline money at two significant figures with a tilde, for KPIs where false precision misleads. */
export const moneyRound = (v: number | null | undefined): string => {
  if (v == null || !isFinite(v)) return "—";
  const a = Math.abs(v); if (a < 1e6) return money(v, 0);
  const mag = Math.pow(10, Math.floor(Math.log10(a)) - 1);
  const r = Math.round(a / mag) * mag;
  return `≈ ${v < 0 ? "−" : ""}${money(r, r >= 1e9 && r < 1e10 ? 1 : 0).replace("−", "")}`;
};
/** Percent of a capacity, capped: above 2x it reads as a multiple, which is what it means. */
export const pctCap = (v: number | null | undefined): string => (v == null || !isFinite(v) ? "—" : v > 2 ? `${v.toFixed(v >= 10 ? 0 : 1)}× headroom` : `${Math.round(v * 100)}%`);
