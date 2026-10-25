"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunButton({ endpoint, body, label, primary, onDone }: { endpoint: string; body: Record<string, unknown>; label: string; primary?: boolean; onDone?: (result: unknown) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  async function go() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? r.statusText);
      setMsg("done");
      onDone?.(j);
      router.refresh();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex items-center gap-2">
      <button className={`btn ${primary ? "btn-primary" : ""}`} onClick={go} disabled={busy}>{busy ? "Running…" : label}</button>
      {msg && <span className={`text-xs ${msg === "done" ? "text-teal" : "text-crimson"}`}>{msg}</span>}
    </span>
  );
}
