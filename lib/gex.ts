import { addMonthsClamped, approveInspection, createInitialState, dateDiffDays, deleteInspection, effectiveCertificateStatus, makeId, nowIso, recalculateAlerts, rowToRecord, submitInspection, todayString, updateInspection } from "./domain";
import { alloyLabel, checkLot, GEX_READINGS, type LotRow } from "./gex-check";
import type { WorkItem } from "./ams";
import { formatDate } from "./utils";
import type { Activity, AlloySpec, AppState, GexCheck, GexFinish, GexLot, Inspection, Limit, Role } from "./types";

// Illustrative limits invented for the demo, to be replaced with real ones in Alloy limits. Readings are keyed as in GEX_READINGS.
const range = (min: number, max: number) => ({ min, max });
const FINISH_LIMITS: Limit[] = [{ column: "coat", ...range(60, 120) }, { column: "gloss", ...range(25, 95) }, { column: "anodic", min: 15 }];
const sampleAlloy = (alloy: string, temper: string, values: Record<string, { min?: number; max?: number }>): AlloySpec =>
  ({ id: `${alloy}-${temper}`, alloy, temper, limits: [...Object.entries(values).map(([column, limit]) => ({ column, ...limit })), ...FINISH_LIMITS], sample: true });
const CHEMISTRY_6063 = { si: range(0.25, 0.55), fe: { max: 0.3 }, cu: { max: 0.08 }, mn: { max: 0.08 }, mg: range(0.5, 0.85), cr: { max: 0.08 }, zn: { max: 0.12 }, ti: { max: 0.08 } };

export const SAMPLE_ALLOYS: AlloySpec[] = [
  sampleAlloy("6063", "T5", { ...CHEMISTRY_6063, tensile: { min: 155 }, proof: { min: 115 }, elongation: { min: 7 }, hardness: { min: 55 } }),
  sampleAlloy("6063", "T6", { ...CHEMISTRY_6063, tensile: { min: 205 }, proof: { min: 165 }, elongation: { min: 8 }, hardness: { min: 68 } }),
  sampleAlloy("6061", "T6", { si: range(0.42, 0.78), fe: { max: 0.65 }, cu: range(0.17, 0.38), mn: { max: 0.14 }, mg: range(0.82, 1.15), cr: range(0.06, 0.33), zn: { max: 0.22 }, ti: { max: 0.14 }, tensile: { min: 250 }, proof: { min: 215 }, elongation: { min: 7 }, hardness: { min: 80 } }),
  sampleAlloy("6005A", "T6", { si: range(0.52, 0.88), fe: { max: 0.33 }, cu: { max: 0.28 }, mn: { max: 0.45 }, mg: range(0.42, 0.68), cr: { max: 0.28 }, zn: { max: 0.18 }, ti: { max: 0.09 }, tensile: { min: 235 }, proof: { min: 195 }, elongation: { min: 7 }, hardness: { min: 75 } }),
  sampleAlloy("6101", "T6", { si: range(0.32, 0.68), fe: { max: 0.48 }, cu: { max: 0.09 }, mn: { max: 0.03 }, mg: range(0.37, 0.78), cr: { max: 0.03 }, zn: { max: 0.09 }, tensile: { min: 195 }, proof: { min: 165 }, elongation: { min: 8 }, hardness: { min: 65 }, conductivity: { min: 29.5 } }),
];

export type LotInput = { lotNo: string; customer: string; orderNo: string; customerPo: string; deliveryNote: string; profile: string; alloyId: string; finish: GexFinish; colour?: string; lengthMm: number; quantity: number; castNo: string; inspector: string };

const activityEntry = (event: string, detail: string, actor: Role, timestamp: string): Activity => ({ id: makeId("activity"), event, detail, actor, timestamp });
const isOpen = (inspection: Inspection) => inspection.status === "Draft" || inspection.status === "Submitted" || inspection.status === "Returned";

// The highest number this year plus one, so a gap left by a deleted draft is never refilled; deleting the newest draft frees its number.
export function nextLotNo(state: AppState): string {
  const yy = state.demoDate.slice(2, 4);
  const pattern = new RegExp(`^LOT-${yy}-(\\d+)$`, "i");
  const last = Math.max(0, ...state.records.map((record) => Number(pattern.exec(record.assetRef.trim())?.[1] ?? 0)));
  return `LOT-${yy}-${String(last + 1).padStart(4, "0")}`;
}

export const lotTitle = (lot: GexLot) => `${lot.profile} · ${alloyLabel(lot.spec)} · ${lot.finish}`;

// Recording a lot creates its record (one per lot, so its certificates supersede each other) and a draft with nothing measured.
export function createLot(state: AppState, input: LotInput, actor = state.role, timestamp = nowIso()): { state: AppState; inspection: Inspection } {
  const [lotNo, customer, orderNo, customerPo, deliveryNote, profile, castNo] = [input.lotNo, input.customer, input.orderNo, input.customerPo, input.deliveryNote, input.profile, input.castNo].map((value) => value.trim());
  if (!lotNo || !customer || !orderNo || !customerPo || !deliveryNote || !profile || !castNo) throw new Error("Lot no., customer, sales order, customer PO, delivery note, profile and cast are required.");
  if (state.records.some((record) => record.assetRef.trim().toLowerCase() === lotNo.toLowerCase())) throw new Error(`${lotNo} already exists. Use a new lot number.`);
  const alloy = state.alloys?.find((item) => item.id === input.alloyId);
  if (!alloy) throw new Error("Choose an alloy-temper from the limits table.");
  if (!Number.isFinite(input.lengthMm) || input.lengthMm <= 0) throw new Error("Length must be a positive number of millimetres.");
  if (!Number.isSafeInteger(input.quantity) || input.quantity <= 0) throw new Error("Quantity must be a whole number of pieces.");
  const colour = input.finish === "Mill" ? "" : input.colour?.trim();
  const lot: GexLot = { customer, orderNo, customerPo, deliveryNote, profile, finish: input.finish, ...(colour && { colour }), lengthMm: input.lengthMm, quantity: input.quantity, castNo, spec: structuredClone(alloy), readings: {}, checks: {} };
  const inspector = input.inspector.trim() || actor;
  const record = { ...rowToRecord({ assetRef: lotNo, recordType: "equipment", assetType: lotTitle(lot), site: deliveryNote, owner: customer, assignedEngineer: inspector, status: "Active" }, actor, timestamp), activity: [activityEntry("Lot recorded", `${input.quantity} pcs · ${alloyLabel(alloy)}`, actor, timestamp)] };
  const inspection: Inspection = { id: makeId("inspection"), assetId: record.id, inspector, title: "Production lot", checklist: [], lot, notes: "", status: "Draft", createdAt: timestamp, updatedAt: timestamp };
  return { state: { ...state, records: [...state.records, record], inspections: [inspection, ...state.inspections], activity: [activityEntry("Lot recorded", `${lotNo} · ${customer}`, actor, timestamp), ...state.activity] }, inspection };
}

// A corrected certificate: a new draft on the same record, copied from the issued lot and checked against today's limits.
// Approving it supersedes the old certificate through approveInspection.
export function reissueLot(state: AppState, recordId: string, actor = state.role, timestamp = nowIso()): { state: AppState; inspection: Inspection } {
  const lots = state.inspections.filter((item) => item.assetId === recordId && item.lot);
  if (lots.some(isOpen)) throw new Error("This lot already has a certificate in progress.");
  const issued = lots.find((item) => item.status === "Issued");
  const record = state.records.find((item) => item.id === recordId);
  if (!issued?.lot || !record) throw new Error("Only an issued lot can be reissued.");
  const spec = state.alloys?.find((item) => item.id === issued.lot!.spec.id);
  const inspection: Inspection = { id: makeId("inspection"), assetId: recordId, inspector: issued.inspector, title: issued.title, checklist: [], lot: { ...structuredClone(issued.lot), ...(spec && { spec: structuredClone(spec) }) }, notes: "", status: "Draft", createdAt: timestamp, updatedAt: timestamp };
  return {
    state: { ...state, inspections: [inspection, ...state.inspections], records: state.records.map((item) => item.id === recordId ? { ...item, activity: [activityEntry("Reissue started", "New draft from the issued lot", actor, timestamp), ...item.activity], updatedAt: timestamp } : item), activity: [activityEntry("Reissue started", record.assetRef, actor, timestamp), ...state.activity] },
    inspection,
  };
}

// A draft or returned lot switches to the table's current limits; it keeps its own copy if the row was removed.
export function refreshLotSpec(state: AppState, inspectionId: string, timestamp = nowIso()): AppState {
  const inspection = state.inspections.find((item) => item.id === inspectionId);
  const spec = inspection?.lot && state.alloys?.find((item) => item.id === inspection.lot!.spec.id);
  if (!inspection?.lot || !spec || (inspection.status !== "Draft" && inspection.status !== "Returned")) return state;
  return updateInspection(state, inspectionId, { lot: { ...inspection.lot, spec: structuredClone(spec) } }, timestamp);
}

// A reading with neither a min nor a max is not tested for this alloy-temper. Lots keep the limits they were recorded with.
export function updateAlloy(state: AppState, id: string, limits: Limit[], actor = state.role, timestamp = nowIso()): AppState {
  const alloy = state.alloys?.find((item) => item.id === id);
  if (!alloy) throw new Error("That alloy-temper is no longer listed.");
  const finite = (value: number | undefined) => value !== undefined && Number.isFinite(value);
  const kept = limits.map(({ column, min, max }) => ({ column, ...(finite(min) && { min }), ...(finite(max) && { max }) })).filter((limit) => limit.min !== undefined || limit.max !== undefined);
  const wrong = kept.find((limit) => limit.min !== undefined && limit.max !== undefined && limit.min > limit.max);
  if (wrong) throw new Error(`${GEX_READINGS.find((reading) => reading.key === wrong.column)?.label ?? wrong.column}: the minimum is above the maximum.`);
  return { ...state, alloys: state.alloys!.map((item) => item.id === id ? { ...item, limits: kept } : item), activity: [activityEntry("Limits changed", alloyLabel(alloy), actor, timestamp), ...state.activity] };
}

// Deletes a draft lot and, when nothing else uses it, its record, so its lot number is free again.
export function deleteLot(state: AppState, inspectionId: string, actor = state.role, timestamp = nowIso()): AppState {
  const draft = state.inspections.find((item) => item.id === inspectionId);
  if (!draft || draft.status !== "Draft") return state;
  const record = state.records.find((item) => item.id === draft.assetId);
  const keep = !record || record.certificates.length > 0 || state.inspections.some((other) => other.id !== inspectionId && other.assetId === record.id);
  const next = deleteInspection(state, inspectionId);
  return { ...next, records: keep ? next.records : next.records.filter((item) => item.id !== record.id), activity: [activityEntry("Lot deleted", record?.assetRef ?? "Draft", actor, timestamp), ...next.activity] };
}

const inRange = (failed: number) => failed ? `${failed} out of range` : "all results in range";

// The dashboard's queue, in the AMS kinds so its WORK map applies: lots returned for retest, lots waiting for sign-off, lots
// ready to submit, lots still in test, and certificates about to expire.
export function gexWorkQueue(state: AppState): WorkItem[] {
  const ref = (inspection: Inspection) => state.records.find((record) => record.id === inspection.assetId)?.assetRef ?? "Lot";
  const lots = state.inspections.filter((inspection) => inspection.lot).map((inspection) => ({ inspection, lot: inspection.lot!, check: checkLot(inspection.lot!) }));
  const days = (count: number) => `${count} day${count === 1 ? "" : "s"}`;
  const items: WorkItem[] = [];
  for (const { inspection } of lots.filter((item) => item.inspection.status === "Returned")) items.push({ id: inspection.id, kind: "returned", title: `${ref(inspection)} returned for retest`, detail: inspection.reviewerComment || "See the reviewer's note on the lot.", href: `/inspections?lot=${inspection.id}`, badge: "Retest" });
  for (const { inspection, lot, check } of lots.filter((item) => item.inspection.status === "Submitted")) items.push({ id: inspection.id, kind: "approval", title: `${ref(inspection)} waiting for sign-off`, detail: `${lot.customer} · ${inRange(check.failed.length)}`, href: "/approvals", badge: "Review" });
  const drafts = lots.filter((item) => item.inspection.status === "Draft");
  for (const { inspection, lot, check } of drafts.filter((item) => item.check.complete)) items.push({ id: inspection.id, kind: "submit", title: `${ref(inspection)} ready to submit`, detail: `${lot.customer} · ${inRange(check.failed.length)}`, href: `/inspections?lot=${inspection.id}`, badge: "Submit" });
  for (const { inspection, lot, check } of drafts.filter((item) => !item.check.complete)) {
    const total = check.rows.length + check.checks.length;
    items.push({ id: inspection.id, kind: "measure", title: `${ref(inspection)}: ${check.pending} of ${total} results to enter`, detail: `${lotTitle(lot)} · ${inspection.inspector}`, href: `/inspections?lot=${inspection.id}`, badge: `${Math.floor(((total - check.pending) / total) * 100)}%`, progress: (total - check.pending) / total });
  }
  for (const record of state.records) for (const certificate of record.certificates) {
    const left = dateDiffDays(certificate.expiryDate, state.demoDate);
    if ((certificate.status !== "Valid" && certificate.status !== "Expired") || left > 30) continue;
    items.push({ id: certificate.id, kind: "report", title: `${certificate.number} ${effectiveCertificateStatus(certificate, state.demoDate) === "Expired" ? "has expired" : "expires soon"}`, detail: `${record.assetRef} · valid to ${formatDate(certificate.expiryDate)}`, href: "/certificates", badge: left < 0 ? `${days(-left)} over` : left === 0 ? "Today" : `in ${days(left)}` });
  }
  return items;
}

// One row per customer: lots are records, so a reissued lot counts once.
export type CustomerTotals = { customer: string; lots: number; issued: number; pending: number; outOfRange: number };
export function customerTotals(state: AppState): CustomerTotals[] {
  const totals = new Map<string, CustomerTotals>();
  const lotIds = new Set(state.inspections.filter((inspection) => inspection.lot).map((inspection) => inspection.assetId));
  const row = (customer: string) => totals.get(customer) ?? totals.set(customer, { customer, lots: 0, issued: 0, pending: 0, outOfRange: 0 }).get(customer)!;
  for (const record of state.records.filter((item) => lotIds.has(item.id))) { const item = row(record.owner); item.lots += 1; item.issued += record.certificates.filter((certificate) => certificate.status === "Valid").length; }
  for (const inspection of state.inspections.filter((item) => item.lot && isOpen(item))) { const item = row(inspection.lot!.customer); item.pending += 1; if (checkLot(inspection.lot!).failed.length) item.outOfRange += 1; }
  return [...totals.values()].sort((a, b) => a.customer.localeCompare(b.customer));
}

// The few results a scan shows without a server lookup. Kept to 7 short pairs so the QR stays scannable. Typed fields are
// clipped to what isTokenSummary accepts, so a long customer name never costs the certificate its QR.
const clip = (text: string) => text.replace(/[<>\u0000-\u001f\u007f]/g, "").trim().slice(0, 48).trim();
export function gexSummary(lot: GexLot): [string, string][] {
  const reading = (key: string, unit: string) => lot.readings[key] === undefined ? undefined : `${lot.readings[key]} ${unit}`;
  const finish = reading("conductivity", "MS/m") ? ["Conductivity", reading("conductivity", "MS/m")] : reading("coat", "µm") ? ["Coating", reading("coat", "µm")] : ["Anodic film", reading("anodic", "µm")];
  const pairs = [["Customer", clip(lot.customer)], ["PO", clip(lot.customerPo)], ["Cast", clip(lot.castNo)], ["Tensile", reading("tensile", "MPa")], ["Proof", reading("proof", "MPa")], ["Elong.", reading("elongation", "%")], finish];
  return pairs.filter((pair): pair is [string, string] => Boolean(pair[1]));
}

// Repeatable results inside the limits, spread by a hash of the seed and reading. MPa and HB read to whole numbers.
function sampleReadings(lot: GexLot, seed: string): Record<string, number> {
  const fraction = (text: string) => { let hash = 0; for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) >>> 0; return (hash % 1000) / 1000; };
  const value = (row: LotRow) => {
    const f = fraction(seed + row.key);
    const raw = row.min !== undefined && row.max !== undefined ? row.min + (row.max - row.min) * (0.35 + 0.3 * f) : row.min !== undefined ? row.min * (1.05 + 0.08 * f) : row.max! * (0.35 + 0.4 * f);
    const places = row.unit === "MPa" || row.unit === "HB" ? 1 : 100;
    return Math.round(raw * places) / places;
  };
  return Object.fromEntries(checkLot(lot).rows.map((row) => [row.key, value(row)]));
}

// The shared demo link opens on this: three valid certificates and one superseded by a reissue, a conforming lot and a
// non-conforming one waiting for sign-off, and a draft still in test. Customers, profiles and numbers are invented.
// Raised whenever the sample lots change, so a browser holding an older copy opens on the current one (lib/storage.ts).
export const GEX_SEED = 2;

export function gexInitialState(demoDate = todayString(), timestamp = nowIso()): AppState {
  let state: AppState = { ...createInitialState(demoDate), alloys: SAMPLE_ALLOYS };
  const yy = demoDate.slice(2, 4);
  const expiry = addMonthsClamped(demoDate, 120);
  const lotOf = (id: string) => state.inspections.find((item) => item.id === id)!.lot!;
  const fill = (id: string, readings: Record<string, number | undefined>, checks: Partial<Record<GexCheck, boolean | undefined>> = {}) => {
    const lot = lotOf(id);
    const all = { ...sampleReadings(lot, lot.castNo), ...readings };
    const answered = { ...Object.fromEntries(checkLot(lot).checks.map((check) => [check.key, true])), ...checks };
    const strip = <T,>(map: Record<string, T | undefined>) => Object.fromEntries(Object.entries(map).filter(([, item]) => item !== undefined)) as Record<string, T>;
    state = updateInspection(state, id, { lot: { ...lot, readings: strip(all), checks: strip(answered) } }, timestamp);
  };
  const submit = (id: string) => { state = submitInspection({ ...state, role: "Engineer" }, id, timestamp); };
  const approve = (id: string) => { state = approveInspection(state, id, expiry, "Reviewer", timestamp); };
  const open = (no: string, input: Omit<LotInput, "lotNo" | "orderNo" | "deliveryNote" | "castNo">, cast: string) => {
    const result = createLot(state, { ...input, lotNo: `LOT-${yy}-${no}`, orderNo: `SO-${yy}-${Number(no) + 3200}`, deliveryNote: `DN-${yy}-0${Number(no) + 5400}`, castNo: `C-${yy}-${cast}` }, "Admin", timestamp);
    state = result.state;
    return result.inspection;
  };

  const first = open("0101", { customer: "Dune Ridge Facades", customerPo: "DRF-PO-0742", profile: "SEC-3150", alloyId: "6063-T6", finish: "Powder coated", colour: "Satin white", lengthMm: 6500, quantity: 420, inspector: "Priya Nair" }, "0418");
  fill(first.id, {}); submit(first.id); approve(first.id);
  const reissue = reissueLot(state, first.assetId, "Admin", timestamp);
  state = reissue.state;
  state = updateInspection(state, reissue.inspection.id, { lot: { ...lotOf(reissue.inspection.id), quantity: 418 } }, timestamp);
  submit(reissue.inspection.id); approve(reissue.inspection.id);

  const second = open("0102", { customer: "Saltmarsh Glazing Contracting", customerPo: "SGC-PO-1186", profile: "SEC-2208", alloyId: "6063-T5", finish: "Mill", lengthMm: 5800, quantity: 1200, inspector: "Hassan Qureshi" }, "0421");
  fill(second.id, {}); submit(second.id); approve(second.id);
  const third = open("0103", { customer: "Falcon Gate Electrical Contracting", customerPo: "FGE-PO-0219", profile: "SEC-1104", alloyId: "6101-T6", finish: "Mill", lengthMm: 4000, quantity: 300, inspector: "Priya Nair" }, "0430");
  fill(third.id, {}); submit(third.id); approve(third.id);
  const fourth = open("0104", { customer: "Sunpath Solar Mounting", customerPo: "SSM-PO-0563", profile: "SEC-4420", alloyId: "6005A-T6", finish: "Anodised", colour: "Clear", lengthMm: 6000, quantity: 900, inspector: "Hassan Qureshi" }, "0433");
  fill(fourth.id, {}); submit(fourth.id);
  const fifth = open("0105", { customer: "Dune Ridge Facades", customerPo: "DRF-PO-0758", profile: "SEC-3152", alloyId: "6063-T6", finish: "Powder coated", colour: "Bronze", lengthMm: 6500, quantity: 260, inspector: "Priya Nair" }, "0435");
  fill(fifth.id, { elongation: 6.4, coat: 131 }); submit(fifth.id);
  // A draft in test: composition entered, mechanical and film still to measure, and the sealing check unanswered.
  const sixth = open("0106", { customer: "Oasis Window Works", customerPo: "OWW-PO-0331", profile: "SEC-2730", alloyId: "6061-T6", finish: "Anodised", colour: "Champagne", lengthMm: 5000, quantity: 640, inspector: "Hassan Qureshi" }, "0440");
  fill(sixth.id, { tensile: undefined, proof: undefined, elongation: undefined, hardness: undefined, anodic: undefined }, { seal: undefined });
  return recalculateAlerts({ ...state, role: "Admin", gexSeed: GEX_SEED }, timestamp);
}
