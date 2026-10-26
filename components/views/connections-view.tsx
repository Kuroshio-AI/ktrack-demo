"use client";

import { useMemo, useRef, useState } from "react";
import { Download, FileSpreadsheet, Search, Upload } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { downloadTemplate, importConnections, parseConnectionsWorkbook, type ConnectionsPreview } from "@/lib/ams";
import { class2Text, connectionLabel, limitText, TALLY_COLUMNS } from "@/lib/tally";

// The dimension tables every tally sheet is checked against: DS-1 for proprietary connections, API RP 7G-2 for API ones. The
// demo ships made-up sample rows; the client's own tables come in from their spreadsheets through the template's columns.
export function ConnectionsView() {
  const { state, update } = useApp();
  const connections = useMemo(() => state.connections ?? [], [state.connections]);
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ConnectionsPreview & { file: string }>();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // One column per F.582 dimension in tally sheet order, named as the first table names it (DS-1's "Box OD", RP 7G-2's "Tool
  // joint OD"), then the limits no tally column checks.
  const columns = useMemo(() => {
    const names = new Set(connections.flatMap((spec) => spec.limits.map((limit) => limit.column)));
    const taken = new Set<string>();
    const merged = TALLY_COLUMNS.flatMap((column) => {
      const used = (column.limit ?? []).filter((name) => names.has(name) && !taken.has(name));
      used.forEach((name) => taken.add(name));
      return used.length ? [used] : [];
    });
    return [...merged, ...[...names].filter((name) => !taken.has(name)).map((name) => [name])];
  }, [connections]);
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const standards = connections.some((spec) => spec.standard);
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
    <Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Dimension table</div><CardTitle>{connections.length} connection{connections.length === 1 ? "" : "s"}</CardTitle><p className="mt-1 max-w-2xl text-sm text-slate-500">Each row is one size, weight, connection and grade, with the Premium limits a pipe must meet and, where your table has them, the Class 2 limits. Import from Excel: one row per grade, a column for each limit&apos;s min and max, in inches or millimetres. Limits that depend only on the connection, like RP 7G-2 Table C.7, go on a second sheet.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={downloadTemplate}><Download data-icon="inline-start" />Template</Button>{canImport && <><Button onClick={() => fileInput.current?.click()}><Upload data-icon="inline-start" />Import from Excel</Button><input ref={fileInput} type="file" accept=".xlsx,.xls,.csv" className="hidden" aria-label="Dimension table spreadsheet" onChange={(event) => void read(event.target.files?.[0])} /></>}</div>
    </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!canImport && <p className="text-xs text-slate-500">Switch to Admin or Manager to import a dimension table.</p>}
        {error && <p className="rounded-lg bg-[#fff3f3] p-3 text-sm text-danger" role="alert">{error}</p>}
        {message && <p className="animate-rise rounded-lg border border-success/25 bg-success/[.06] p-3 text-sm font-semibold text-navy" role="status">{message}</p>}
        {preview && <div className="animate-rise rounded-xl border border-[#b8cedc] bg-[#f6fafc] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><FileSpreadsheet className="size-5 text-accent" /><div><div className="text-sm font-semibold text-navy">{preview.file}</div><div className="text-xs text-slate-500">{preview.specs.length} connection{preview.specs.length === 1 ? "" : "s"} ready{preview.shared > 0 && ` · ${preview.shared} connection dimension row${preview.shared === 1 ? "" : "s"} added`} · {preview.errors.length} row{preview.errors.length === 1 ? "" : "s"} with problems</div></div></div>
            <div className="flex gap-2"><Button variant="ghost" onClick={() => setPreview(undefined)}>Cancel</Button><Button onClick={save} disabled={!preview.specs.length}>Import {preview.specs.length}</Button></div></div>
          {preview.errors.length > 0 && <ul className="mt-3 max-h-40 overflow-auto rounded-lg border border-[#f0c2c3] bg-white p-3 text-xs text-danger">{preview.errors.map((item) => <li key={`${item.row}-${item.field}`}>Row {item.row}: {item.message}</li>)}</ul>}
          <p className="mt-3 text-xs text-slate-500">A row with the same size, weight, connection and grade as one already here replaces it. Tally sheets already open keep the limits they started with.</p>
        </div>}
        <div className="relative max-w-sm"><Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" /><Input aria-label="Filter connections" className="pl-9" placeholder='Filter, e.g. "5 S" or "XT 50"' value={query} onChange={(event) => setQuery(event.target.value)} /></div>
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-paper"><tr className="text-left align-bottom text-[11px] font-bold text-navy"><th className="px-3 py-2">Size</th><th className="px-3 py-2">Weight</th><th className="px-3 py-2">Connection</th><th className="px-3 py-2">Grade</th>{standards && <th className="px-3 py-2">Standard</th>}{columns.map((column) => <th key={column[0]} title={column.join(" / ")} className="px-3 py-2 text-right">{column[0]}</th>)}</tr></thead>
            <tbody>{shown.map((spec) => <tr key={spec.id} className="border-t border-line">
              <td className="whitespace-nowrap px-3 py-2 font-semibold text-navy">{spec.size}&quot;</td><td className="px-3 py-2 tabular-nums">{spec.weight}</td><td className="whitespace-nowrap px-3 py-2">{spec.connection}{spec.sample && <Badge variant="warning" className="ml-2">Sample</Badge>}</td><td className="whitespace-nowrap px-3 py-2">{spec.grade}</td>{standards && <td className="whitespace-nowrap px-3 py-2 text-slate-600">{spec.standard ?? (spec.sample ? "–" : "DS-1")}</td>}
              {columns.map((column) => { const limit = column.map((name) => spec.limits.find((item) => item.column === name)).find(Boolean); return <td key={column[0]} className="whitespace-nowrap px-3 py-2 text-right font-mono text-xs tabular-nums text-slate-600">{limit ? limitText(limit) : ""}{limit && class2Text(limit) && <span className="block text-[#b45309]">C2 {class2Text(limit)}</span>}</td>; })}
            </tr>)}</tbody>
          </table>
          {!shown.length && <p className="px-4 py-10 text-center text-sm text-slate-500">{connections.length ? "No connection matches that filter." : "No dimension table yet. Import one from Excel."}</p>}
        </div>
        <p className="text-xs text-slate-500">Limits are in inches; C2 is the Class 2 limit. A table in millimetres converts on import, each limit rounded to the strict side.{connections.some((spec) => spec.sample) && " Rows marked Sample have made-up limits for this demo, not DS-1 or API values."}</p>
      </CardContent>
    </Card>
  </div>;
}
