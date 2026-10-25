"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export function SiteForm({ countries }: { countries: string[] }) {
  const [f, setF] = useState({ name: "", operator: "", country: "United States", region: "", city: "", lat: "", lon: "", status: "PROPOSED", capacityMw: "300", energyNotes: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/sites", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...f, lat: Number(f.lat), lon: Number(f.lon), capacityMw: f.capacityMw ? Number(f.capacityMw) : null }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      router.push(`/sites/${j.id}`);
    } catch (ex) { setErr(ex instanceof Error ? ex.message : String(ex)); setBusy(false); }
  }
  return (
    <form onSubmit={submit} className="card p-5 grid md:grid-cols-2 gap-4 text-[13px]">
      <label className="md:col-span-2">Site name<input type="text" required value={f.name} onChange={set("name")} placeholder="e.g. Northwind campus phase 1" /></label>
      <label>Operator<input type="text" value={f.operator} onChange={set("operator")} /></label>
      <label>Status<select value={f.status} onChange={set("status")}><option value="PROPOSED">Proposed</option><option value="PLANNED">Planned</option><option value="CONSTRUCTION">Under construction</option><option value="OPERATIONAL">Operational</option></select></label>
      <label>Country<input list="countries" type="text" required value={f.country} onChange={set("country")} /><datalist id="countries">{countries.map((c) => <option key={c} value={c} />)}</datalist></label>
      <label>State / region<input type="text" value={f.region} onChange={set("region")} placeholder="Texas" /></label>
      <label>City<input type="text" value={f.city} onChange={set("city")} /></label>
      <label>Facility power (MW)<input type="number" min={1} value={f.capacityMw} onChange={set("capacityMw")} /></label>
      <label>Latitude<input type="number" step="any" required value={f.lat} onChange={set("lat")} placeholder="32.45" /></label>
      <label>Longitude<input type="number" step="any" required value={f.lon} onChange={set("lon")} placeholder="-99.73" /></label>
      <label className="md:col-span-2">Energy supply notes<input type="text" value={f.energyNotes} onChange={set("energyNotes")} placeholder="grid interconnect plus 40% solar PPA; gas turbines as bridge" /></label>
      <label className="md:col-span-2">Description<textarea rows={3} value={f.description} onChange={set("description")} /></label>
      <div className="md:col-span-2 flex items-center gap-3">
        <button className="btn btn-primary" disabled={busy}>{busy ? "Registering…" : "Register and estimate"}</button>
        {err && <span className="text-xs text-crimson">{err}</span>}
        <span className="text-xs text-slate-2">A baseline estimate is computed from country priors. Run the enrich agent on the site page to replace them with sourced values.</span>
      </div>
    </form>
  );
}
