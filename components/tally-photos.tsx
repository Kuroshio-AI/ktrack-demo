"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { Camera, CloudOff, ImagePlus, Trash2, X } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { IS_TRIAL } from "@/lib/client";
import { makeId, nowIso } from "@/lib/domain";
import { deletePhoto, loadPhoto, savePhoto } from "@/lib/photo-store";
import { shrinkPhoto } from "@/lib/photos";
import type { Inspection, TallyPhoto } from "@/lib/types";

// Photos taken while inspecting, each of one pipe or the whole sheet, printed on the F.581's photo page. Adding works
// offline: the image is kept on this laptop at once and, on the trial, goes up when the connection is there.

const pipeLabel = (photo: TallyPhoto) => photo.pipe ? `Pipe ${photo.pipe}` : "Whole sheet";
export const photoTitle = (photo: TallyPhoto) => [pipeLabel(photo), photo.caption?.trim()].filter(Boolean).join(" · ");

// The image from this laptop when it has it, otherwise from the trial's server.
export function PhotoImage({ id, alt, className = "" }: { id: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string>();
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let url: string | undefined;
    let live = true;
    void loadPhoto(id).catch(() => undefined).then((image) => {
      if (!live) return;
      if (image) setSrc(url = URL.createObjectURL(image));
      else if (IS_TRIAL) setSrc(`/api/photos/${encodeURIComponent(id)}`);
      else setMissing(true);
    });
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (missing || !src) return <div className={`grid place-items-center bg-[#eef3f7] p-2 text-center text-[10px] font-semibold text-slate-500 ${missing ? "" : "animate-pulse"} ${className}`}>{missing ? (IS_TRIAL ? "Shows when online" : "On the laptop that took it") : ""}</div>;
  return <img src={src} alt={alt} className={className} onError={() => setMissing(true)} />;
}

export function TallyPhotos({ inspection, disabled }: { inspection: Inspection; disabled: boolean }) {
  const { update, outbox, queue } = useApp();
  const photos = inspection.job?.photos ?? [];
  const pipes = inspection.joints ?? [];
  const [preparing, setPreparing] = useState(0);
  const [error, setError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [removing, setRemoving] = useState<string>();
  const [viewing, setViewing] = useState<TallyPhoto>();
  const picker = useRef<HTMLInputElement>(null);
  const viewer = useRef<HTMLDialogElement>(null);
  const waiting = new Set(outbox.flatMap((item) => item.kind === "photo" ? [item.id] : []));

  useEffect(() => { if (viewing) viewer.current?.showModal(); }, [viewing]);
  // A second press within 3 seconds removes; otherwise the button goes back.
  useEffect(() => { if (!removing) return; const timer = setTimeout(() => setRemoving(undefined), 3000); return () => clearTimeout(timer); }, [removing]);

  const change = (next: (current: TallyPhoto[]) => TallyPhoto[]) => update((state) => ({ ...state, inspections: state.inspections.map((item) => item.id === inspection.id && item.job ? { ...item, job: { ...item.job, photos: next(item.job.photos ?? []) }, updatedAt: nowIso() } : item) }));

  async function add(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    if (!images.length) { if (files.length) setError("Only photos can be attached: JPEG, PNG or HEIC from a camera."); return; }
    setError(undefined);
    setPreparing(images.length);
    const added: TallyPhoto[] = [];
    for (const file of images) {
      try {
        const image = await (await fetch(await shrinkPhoto(file, { edge: 1600, maxBytes: 450 * 1024 }))).blob();
        const id = makeId("photo");
        await savePhoto(id, image);
        added.push({ id, bytes: image.size, takenAt: nowIso() });
      } catch { setError(`${file.name} couldn't be read as a photo.`); }
      setPreparing((count) => count - 1);
    }
    if (added.length && change((current) => [...current, ...added]) && IS_TRIAL) for (const photo of added) queue({ kind: "photo", id: photo.id, inspectionId: inspection.id });
  }

  function remove(photo: TallyPhoto) {
    if (removing !== photo.id) { setRemoving(photo.id); return; }
    setRemoving(undefined);
    if (change((current) => current.filter((item) => item.id !== photo.id))) void deletePhoto(photo.id).catch(() => undefined);
  }

  const drop = (event: DragEvent) => { event.preventDefault(); setDragging(false); if (!disabled) void add([...event.dataTransfer.files]); };
  if (disabled && !photos.length) return null;

  return <section aria-labelledby="tally-photos-title" onDragOver={(event) => { if (!disabled) { event.preventDefault(); setDragging(true); } }} onDragLeave={() => setDragging(false)} onDrop={drop}
    className={`rounded-lg border p-4 transition-[border-color,background-color] duration-150 ${dragging ? "border-accent bg-[#eef6fb]" : "border-line bg-white"}`}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div><h3 id="tally-photos-title" className="eyebrow">Photographs</h3><p className="mt-0.5 text-xs text-slate-500">{photos.length ? `${photos.length} photo${photos.length === 1 ? "" : "s"}, printed on the report's photo page` : "Tag each photo to a pipe. They print on the report's photo page."}</p></div>
      {!disabled && <>
        <input ref={picker} type="file" accept="image/*" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => { void add([...(event.currentTarget.files ?? [])]); event.currentTarget.value = ""; }} />
        <Button variant="outline" size="sm" className="press" onClick={() => picker.current?.click()}><Camera className="size-3.5" aria-hidden="true" />Add photos</Button>
      </>}
    </div>

    {!photos.length && !preparing && !disabled && <button type="button" onClick={() => picker.current?.click()} className="press focus-ring mt-3 flex w-full flex-col items-center gap-1.5 rounded-lg border border-dashed border-[#b8cedc] px-4 py-6 text-sm text-slate-600 transition-colors duration-150 hover:border-accent hover:bg-[#f5f9fc]">
      <ImagePlus className="size-5 text-accent" aria-hidden="true" />Drop photos here, or choose them from this laptop
    </button>}

    {(photos.length > 0 || preparing > 0) && <ul className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {photos.map((photo) => <li key={photo.id} className="animate-rise flex flex-col gap-2">
        <button type="button" onClick={() => setViewing(photo)} aria-label={`Open ${photoTitle(photo)}`} className="focus-ring group relative aspect-[4/3] overflow-hidden rounded-md border border-line bg-[#eef3f7]">
          <PhotoImage id={photo.id} alt={photoTitle(photo)} className="size-full object-cover transition-transform duration-200 ease-out motion-safe:group-hover:scale-[1.03]" />
          <span className="absolute left-1.5 top-1.5 rounded bg-navy/90 px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[.06em] text-white">{pipeLabel(photo)}</span>
          {waiting.has(photo.id) && <span className="absolute bottom-1.5 left-1.5 flex items-center gap-1 rounded bg-white/95 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 shadow-sm"><CloudOff className="size-3" aria-hidden="true" />Not uploaded yet</span>}
        </button>
        {disabled ? <p className="text-xs text-slate-600">{photo.caption || <span className="text-slate-400">No caption</span>}</p> : <div className="flex flex-col gap-1.5">
          <div className="flex gap-1.5">
            <label className="sr-only" htmlFor={`pipe-${photo.id}`}>Pipe</label>
            <Select id={`pipe-${photo.id}`} value={photo.pipe ?? ""} onChange={(event) => change((current) => current.map((item) => item.id === photo.id ? { ...item, pipe: Number(event.target.value) || undefined } : item))} className="h-8 min-w-0 flex-1 bg-white text-xs">
              <option value="">Whole sheet</option>{pipes.map((joint) => <option key={joint.no} value={joint.no}>Pipe {joint.no}{joint.serial ? ` · ${joint.serial}` : ""}</option>)}
            </Select>
            <Button type="button" size="sm" variant={removing === photo.id ? "destructive" : "ghost"} className="press h-8 shrink-0 px-2" aria-label={removing === photo.id ? "Press again to remove this photo" : `Remove ${photoTitle(photo)}`} onClick={() => remove(photo)}>
              {removing === photo.id ? "Remove?" : <Trash2 className="size-3.5" aria-hidden="true" />}
            </Button>
          </div>
          <label className="sr-only" htmlFor={`caption-${photo.id}`}>Caption</label>
          <Input id={`caption-${photo.id}`} defaultValue={photo.caption} name="caption" autoComplete="off" placeholder="Caption, e.g. box thread damage…" className="h-8 text-xs" maxLength={140}
            onBlur={(event) => { const caption = event.currentTarget.value.trim(); if (caption !== (photo.caption ?? "")) change((current) => current.map((item) => item.id === photo.id ? { ...item, caption: caption || undefined } : item)); }} />
        </div>}
      </li>)}
      {Array.from({ length: preparing }, (_, index) => <li key={`preparing-${index}`} className="aspect-[4/3] animate-pulse rounded-md bg-[#eef3f7]" aria-label="Preparing a photo" />)}
    </ul>}
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}

    {viewing && <dialog ref={viewer} aria-label={photoTitle(viewing)} onClose={() => setViewing(undefined)} onClick={(event) => { if (event.target === event.currentTarget) event.currentTarget.close(); }}
      className="photo-dialog m-auto max-h-[92vh] w-[min(94vw,1100px)] overflow-hidden rounded-xl bg-[#071d30] p-0 text-white">
      <div className="flex items-center justify-between gap-3 px-4 py-3"><p className="min-w-0 truncate text-sm font-semibold">{photoTitle(viewing)}</p><Button variant="ghost" size="icon" className="press shrink-0 text-white hover:bg-white/10 hover:text-white" aria-label="Close photo" onClick={() => viewer.current?.close()}><X /></Button></div>
      <PhotoImage id={viewing.id} alt={photoTitle(viewing)} className="mx-auto max-h-[80vh] w-full object-contain" />
    </dialog>}
  </section>;
}
