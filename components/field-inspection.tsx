"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Camera, Check, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { SafeenMark } from "@/components/safeen-mark";
import { BRAND, IS_SAFEEN } from "@/lib/client";
import { MAX_PHONE_PHOTOS, type FieldJob, type FieldResult } from "@/lib/field";
import { photoBytes, shrinkPhoto } from "@/lib/photos";

const RESULTS = [{ value: "pass", label: "Pass", selected: "bg-success text-white" }, { value: "fail", label: "Fail", selected: "bg-danger text-white" }, { value: "na", label: "N/A", selected: "bg-slate-500 text-white" }] as const;
type Photo = FieldResult["photos"][number];

// Draw with a finger or mouse; the canvas is 3x its CSS height so strokes stay crisp on phones.
function SignaturePad({ onChange }: { onChange: (dataUrl?: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  // A tap or a stroke the browser swallowed leaves the canvas blank; only real ink counts as signed.
  const inked = useRef(false);
  function point(event: PointerEvent<HTMLCanvasElement>): [number, number] {
    const box = event.currentTarget.getBoundingClientRect();
    return [(event.clientX - box.left) * event.currentTarget.width / box.width, (event.clientY - box.top) * event.currentTarget.height / box.height];
  }
  function start(event: PointerEvent<HTMLCanvasElement>) {
    const context = event.currentTarget.getContext("2d");
    if (!context) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drawing.current = true;
    Object.assign(context, { lineWidth: 5, lineCap: "round", lineJoin: "round", strokeStyle: "#0b3151" });
    context.beginPath();
    context.moveTo(...point(event));
  }
  function draw(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    const context = event.currentTarget.getContext("2d");
    context?.lineTo(...point(event));
    context?.stroke();
    inked.current = true;
  }
  function end(event: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    onChange(inked.current ? event.currentTarget.toDataURL("image/png") : undefined);
  }
  function clear() {
    const element = canvas.current;
    element?.getContext("2d")?.clearRect(0, 0, element.width, element.height);
    inked.current = false;
    onChange(undefined);
  }
  return <div>
    <canvas ref={canvas} width={900} height={300} aria-label="Signature pad: sign with your finger" className="h-[120px] w-full touch-none rounded-lg border border-dashed border-[#b8cedc] bg-white" onPointerDown={start} onPointerMove={draw} onPointerUp={end} onPointerCancel={end} />
    <div className="mt-1 flex justify-between text-xs text-slate-500"><span>Sign above</span><button type="button" className="font-semibold text-navy underline-offset-4 hover:underline" onClick={clear}>Clear</button></div>
  </div>;
}

export function FieldInspection({ id }: { id: string }) {
  const [job, setJob] = useState<FieldJob>();
  const [screen, setScreen] = useState<"loading" | "form" | "sent" | "closed">("loading");
  const [message, setMessage] = useState("");
  const [closedTitle, setClosedTitle] = useState("Link unavailable");
  const [claim, setClaim] = useState<string>();
  const [results, setResults] = useState<Record<string, FieldResult["results"][string]>>({});
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [signature, setSignature] = useState<string>();
  const [sending, setSending] = useState(false);
  const [zoom, setZoom] = useState(1);

  // Chrome's "Desktop site" mode ignores the viewport tag and lays out 980px wide, shrinking this page to a sliver; scale it back to the screen.
  useEffect(() => { if (navigator.maxTouchPoints > 0 && window.innerWidth > window.screen.width * 1.2) setZoom(window.innerWidth / window.screen.width); }, []);

  useEffect(() => {
    void (async () => {
      try {
        // The claim survives a reload (or the camera app evicting the tab), so this phone keeps its lock.
        const claimStore = `keetrack-field-claim:${id}`;
        let saved: string | null = null;
        try { saved = localStorage.getItem(claimStore); } catch { /* private mode: the claim lives in memory only */ }
        const response = await fetch(`/api/field/${id}?phone=1${saved ? `&claim=${encodeURIComponent(saved)}` : ""}`, { cache: "no-store" });
        const body = await response.json() as { job?: FieldJob; status?: string; claim?: string; error?: string };
        if (response.status === 409) { setClosedTitle("Already in progress"); setMessage(body.error ?? "This inspection is already in progress on another phone."); setScreen("closed"); return; }
        if (!response.ok || !body.job) { setMessage(body.error ?? "This link could not be opened."); setScreen("closed"); return; }
        if (body.status === "submitted") { setMessage("This inspection was already submitted."); setScreen("closed"); return; }
        if (body.claim) { setClaim(body.claim); try { localStorage.setItem(claimStore, body.claim); } catch { /* memory only */ } }
        setJob(body.job);
        setScreen("form");
      } catch { setMessage("No connection. Check your signal and reload this page."); setScreen("closed"); }
    })();
  }, [id]);

  async function addPhoto(file?: File) {
    setMessage("");
    if (!file) return;
    if (!file.type.startsWith("image/")) { setMessage("Only photos can be attached."); return; }
    try {
      const dataUrl = await shrinkPhoto(file);
      if (photoBytes(dataUrl) > 200 * 1024) { setMessage("This photo is too detailed to send. Try another one."); return; }
      setPhotos((current) => [...current, { name: file.name || "Photo", dataUrl, bytes: photoBytes(dataUrl) }].slice(0, MAX_PHONE_PHOTOS));
    } catch { setMessage("This photo could not be read. Try another one."); }
  }

  async function submit() {
    setMessage(""); setSending(true);
    try {
      const response = await fetch(`/api/field/${id}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ claim, results, notes, photos, signature }) });
      const body = await response.json() as { error?: string };
      if (!response.ok) { setMessage(body.error ?? "Could not send. Try again."); return; }
      setScreen("sent");
    } catch { setMessage("No connection. Your answers are still here; try again."); }
    finally { setSending(false); }
  }

  const ready = job && job.checklist.every((item) => results[item.id]) && signature;
  return <main className="min-h-screen bg-[#f3f7f9] px-4 py-6" style={zoom === 1 ? undefined : { zoom }}>
    <div className="mx-auto max-w-md">
      <div className="flex items-center gap-3">{IS_SAFEEN ? <span className="grid size-10 place-items-center rounded-xl bg-navy text-white"><SafeenMark /></span> : <img src="/kee-safety-logo.png" alt="Kee Safety" className="size-10" />}<div><div className="text-[11px] font-bold uppercase tracking-[.18em] text-[#1684ab]">KTrack · Field inspection</div>{job && <div className="text-xs text-slate-500">Inspector: {job.inspector}</div>}</div></div>
      {screen === "loading" && <p className="mt-10 text-center text-sm text-slate-500" aria-live="polite">Opening inspection…</p>}
      {screen === "closed" && <div className="animate-rise mt-8 rounded-2xl border border-line bg-white p-6 text-center shadow-panel"><h1 className="text-xl font-bold text-navy">{closedTitle}</h1><p className="mt-2 text-sm text-slate-600" role="alert">{message}</p></div>}
      {screen === "sent" && job && <div className="animate-rise mt-8 rounded-2xl border border-line bg-white p-8 text-center shadow-panel">
        <span className="pop-in mx-auto grid size-20 place-items-center rounded-full bg-success text-white ring-8 ring-success/10"><Check className="draw-check size-10" strokeWidth={3} aria-hidden="true" /></span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-navy">Sent for review</h1>
        <p className="mt-2 text-sm text-slate-600">{job.assetRef} is now in {BRAND.name}’s approval queue. You can close this page.</p>
      </div>}
      {screen === "form" && job && <form className="animate-rise mt-5 flex flex-col gap-4" onSubmit={(event) => { event.preventDefault(); if (ready) void submit(); }}>
        <div className="rounded-2xl border border-line bg-white p-5 shadow-panel">
          <div className="eyebrow">{job.site}</div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-navy">{job.assetRef}</h1>
          <p className="text-sm text-slate-500">{job.assetType}</p>
        </div>
        <fieldset className="flex flex-col gap-3 rounded-2xl border border-line bg-white p-4 shadow-panel">
          <legend className="sr-only">Checklist</legend>
          {job.checklist.map((item) => <div key={item.id} role="radiogroup" aria-label={item.label}>
            <div className="text-sm font-semibold text-navy">{item.label}</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">{RESULTS.map(({ value, label, selected }) => <label key={value} className="cursor-pointer"><input type="radio" className="peer sr-only" name={item.id} value={value} checked={results[item.id] === value} onChange={() => setResults((current) => ({ ...current, [item.id]: value }))} /><span className={`block rounded-lg border py-3 text-center text-sm font-bold transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-accent ${results[item.id] === value ? `${selected} border-transparent` : "border-line text-slate-600 active:bg-paper"}`}>{label}</span></label>)}</div>
          </div>)}
        </fieldset>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-panel">
          <label className="eyebrow" htmlFor="field-notes">Notes</label>
          <Textarea id="field-notes" className="mt-1.5" value={notes} maxLength={2000} onChange={(event) => setNotes(event.target.value)} placeholder="Observations or corrections…" />
          <div className="eyebrow mt-4">Evidence photos · up to {MAX_PHONE_PHOTOS}</div>
          {photos.length > 0 && <div className="mt-2 flex gap-2">{photos.map((photo, index) => <button key={index} type="button" className="relative" onClick={() => setPhotos((current) => current.filter((_, other) => other !== index))} aria-label={`Remove photo ${index + 1}`}><img src={photo.dataUrl} alt="" className="size-20 rounded-lg border border-line object-cover" /><span className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-navy text-[11px] font-bold text-white">×</span></button>)}</div>}
          {photos.length < MAX_PHONE_PHOTOS && <label className="mt-2 flex h-12 cursor-pointer items-center justify-center gap-2 rounded-lg bg-[#e9f1f7] text-sm font-semibold text-navy active:bg-[#dceaf3]"><Camera className="size-4" />Take photo<input type="file" accept="image/*" capture="environment" className="sr-only" onChange={(event) => { void addPhoto(event.target.files?.[0]); event.target.value = ""; }} /></label>}
          <p className="mt-1.5 text-xs text-slate-500">Any photo size works · shrunk automatically</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-4 shadow-panel">
          <div className="eyebrow mb-2">Inspector signature</div>
          <SignaturePad onChange={setSignature} />
        </div>
        {message && <p className="rounded-lg bg-[#fff3f3] p-3 text-sm text-danger" role="alert">{message}</p>}
        <Button type="submit" size="lg" disabled={!ready || sending} className="w-full"><Send data-icon="inline-start" />{sending ? "Sending…" : "Submit for review"}</Button>
        {!ready && <p className="-mt-2 text-center text-xs text-slate-500">Answer every item and sign to submit.</p>}
      </form>}
    </div>
  </main>;
}
