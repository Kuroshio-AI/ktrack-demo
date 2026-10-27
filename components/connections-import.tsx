"use client";

import { useRef, useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Button } from "@/components/ui/button";
import { importConnections, parseConnectionsWorkbook, type ConnectionsPreview } from "@/lib/ams";

// The dimension table import, shared by the Connections page and Demo Controls: open() picks a workbook, input is the
// hidden file field to render beside the button, and panel shows the preview, the rows with problems and the result.
export function useConnectionsImport() {
  const { update } = useApp();
  const [preview, setPreview] = useState<ConnectionsPreview & { file: string }>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);

  async function read(file?: File) {
    setError(""); setMessage(""); setPreview(undefined);
    if (!file) return;
    try { setPreview({ ...parseConnectionsWorkbook(await file.arrayBuffer()), file: file.name }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This file could not be read."); }
    finally { if (fileInput.current) fileInput.current.value = ""; }
  }
  function save() {
    if (!preview?.specs.length) return;
    if (update((current) => importConnections(current, preview.specs))) { setMessage(`${preview.specs.length} connection${preview.specs.length === 1 ? "" : "s"} imported from ${preview.file}.`); setPreview(undefined); }
  }

  const input = <input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Dimension table spreadsheet" onChange={(event) => void read(event.target.files?.[0])} />;
  const panel = <>
    {error && <p className="rounded-lg bg-[#fff3f3] p-3 text-sm text-danger" role="alert">{error}</p>}
    {message && <p className="animate-rise rounded-lg border border-success/25 bg-success/[.06] p-3 text-sm font-semibold text-navy" role="status">{message}</p>}
    {preview && <div className="animate-rise rounded-xl border border-[#b8cedc] bg-[#f6fafc] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><FileSpreadsheet className="size-5 text-accent" /><div><div className="text-sm font-semibold text-navy">{preview.file}</div><div className="text-xs text-slate-500">{preview.specs.length} connection{preview.specs.length === 1 ? "" : "s"} ready{preview.shared > 0 && ` · ${preview.shared} connection dimension row${preview.shared === 1 ? "" : "s"} added`} · {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} with problems</div></div></div>
        <div className="flex gap-2"><Button variant="ghost" onClick={() => setPreview(undefined)}>Cancel</Button><Button onClick={save} disabled={!preview.specs.length}>Import {preview.specs.length}</Button></div></div>
      {preview.errors.length > 0 && <ul className="mt-3 max-h-40 overflow-auto rounded-lg border border-[#f0c2c3] bg-white p-3 text-xs text-danger">{preview.errors.map((item) => <li key={`${item.row}-${item.field}`}>Row {item.row}: {item.message}</li>)}</ul>}
      <p className="mt-3 text-xs text-slate-500">A row with the same size, weight, connection and grade as one already here replaces it. Tally sheets already open keep the limits they started with.</p>
    </div>}
  </>;
  return { open: () => fileInput.current?.click(), input, panel };
}
