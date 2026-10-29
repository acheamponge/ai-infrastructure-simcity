"use client";
import { useEffect, useRef, useState } from "react";
import { useFocusTrap } from "./use-focus-trap";

const STEPS = [
  { title: "Pick a place", body: "Spin the globe or search a region. Amber diamonds are real tracked sites; every pin shows power price, grid carbon, labor and sentiment.", hint: "Globe, left" },
  { title: "Ask Muse for a plan", body: "Describe a facility in the planner. It looks the place up, runs the estimate engine, compares power mixes and hands back a plan with a verdict.", hint: "Plan with Muse, bottom right" },
  { title: "Build it and walk it", body: "Start construction, speed up the clock, then open the 3D site: campus, data hall, racks and GPUs. Simulate a coolant leak or a power loss and watch the crew fix it.", hint: "Sites tab, right panel" },
];
const KEY = "simcity.tour.v1";

/** A three-step first-visit tour over the simulation. Dismissed state is remembered per browser. */
export function Tour() {
  const [step, setStep] = useState<number | null>(null);
  const box = useRef<HTMLDivElement>(null);
  useFocusTrap(box, step !== null);
  useEffect(() => {
    try { if (!localStorage.getItem(KEY)) setStep(0); } catch { /* storage unavailable */ }
  }, []);
  const close = () => { setStep(null); try { localStorage.setItem(KEY, "done"); } catch { /* ignore */ } };
  if (step === null) return null;
  const s = STEPS[step];
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]" role="dialog" aria-modal="true" aria-labelledby="tour-title" onClick={close}>
      <div ref={box} className="card card-accent w-full max-w-md p-6 rise" onClick={(e) => e.stopPropagation()}>
        <div className="eyebrow eyebrow-dot mb-3">Welcome · step {step + 1} of {STEPS.length}</div>
        <h2 id="tour-title" className="text-xl font-semibold mb-2">{s.title}</h2>
        <p className="text-sm text-slate-2 leading-relaxed">{s.body}</p>
        <div className="text-[11px] font-mono text-slate-3 mt-3">{s.hint}</div>
        <div className="flex items-center gap-2 mt-5">
          <div className="flex gap-1.5 mr-auto" aria-hidden>{STEPS.map((_, i) => <span key={i} className={`w-1.5 h-1.5 rounded-full ${i === step ? "bg-accent shadow-[0_0_8px_rgba(63,216,198,.8)]" : "bg-white/15"}`} />)}</div>
          <button type="button" className="btn !py-1.5 text-xs" onClick={close}>Skip</button>
          {step < STEPS.length - 1 ? <button type="button" className="btn btn-primary !py-1.5 text-xs" onClick={() => setStep(step + 1)}>Next</button> : <button type="button" className="btn btn-primary !py-1.5 text-xs" onClick={close}>Start planning</button>}
        </div>
      </div>
    </div>
  );
}
