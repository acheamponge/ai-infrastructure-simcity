import { ImageResponse } from "next/og";

export const alt = "AI Infrastructure SimCity: plan, simulate and judge AI data centers on a living globe";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** The link preview for LinkedIn, X and Slack: title, one line, and a drawn globe with the brand glow. */
export default function OpenGraphImage() {
  const meridians = [-60, -30, 0, 30, 60];
  const parallels = [-50, -25, 0, 25, 50];
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: "flex", backgroundColor: "#080c12", backgroundImage: "radial-gradient(60% 50% at 12% 0%, rgba(63,216,198,.22), transparent 60%), radial-gradient(45% 40% at 95% 100%, rgba(240,180,67,.14), transparent 60%)", color: "#e6edf6", fontFamily: "Helvetica, Arial, sans-serif", position: "relative", overflow: "hidden" }}>
        <div style={{ position: "absolute", right: -60, top: 55, width: 560, height: 560, borderRadius: 280, border: "2px solid rgba(63,216,198,.45)", background: "radial-gradient(circle at 38% 32%, rgba(63,216,198,.22), rgba(10,14,20,.2) 62%)", boxShadow: "0 0 120px rgba(63,216,198,.25), inset 0 0 80px rgba(63,216,198,.12)", display: "flex" }}>
          {meridians.map((m) => <div key={`m${m}`} style={{ position: "absolute", left: 280 + (m / 90) * 280 - 1, top: 0, width: 2, height: 560, background: "rgba(63,216,198,.18)", borderRadius: 2, transform: `scaleY(${Math.cos((m * Math.PI) / 180)})`, transformOrigin: "center" }} />)}
          {parallels.map((p) => <div key={`p${p}`} style={{ position: "absolute", top: 280 + (p / 90) * 280 - 1, left: 0, width: 560, height: 2, background: "rgba(63,216,198,.18)", borderRadius: 2, transform: `scaleX(${Math.cos((p * Math.PI) / 180)})`, transformOrigin: "center" }} />)}
          {[[150, 210, "#f0b443"], [205, 190, "#f0b443"], [330, 150, "#3fd8c6"], [390, 240, "#5fd483"], [260, 330, "#3fd8c6"], [420, 360, "#f0b443"], [180, 390, "#5fd483"]].map(([x, y, c], i) => <div key={i} style={{ position: "absolute", left: Number(x), top: Number(y), width: 14, height: 14, borderRadius: 7, background: String(c), boxShadow: `0 0 18px ${c}` }} />)}
        </div>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", padding: "0 80px", width: 720 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 20, letterSpacing: 4, color: "#93a1b6", textTransform: "uppercase" }}><div style={{ width: 10, height: 10, borderRadius: 5, background: "#3fd8c6", boxShadow: "0 0 14px #3fd8c6" }} />Live registry · playable world</div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 16, fontSize: 64, fontWeight: 700, lineHeight: 1.05, marginTop: 22, letterSpacing: -1 }}><span>AI Infrastructure</span><span style={{ color: "#3fd8c6" }}>SimCity</span></div>
          <div style={{ fontSize: 26, color: "#b9c6d6", marginTop: 22, lineHeight: 1.35 }}>Plan a data center on a living globe, walk it in 3D, break it, and get a go / no-go from agents on Muse and Crusoe.</div>
          <div style={{ display: "flex", gap: 10, marginTop: 34 }}>{["3D simulation", "Estimation engine", "Muse Spark · SAM 3.1", "Open source"].map((t) => <div key={t} style={{ display: "flex", whiteSpace: "nowrap", fontSize: 17, padding: "7px 16px", borderRadius: 999, border: "1px solid rgba(63,216,198,.45)", color: "#bff2ea", backgroundColor: "rgba(63,216,198,.1)" }}>{t}</div>)}</div>
        </div>
      </div>
    ),
    size,
  );
}
