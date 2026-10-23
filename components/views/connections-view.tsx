"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Search, Upload } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { downloadTemplate, importConnections, parseConnectionsWorkbook, type ConnectionsPreview } from "@/lib/ams";
import { connectionLabel, limitText } from "@/lib/tally";

// The dimension table every tally sheet is checked against. The demo ships made-up sample rows; the client's own
// table, all 70 to 80 connections, comes in from their spreadsheet through the template's columns.
export function ConnectionsView() {
  const { state, update } = useApp();
  const connections = useMemo(() => state.connections ?? [], [state.connections]);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ConnectionsPreview & { file: string }>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const columns = useMemo(() => [...new Set(connections.flatMap((spec) => spec.limits.map((limit) => limit.column)))], [connections]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const shown = connections.filter((spec) => words.every((word) => connectionLabel(spec).toLowerCase().includes(word)));
  const canImport = state.role === "Admin" || state.role === "Manager";

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

  return <div className="flex flex-col gap-5">
    <Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Dimension table</div><CardTitle>{connections.length} connection{connections.length === 1 ? "" : "s"}</CardTitle><p className="mt-1 max-w-2xl text-sm text-slate-500">Each row is one size, weight, connection and grade, with the limits a joint must meet. Import your own table from Excel: one row per grade, a column for each limit&apos;s min and max.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={downloadTemplate}><Download data-icon="inline-start" />Template</Button>{canImport && <><Button onClick={() => fileInput.current?.click()}><Upload data-icon="inline-start" />Import from Excel</Button><input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Dimension table spreadsheet" onChange={(event) => void read(event.target.files?.[0])} /></>}</div>
    </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!canImport && <p className="text-xs text-slate-500">Switch to Admin or Manager to import a dimension table.</p>}
        {error && <p className="rounded-lg bg-[#fff3f3] p-3 text-sm text-danger" role="alert">{error}</p>}
        {message && <p className="animate-rise rounded-lg border border-success/25 bg-success/[.06] p-3 text-sm font-semibold text-navy" role="status">{message}</p>}
        {preview && <div className="animate-rise rounded-xl border border-[#b8cedc] bg-[#f6fafc] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><FileSpreadsheet className="size-5 text-accent" /><div><div className="text-sm font-semibold text-navy">{preview.file}</div><div className="text-xs text-slate-500">{preview.specs.length} connection{preview.specs.length === 1 ? "" : "s"} ready · {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} with problems</div></div></div>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setPreview(undefined)}>Cancel</Button><Button onClick={save} disabled={!preview.specs.length}>Import {preview.specs.length}</Button></div></div>
          {preview.errors.length > 0 && <ul className="mt-3 max-h-40 overflow-auto rounded-lg border border-[#f0c2c3] bg-white p-3 text-xs text-danger">{preview.errors.map((item) => <li key={`${item.row}-${item.field}`}>Row {item.row}: {item.message}</li>)}</ul>}
          <p className="mt-3 text-xs text-slate-500">A row with the same size, weight, connection and grade as one already here replaces it. Tally sheets already open keep the limits they started with.</p>
        </div>}
        <div className="relative max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Filter connections" className="pl-9" placeholder='Filter, e.g. "5 S" or "XT 50"' value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-paper"><tr className="text-left align-bottom text-[11px] font-bold text-navy"><th className="px-3 py-2">Size</th><th className="px-3 py-2">Weight</th><th className="px-3 py-2">Connection</th><th className="px-3 py-2">Grade</th>{columns.map((column) => <th key={column} className="px-3 py-2 text-right">{column}</th>)}</tr></thead>
            <tbody>{shown.map((spec) => <tr key={spec.id} className="border-t border-line">
              <td className="px-3 py-2 font-semibold text-navy">{spec.size}&quot;</td><td className="px-3 py-2 tabular-nums">{spec.weight}</td><td className="whitespace-nowrap px-3 py-2">{spec.connection}{spec.sample && <Badge variant="warning" className="ml-2">Sample</Badge>}</td><td className="whitespace-nowrap px-3 py-2">{spec.grade}</td>
              {columns.map((column) => { const limit = spec.limits.find((item) => item.column === column); return <td key={column} className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-600">{limit ? limitText(limit) : ""}</td>; })}
            </tr>)}</tbody>
          </table>
          {!shown.length && <p className="px-4 py-10 text-center text-sm text-slate-500">{connections.length ? "No connection matches that filter." : "No dimension table yet. Import one from Excel."}</p>}
        </div>
        {connections.some((spec) => spec.sample) && <p className="text-xs text-slate-500">Rows marked Sample have made-up limits for this demo, not DS-1 values.</p>}
      </CardContent>
    </Card>
  </div>;
}
