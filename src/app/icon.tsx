import { ImageResponse } from "next/og";

export const size = { width: 64, height: 64 };
export const contentType = "image/png";

/** Favicon: the globe glyph from the nav on the app's dark panel. */
export default function Icon() {
  return new ImageResponse(
    (
      <div style={{ width: 64, height: 64, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(135deg, #182230, #0a0e14)", borderRadius: 14, border: "1px solid rgba(63,216,198,.35)" }}>
        <svg viewBox="0 0 24 24" width="40" height="40" fill="none" stroke="#3fd8c6" strokeWidth="1.8" strokeLinecap="round"><circle cx="12" cy="12" r="8" /><path d="M4 12h16M12 4c3 3 3 13 0 16M12 4c-3 3-3 13 0 16" /></svg>
      </div>
    ),
    size,
  );
}
