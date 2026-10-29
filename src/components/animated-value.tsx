"use client";
import { useEffect, useRef, useState } from "react";

const NUM = /(-?\d[\d,]*(?:\.\d+)?)/;

/** Renders a formatted value and, when it changes, tweens the first number in it from the previous value.
 *  "≈ $9.8B" → "≈ $12B" counts 9.8 → 12 over 600 ms and keeps the prefix, suffix, separators and decimals. */
export function AnimatedValue({ value, className }: { value: string; className?: string }) {
  const [shown, setShown] = useState(value);
  const prev = useRef<number | null>(null);
  const raf = useRef(0);
  useEffect(() => {
    const m = NUM.exec(value);
    if (!m || typeof window === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) { setShown(value); prev.current = m ? Number(m[1].replace(/,/g, "")) : null; return; }
    const target = Number(m[1].replace(/,/g, ""));
    const decimals = (m[1].split(".")[1] ?? "").length, grouped = m[1].includes(",");
    const from = prev.current ?? (Number.isFinite(target) ? target * 0.35 : 0);
    prev.current = target;
    if (!Number.isFinite(target) || from === target) { setShown(value); return; }
    const t0 = performance.now(), dur = 600;
    cancelAnimationFrame(raf.current);
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      const v = from + (target - from) * e;
      const text = grouped ? v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : v.toFixed(decimals);
      setShown(value.replace(NUM, text));
      if (k < 1) raf.current = requestAnimationFrame(step); else setShown(value);
    };
    raf.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf.current);
  }, [value]);
  return <span className={className}>{shown}</span>;
}
