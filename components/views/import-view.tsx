"use client";

import Link from "next/link";
import { useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CheckCircle2, Download, FileSpreadsheet, FileText, Import as ImportIcon, RefreshCcw, Upload, XCircle } from "lucide-react";
import { useApp } from "@/components/app-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { parseImportFile, type FilePreview } from "@/lib/import";
import { importRows, importSavings, SAVING_TYPES, savingKg, savingToRaw, toExceptionCsv, validateRegisterRows, validateSavingRows } from "@/lib/domain";
import { rowToRaw, sampleRows, sampleSavings, type SampleId } from "@/lib/sample";
import { IS_SAFEEN } from "@/lib/client";
import type { ImportError, RegisterRow } from "@/lib/types";
import { formatAmount, formatDate } from "@/lib/utils";

function download(name: string, body: BlobPart, type: string) {
  const url = URL.createObjectURL(new Blob([body], { type }));
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

const plural = (count: number, noun: string) => `${count} ${noun}${count === 1 ? "" : "s"}`;

function Stat({ label, value, tone = "normal" }: { label: string; value: number; tone?: "normal" | "danger" | "success" }) {
  return <div className="rounded-lg border border-line bg-white px-4 py-3"><div className="eyebrow">{label}</div><div className={`mt-1 text-2xl font-bold tracking-[-.04em] ${tone === "danger" ? "text-danger" : tone === "success" ? "text-[#187348]" : "text-navy"}`}>{value}</div></div>;
}

function PreviewTable({ title, count, head, children }: { title: string; count: number; head: string[]; children: ReactNode }) {
  return <div className="mt-6"><div className="eyebrow mb-2">{title}</div><div className="overflow-hidden rounded-lg border border-line"><Table><TableHeader><TableRow>{head.map((label) => <TableHead key={label}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{children}</TableBody></Table>{count > 8 && <div className="border-t border-line px-3 py-2 text-xs text-slate-500">Showing the first 8 of {count}.</div>}</div></div>;
}

export function ImportView() {
  const searchParams = useSearchParams();
  const sample = searchParams.get("sample");
  const sampleId: SampleId | undefined = sample === "1" || sample === "2" ? sample : undefined;
  return <ImportContent key={sampleId ?? "empty"} sampleId={sampleId} />;
}

function ImportContent({ sampleId }: { sampleId?: SampleId }) {
  const { state, update, hydrated, storageWarning } = useApp();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  // Previewing a sample runs the same checks as uploading its file: six records and three savings.
  const [preview, setPreview] = useState<FilePreview | undefined>(() => sampleId ? { register: validateRegisterRows(sampleRows(state.demoDate, sampleId).map(rowToRaw), state.records.map((record) => record.assetRef)), savings: validateSavingRows(sampleSavings(state.demoDate, sampleId).map(savingToRaw), state.savings) } : undefined);
  const [fileName, setFileName] = useState(() => sampleId ? `ktrack-sample-${sampleId}-register.csv` : "");
  const [error, setError] = useState("");
  const [lastImport, setLastImport] = useState<{ imported: number; skipped: number; errors: number; issues: ImportError[] }>();
  const [dragging, setDragging] = useState(false);

  async function processFile(file?: File) {
    if (!file) return;
    setFileName(file.name); setError(""); setPreview(undefined);
    try { setPreview(await parseImportFile(file, state.records.map((record) => record.assetRef), state.savings)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "This file could not be read"); }
  }

  const parts = preview ? [preview.register, preview.savings].filter((part) => part !== undefined) : [];
  const errors = parts.flatMap((part) => part.errors);
  const duplicates = parts.flatMap((part) => part.duplicates);
  const allIssues = [...errors, ...duplicates];
  const records = preview?.register?.validRows ?? [];
  const savings = preview?.savings?.validRows ?? [];
  const importLabel = [records.length && plural(records.length, "record"), savings.length && plural(savings.length, "saving")].filter(Boolean).join(" and ") || "0 valid rows";

  function importValid() {
    if (!records.length && !savings.length || state.role === "Manager") return;
    // One save for both, so a failure leaves neither half behind.
    if (!update((current) => importSavings(importRows(current, records), savings))) return;
    setPreview(undefined); setError("");
    // A clean import lands where the rows now show; stay here when there is an exception report to download.
    if (!allIssues.length) { router.push(records.length || IS_SAFEEN ? "/dashboard" : "/sustainability"); return; }
    setLastImport({ imported: records.length + savings.length, skipped: duplicates.length, errors: errors.length, issues: allIssues });
  }
  return <div className="flex flex-col gap-6">
    {lastImport && <div role="status" className="rounded-lg border border-[#bde1ca] bg-[#effaf3] p-4 text-sm text-navy">Import saved: {lastImport.imported} imported · {lastImport.skipped} duplicates skipped · {lastImport.errors} errors.{lastImport.issues.length > 0 && <Button variant="outline" size="sm" className="ml-3" onClick={() => download("ktrack-import-exceptions.csv", toExceptionCsv(lastImport.issues), "text/csv;charset=utf-8")}>Download exception report</Button>}</div>}
    {storageWarning && <div className="rounded-lg border border-[#e7be6a] bg-[#fff8e8] px-4 py-3 text-sm text-[#6f4b00]" role="alert"><strong>Recovery needed.</strong> {storageWarning} Existing in-memory state is untouched until you choose an action in Demo Controls.</div>}
    {!hydrated && <div className="rounded-lg border border-line bg-white px-4 py-3 text-sm text-slate-500">Restoring this browser’s local workspace…</div>}
    <p className="text-sm text-slate-500">Templates and sample data are available in <Link href="/demo-controls" className="font-semibold text-accent underline underline-offset-2">Demo Controls</Link>.</p>
    <div className="flex flex-col gap-5">
      <Card className="overflow-hidden"><CardHeader className="border-b border-line bg-[#f6fafc] pb-4"><div className="flex items-start justify-between gap-4"><div><div className="eyebrow text-accent">Excel / CSV intake</div><CardTitle className="mt-1 text-xl">{IS_SAFEEN ? "Upload an equipment register." : "Upload a Register or Savings worksheet."}</CardTitle><CardDescription className="mt-2 max-w-xl">{IS_SAFEEN ? "A Register sheet adds equipment and crew tickets (fixed headers, 500 in total), like the template and samples in Demo Controls." : "A Register sheet adds records (fixed headers, 500 in total); a Savings sheet adds sustainability savings. One file can hold both, like the templates and samples in Demo Controls."} Validation runs in your browser before anything is saved.</CardDescription></div><div className="hidden rounded-lg bg-white p-2 text-accent shadow-sm sm:block"><FileSpreadsheet className="size-7" /></div></div></CardHeader><CardContent className="p-5 sm:p-7"><label htmlFor="register-file" className={`flex min-h-[212px] cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 text-center transition-colors ${dragging ? "border-accent bg-[#edf8fc]" : "border-[#b8cedc] bg-white hover:border-accent hover:bg-[#f8fcfe]"}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); void processFile(event.dataTransfer.files[0]); }}><span className="grid size-12 place-items-center rounded-full bg-[#e8f3f8] text-accent"><Upload className="size-5" /></span><span className="mt-4 font-semibold text-navy">Drop .xlsx or .csv here</span><span className="mt-1 text-xs text-slate-500">or choose a file · max 2MB</span><Input ref={inputRef} id="register-file" type="file" accept=".xlsx,.csv" className="sr-only" onChange={(event) => void processFile(event.target.files?.[0])} /></label>{fileName && <div className="mt-4 flex items-center justify-between rounded-lg border border-line bg-paper px-3 py-2 text-sm"><span className="flex min-w-0 items-center gap-2"><FileText className="size-4 shrink-0 text-accent" /><span className="truncate font-medium">{fileName}</span></span><Button variant="ghost" size="icon" aria-label="Clear selected file" onClick={() => { setFileName(""); setPreview(undefined); setError(""); if (inputRef.current) inputRef.current.value = ""; }}><XCircle /></Button></div>}{error && <div className="mt-4 flex gap-2 rounded-lg border border-[#f0c2c3] bg-[#fff3f3] px-3 py-3 text-sm text-danger" role="alert"><XCircle className="mt-0.5 size-4 shrink-0" />{error}</div>}</CardContent></Card>
    </div>
    {preview && <Card><CardHeader className="flex-row items-center justify-between"><div><div className="eyebrow">Preflight result</div><CardTitle>Review before you commit.</CardTitle><CardDescription>Only valid rows will be added. Nothing already in KTrack is overwritten{IS_SAFEEN ? "." : "; new savings get the next ENV certificate number."}</CardDescription></div><Button variant="ghost" size="sm" onClick={() => setPreview(undefined)}><RefreshCcw data-icon="inline-start" />Clear preview</Button></CardHeader><CardContent>
      <div className="grid gap-3 sm:grid-cols-3"><Stat label="Total rows" value={parts.reduce((sum, part) => sum + part.totalRows, 0)} /><Stat label="Valid" value={records.length + savings.length} tone="success" /><Stat label="Errors + duplicates" value={allIssues.length} tone={allIssues.length ? "danger" : "normal"} /></div>
      {records.length > 0 && <PreviewTable title="Register records" count={records.length} head={["Asset ref", "Type", "Asset", "Site", "Owner", "Status"]}>{records.slice(0, 8).map((row: RegisterRow) => <TableRow key={row.assetRef}><TableCell className="font-semibold text-navy">{row.assetRef}</TableCell><TableCell><Badge variant="secondary">{row.recordType}</Badge></TableCell><TableCell>{row.assetType}</TableCell><TableCell>{row.site}</TableCell><TableCell>{row.owner}</TableCell><TableCell><Badge variant={row.status === "Active" ? "success" : "outline"}>{row.status}</Badge></TableCell></TableRow>)}</PreviewTable>}
      {savings.length > 0 && <PreviewTable title="Sustainability savings" count={savings.length} head={["Date", "Saving", "Quantity", "kg CO₂e"]}>{savings.slice(0, 8).map((row, index) => <TableRow key={index}><TableCell className="whitespace-nowrap">{formatDate(row.date)}</TableCell><TableCell><div className="font-semibold text-navy">{SAVING_TYPES[row.type].label}</div>{row.description && <div className="text-xs text-slate-500">{row.description}</div>}</TableCell><TableCell className="whitespace-nowrap tabular-nums">{formatAmount(row.quantity)} {row.unit}</TableCell><TableCell className="font-semibold tabular-nums text-success">{formatAmount(savingKg(row))}</TableCell></TableRow>)}</PreviewTable>}
      {allIssues.length > 0 && <div className="mt-6 overflow-hidden rounded-lg border border-[#f0c2c3]"><div className="flex items-center justify-between bg-[#fff6f6] px-4 py-3"><div className="flex items-center gap-2 text-sm font-semibold text-danger"><XCircle className="size-4" />Rows needing attention</div><Button variant="outline" size="sm" onClick={() => download("ktrack-import-exceptions.csv", toExceptionCsv(allIssues), "text/csv;charset=utf-8")}><Download data-icon="inline-start" />Exception CSV</Button></div><Table><TableHeader><TableRow><TableHead>Row</TableHead><TableHead>Field</TableHead><TableHead>Reason</TableHead></TableRow></TableHeader><TableBody>{allIssues.slice(0, 10).map((issue, index) => <TableRow key={`${issue.row}-${index}`}><TableCell>{issue.row}</TableCell><TableCell>{issue.field ?? "—"}</TableCell><TableCell className="text-danger">{issue.message}</TableCell></TableRow>)}</TableBody></Table></div>}
    </CardContent><CardFooter className="justify-between gap-3 border-t border-line pt-5"><p className="flex items-center gap-2 text-xs text-slate-500"><CheckCircle2 className="size-4 text-[#187348]" />All changes stay in this browser.</p><Button onClick={importValid} disabled={!records.length && !savings.length || state.role === "Manager"}><ImportIcon data-icon="inline-start" />Import {importLabel}</Button></CardFooter></Card>}
    {state.records.length > 0 && !preview && <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#b8cedc] bg-[#eef7fb] px-4 py-3 text-sm text-navy"><span><strong>{state.records.length}</strong> record{state.records.length === 1 ? "" : "s"} currently in this browser.</span><Button asChild variant="outline" size="sm"><a href="/register">Open register</a></Button></div>}
  </div>;
}
