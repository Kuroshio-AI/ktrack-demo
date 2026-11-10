// No "use client": it renders only inside client views, and has no state, so it prints the same as it shows.
import { checkLot, limitText, type LotRow } from "@/lib/gex-check";
import type { GexLot } from "@/lib/types";

const BAD = "bg-[#fde8e8] text-danger";
const cell = (row: LotRow) => row.value === undefined ? "–" : String(row.value);

// GEX: a lot's results against its own copy of the limits. Composition reads across like a mill sheet; the rest reads down.
export function LotResults({ lot }: { lot: GexLot }) {
  const result = checkLot(lot);
  const composition = result.rows.filter((row) => row.group === "Composition");
  const tables = (["Mechanical", "Electrical", "Finish"] as const).map((group) => [group, result.rows.filter((row) => row.group === group)] as const).filter(([, rows]) => rows.length);
  return <div className="flex flex-col gap-4 text-sm">
    {result.checks.length > 0 && <div><div className="eyebrow">Finish checks</div><ul className="mt-1.5 flex flex-wrap gap-2">{result.checks.map((check) => <li key={check.key} className={`rounded-full border px-2.5 py-0.5 text-xs font-semibold ${check.value === false ? `border-[#f0c2c3] ${BAD}` : check.value ? "border-success/30 bg-success/[.06] text-success" : "border-line text-slate-500"}`}>{check.label}: {check.value === undefined ? "not answered" : check.value ? "OK" : "Not OK"}</li>)}</ul></div>}
    {composition.length > 0 && <div className="break-inside-avoid"><div className="eyebrow">Composition (%)</div><div className="mt-1.5 overflow-x-auto"><table className="w-full border-collapse text-center text-xs">
      <thead><tr className="bg-paper"><th className="border border-line px-2 py-1 text-left font-bold">Element</th>{composition.map((row) => <th key={row.key} className="border border-line px-2 py-1 font-bold text-navy">{row.label}</th>)}</tr></thead>
      <tbody>{([["Min", (row: LotRow) => row.min === undefined ? "–" : limitText({ min: row.min }).replace("≥ ", "")], ["Max", (row: LotRow) => row.max === undefined ? "–" : limitText({ max: row.max }).replace("≤ ", "")], ["Result", cell]] as const).map(([label, text]) => <tr key={label}><th className="border border-line px-2 py-1 text-left font-semibold text-slate-600">{label}</th>{composition.map((row) => <td key={row.key} className={`tally-mono border border-line px-2 py-1 ${label === "Result" ? `font-semibold ${row.ok === false ? BAD : "text-navy"}` : "text-slate-600"}`}>{text(row)}</td>)}</tr>)}</tbody>
    </table></div></div>}
    {tables.map(([group, rows]) => <div key={group} className="break-inside-avoid"><div className="eyebrow">{group}</div><div className="mt-1.5 overflow-x-auto"><table className="w-full border-collapse text-xs">
      <thead><tr className="bg-paper text-left">{["Test", "Unit", "Limit", "Result", ""].map((label, index) => <th key={index} className={`border border-line px-2 py-1 font-bold ${index >= 2 ? "text-right" : ""}`}>{label}</th>)}</tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}><td className="border border-line px-2 py-1 font-semibold text-navy">{row.label}</td><td className="border border-line px-2 py-1 text-slate-600">{row.unit}</td><td className="tally-mono border border-line px-2 py-1 text-right text-slate-600">{limitText(row)}</td><td className={`tally-mono border border-line px-2 py-1 text-right font-semibold ${row.ok === false ? BAD : "text-navy"}`}>{cell(row)}</td><td className={`w-16 border border-line px-2 py-1 text-center font-bold ${row.ok === false ? BAD : row.ok ? "text-success" : "text-slate-400"}`}>{row.ok === undefined ? "–" : row.ok ? "✓" : row.value! < (row.min ?? -Infinity) ? "Low" : "High"}</td></tr>)}</tbody>
    </table></div></div>)}
  </div>;
}
