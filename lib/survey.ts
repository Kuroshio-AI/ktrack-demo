import { activity, isDateString, makeId, nextDeadline, nowIso, OUT_OF_SERVICE } from "./domain";
import { syncAnomalies } from "./anomaly";
import { obligationFor } from "./safeen";
import type { AppState, AssetRecord, Role } from "./types";

// The pipeline and riser survey tally: one row per point along the line (KP, km from the start), with the ROV's CP stab,
// the UT wall reading and the nearest anode's depletion, each graded as it is typed. Like the AMS drill pipe tally, KTrack
// suggests the result and the report rolls the rows up; the instruments used must be in calibration before it is issued.

export type SurveyResult = "Accept" | "Monitor" | "Repair";
// length is the free span or exposed stretch in metres, read off the ROV video for an FS or EXP point.
export type SurveyPoint = { id: string; kp: number; cp?: number; wall?: number; anode?: number; code: string; length?: number; note?: string };
export type Survey = {
  id: string; number: string; title: string; line: string; site: string; date: string;
  rovId?: string; equipmentIds: string[];
  nominalWall: number; minWall: number;
  // The client's allowable free span for this line, in metres.
  spanLimit?: number;
  points: SurveyPoint[];
  status: "Draft" | "Issued"; issuedBy?: Role; issuedAt?: string;
  createdAt: string; updatedAt: string;
};

// Sample criteria for the demo, marked as such on screen and in the report; the client's procedure replaces them.
// CP against an Ag/AgCl seawater cell: -800 mV or more negative protects carbon steel; past -1100 mV risks hydrogen damage in
// high-strength steel (DNV-RP-B401). Wall below the minimum allowable needs repair; below 87.5% of nominal (the line pipe
// mill tolerance) it is watched. Anodes are watched past half consumed and replaced from three quarters. A free span longer
// than the line's allowable span needs support; a shorter one is watched.
export const CRITERIA = { protectedMv: -800, overMv: -1100, millTolerance: 0.875, anodeWatch: 50, anodeRetrofit: 75, spanLimit: 15 };

export const POINT_CODES: Record<string, { label: string; result: SurveyResult }> = {
  OK: { label: "No anomaly", result: "Accept" },
  CD: { label: "Coating damage", result: "Monitor" },
  FS: { label: "Free span", result: "Monitor" },
  EXP: { label: "Exposure", result: "Monitor" },
  DEB: { label: "Debris on or near the line", result: "Monitor" },
  DNT: { label: "Dent or gouge", result: "Repair" },
};

// What a finding is about. The anomaly register tracks one anomaly per kind at a place on the line.
export type FindingKind = "Low CP" | "Over-protection" | "Wall loss" | "Anode depletion" | "Free span" | "Exposure" | "Coating damage" | "Dent" | "Debris";
export const KIND_OF_CODE: Record<string, FindingKind> = { CD: "Coating damage", FS: "Free span", EXP: "Exposure", DEB: "Debris", DNT: "Dent" };
// reason is the report's sentence, tag the same finding cut down for the tally grid, measure the figure the register keeps.
export type Finding = { kind: FindingKind; result: SurveyResult; reason: string; tag: string; measure: string };
export type Graded = { result: SurveyResult | "Pending"; reasons: string[]; tags: string[]; findings: Finding[] };
const RANK: SurveyResult[] = ["Accept", "Monitor", "Repair"];
export const worse = (a: SurveyResult, b: SurveyResult) => RANK.indexOf(a) > RANK.indexOf(b);
const worst = (results: SurveyResult[]) => results.reduce<SurveyResult>((top, item) => worse(item, top) ? item : top, "Accept");

// The worst of the checks wins. CP is read at every point, so a point without one is still pending.
export function gradePoint(point: SurveyPoint, survey: Pick<Survey, "nominalWall" | "minWall" | "spanLimit">): Graded {
  if (point.cp === undefined) return { result: "Pending", reasons: [], tags: [], findings: [] };
  const found: Finding[] = [];
  const add = (kind: FindingKind, result: SurveyResult, reason: string, tag: string, measure: string) => found.push({ kind, result, reason, tag, measure });
  if (point.cp > CRITERIA.protectedMv) add("Low CP", "Repair", `Under-protected: ${point.cp} mV, limit ${CRITERIA.protectedMv} mV`, `CP ${point.cp} mV`, `${point.cp} mV`);
  else if (point.cp < CRITERIA.overMv) add("Over-protection", "Monitor", `Over-protected: ${point.cp} mV, past ${CRITERIA.overMv} mV`, `Over-protected ${point.cp} mV`, `${point.cp} mV`);
  if (point.wall !== undefined) {
    const percent = Math.round((point.wall / survey.nominalWall) * 100);
    if (point.wall < survey.minWall) add("Wall loss", "Repair", `Wall ${point.wall} mm, below the ${survey.minWall} mm minimum allowable`, `Wall ${point.wall} mm, under minimum`, `${point.wall} mm (${percent}%)`);
    else if (point.wall < survey.nominalWall * CRITERIA.millTolerance) add("Wall loss", "Monitor", `Wall ${point.wall} mm, ${percent}% of nominal ${survey.nominalWall} mm`, `Wall ${percent}%`, `${point.wall} mm (${percent}%)`);
  }
  if (point.anode !== undefined) {
    if (point.anode >= CRITERIA.anodeRetrofit) add("Anode depletion", "Repair", `Anode ${point.anode}% depleted; plan a replacement`, `Anode ${point.anode}%`, `${point.anode}% depleted`);
    else if (point.anode > CRITERIA.anodeWatch) add("Anode depletion", "Monitor", `Anode ${point.anode}% depleted`, `Anode ${point.anode}%`, `${point.anode}% depleted`);
  }
  const code = POINT_CODES[point.code];
  const kind = KIND_OF_CODE[point.code];
  if (code && kind) {
    const limit = survey.spanLimit ?? CRITERIA.spanLimit;
    if (point.code === "FS" && point.length !== undefined) add("Free span", point.length > limit ? "Repair" : "Monitor", `Free span ${point.length} m, allowable ${limit} m`, `Free span ${point.length} m`, `${point.length} m long`);
    else add(kind, code.result, point.length !== undefined ? `${code.label}, ${point.length} m` : code.label, point.length !== undefined ? `${code.label} ${point.length} m` : code.label, point.length !== undefined ? `${point.length} m` : point.note ?? "Seen on video");
  }
  return { result: worst(found.map((item) => item.result)), reasons: found.map((item) => item.reason), tags: found.map((item) => item.tag), findings: found };
}

export function summarizeSurvey(survey: Survey) {
  const graded = survey.points.map((point) => ({ point, graded: gradePoint(point, survey) }));
  const count = (result: Graded["result"]) => graded.filter((item) => item.graded.result === result).length;
  const cps = survey.points.flatMap((point) => point.cp === undefined ? [] : [point.cp]);
  const walls = survey.points.flatMap((point) => point.wall === undefined ? [] : [point.wall]);
  return {
    graded, accept: count("Accept"), monitor: count("Monitor"), repair: count("Repair"), pending: count("Pending"),
    cpRange: cps.length ? [Math.min(...cps), Math.max(...cps)] as const : undefined,
    minWallRead: walls.length ? Math.min(...walls) : undefined,
    anomalies: graded.filter((item) => item.graded.result === "Monitor" || item.graded.result === "Repair"),
  };
}

// An instrument can't vouch for readings while it is out of calibration or out of service.
export const unfitEquipment = (survey: Pick<Survey, "equipmentIds">, records: AssetRecord[], demoDate: string) =>
  records.filter((record) => survey.equipmentIds.includes(record.id)).flatMap((record) => {
    const deadline = nextDeadline(record, demoDate);
    return deadline && (deadline.event === OUT_OF_SERVICE || deadline.days < 0) ? [{ record, deadline }] : [];
  });

// What stops the report being issued, in the words the reviewer sees; empty means it can go.
export function issueBlockers(survey: Survey, state: Pick<AppState, "records" | "demoDate">): string[] {
  const summary = summarizeSurvey(survey);
  return [
    ...(survey.points.length ? [] : ["Add at least one survey point."]),
    ...(summary.pending ? [`${summary.pending} point${summary.pending === 1 ? " has" : "s have"} no CP reading yet.`] : []),
    ...unfitEquipment(survey, state.records, state.demoDate).map(({ record, deadline }) => deadline.event === OUT_OF_SERVICE ? `${record.assetRef} is out of service.` : `${record.assetRef} ${obligationFor(record).due.toLowerCase().replace(/ due$/, "")} is ${Math.abs(deadline.days)} day${Math.abs(deadline.days) === 1 ? "" : "s"} overdue.`),
  ];
}

export const newPoint = (kp: number): SurveyPoint => ({ id: makeId("kp"), kp, code: "OK" });

// SVR-26-004: the year of the survey date, then the next free number that year.
function nextNumber(surveys: Survey[], date: string) {
  const prefix = `SVR-${date.slice(2, 4)}-`;
  const last = Math.max(0, ...surveys.filter((item) => item.number.startsWith(prefix)).map((item) => Number(item.number.slice(prefix.length)) || 0));
  return `${prefix}${String(last + 1).padStart(3, "0")}`;
}

export function saveSurvey(state: AppState, survey: Omit<Survey, "id" | "number" | "status" | "createdAt" | "updatedAt"> & { id?: string }, actor = state.role, timestamp = nowIso()): AppState {
  const surveys = state.surveys ?? [];
  const existing = survey.id ? surveys.find((item) => item.id === survey.id) : undefined;
  if (existing?.status === "Issued") return state;
  const saved: Survey = existing
    ? { ...existing, ...survey, id: existing.id, updatedAt: timestamp }
    : { ...survey, id: makeId("survey"), number: nextNumber(surveys, survey.date), status: "Draft", createdAt: timestamp, updatedAt: timestamp };
  return {
    ...state,
    surveys: existing ? surveys.map((item) => item.id === saved.id ? saved : item) : [saved, ...surveys],
    activity: existing ? state.activity : [activity("Survey started", `${saved.number} · ${saved.title}`, actor, timestamp), ...state.activity],
  };
}

export function issueSurvey(state: AppState, id: string, actor = state.role, timestamp = nowIso()): AppState {
  const survey = state.surveys?.find((item) => item.id === id);
  if (!survey || survey.status !== "Draft" || (actor !== "Admin" && actor !== "Reviewer") || issueBlockers(survey, state).length) return state;
  const { repair, monitor } = summarizeSurvey(survey);
  const issued: Survey = { ...survey, status: "Issued", issuedBy: actor, issuedAt: timestamp, updatedAt: timestamp };
  // Issuing files every finding in the anomaly register, matched to what earlier campaigns found on the same line.
  return syncAnomalies({
    ...state,
    surveys: state.surveys!.map((item) => item.id === id ? issued : item),
    activity: [activity("Survey report issued", `${survey.number} · ${repair} for repair, ${monitor} to monitor`, actor, timestamp), ...state.activity],
  }, issued, actor, timestamp);
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === "string";

export function isSurvey(value: unknown): value is Survey {
  if (!value || typeof value !== "object") return false;
  const survey = value as Partial<Survey>;
  return [survey.id, survey.number, survey.title, survey.line, survey.site, survey.createdAt, survey.updatedAt].every(isText) && isDateString(survey.date)
    && (survey.rovId === undefined || isText(survey.rovId)) && Array.isArray(survey.equipmentIds) && survey.equipmentIds.every(isText)
    && isNumber(survey.nominalWall) && survey.nominalWall > 0 && isNumber(survey.minWall) && survey.minWall > 0 && (survey.spanLimit === undefined || isNumber(survey.spanLimit))
    && (survey.status === "Draft" || survey.status === "Issued") && (survey.issuedAt === undefined || isText(survey.issuedAt))
    && Array.isArray(survey.points) && survey.points.every((point) => Boolean(point) && isText(point.id) && isNumber(point.kp) && isText(point.code)
      && [point.cp, point.wall, point.anode, point.length].every((reading) => reading === undefined || isNumber(reading)) && (point.note === undefined || isText(point.note)));
}
