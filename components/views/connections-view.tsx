"use client";

import { useMemo, useState } from "react";
import { Download, Search, Upload } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { useConnectionsImport } from "@/components/connections-import";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { downloadTemplate } from "@/lib/ams";
import { class2Text, connectionLabel, limitText, TALLY_COLUMNS } from "@/lib/tally";

// The dimension tables every tally sheet is checked against: DS-1 for proprietary connections, API RP 7G-2 for API ones. The
// demo ships made-up sample rows; the client's own tables come in from their spreadsheets through the template's columns.
export function ConnectionsView() {
  const { state } = useApp();
  const connections = useMemo(() => state.connections ?? [], [state.connections]);
  const [query, setQuery] = useState("");
  const importer = useConnectionsImport();
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

  return <div className="flex flex-col gap-5">
    <Card><CardHeader className="flex-row flex-wrap items-start justify-between gap-3"><div><div className="eyebrow">Dimension table</div><CardTitle>{connections.length} connection{connections.length === 1 ? "" : "s"}</CardTitle><p className="mt-1 max-w-2xl text-sm text-slate-500">Each row is one size, weight, connection and grade, with the Premium limits a pipe must meet and, where your table has them, the Class 2 limits. Import from Excel: one row per grade, a column for each limit&apos;s min and max, in inches or millimetres. Limits that depend only on the connection, like RP 7G-2 Table C.7, go on a second sheet.</p></div>
      <div className="flex flex-wrap gap-2"><Button variant="outline" onClick={downloadTemplate}><Download data-icon="inline-start" />Template</Button>{canImport && <><Button onClick={importer.open}><Upload data-icon="inline-start" />Import from Excel</Button>{importer.input}</>}</div>
    </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!canImport && <p className="text-xs text-slate-500">Switch to Admin or Manager to import a dimension table.</p>}
        {importer.panel}
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
