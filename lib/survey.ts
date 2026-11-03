import { activity, isDateString, makeId, nextDeadline, nowIso, OUT_OF_SERVICE } from "./domain";
import { obligationFor } from "./safeen";
import type { AppState, AssetRecord, Role } from "./types";

// The pipeline and riser survey tally: one row per point along the line (KP, km from the start), with the ROV's CP stab,
// the UT wall reading and the nearest anode's depletion, each graded as it is typed. Like the AMS drill pipe tally, KTrack
// suggests the result and the report rolls the rows up; the instruments used must be in calibration before it is issued.

export type SurveyResult = "Accept" | "Monitor" | "Repair";
export type SurveyPoint = { id: string; kp: number; cp?: number; wall?: number; anode?: number; code: string; note?: string };
export type Survey = {
  id: string; number: string; title: string; line: string; site: string; date: string;
  rovId?: string; equipmentIds: string[];
  nominalWall: number; minWall: number;
  points: SurveyPoint[];
  status: "Draft" | "Issued"; issuedBy?: Role; issuedAt?: string;
  createdAt: string; updatedAt: string;
};

// Sample criteria for the demo, marked as such on screen and in the report; the client's procedure replaces them.
// CP against an Ag/AgCl seawater cell: -800 mV or more negative protects carbon steel; past -1100 mV risks hydrogen damage in
// high-strength steel (DNV-RP-B401). Wall below the minimum allowable needs repair; below 87.5% of nominal (the line pipe
// mill tolerance) it is watched. Anodes are watched past half consumed and retrofitted past three quarters.
export const CRITERIA = { protectedMv: -800, overMv: -1100, millTolerance: 0.875, anodeWatch: 50, anodeRetrofit: 75 };

export const POINT_CODES: Record<string, { label: string; result: SurveyResult }> = {
  OK: { label: "No anomaly", result: "Accept" },
  CD: { label: "Coating damage", result: "Monitor" },
  FS: { label: "Free span", result: "Monitor" },
  EXP: { label: "Exposed (burial lost)", result: "Monitor" },
  DEB: { label: "Debris on or near the line", result: "Monitor" },
  DNT: { label: "Dent or gouge", result: "Repair" },
};

// reasons are the report's sentences; tags are the same findings cut down for the tally grid.
export type Graded = { result: SurveyResult | "Pending"; reasons: string[]; tags: string[] };
const RANK: SurveyResult[] = ["Accept", "Monitor", "Repair"];
const worst = (results: SurveyResult[]) => results.reduce<SurveyResult>((top, item) => RANK.indexOf(item) > RANK.indexOf(top) ? item : top, "Accept");

// The worst of the four checks wins. CP is read at every point, so a point without one is still pending.
export function gradePoint(point: SurveyPoint, survey: Pick<Survey, "nominalWall" | "minWall">): Graded {
  if (point.cp === undefined) return { result: "Pending", reasons: [], tags: [] };
  const found: [SurveyResult, string, string][] = [];
  if (point.cp > CRITERIA.protectedMv) found.push(["Repair", `Under-protected: ${point.cp} mV, limit ${CRITERIA.protectedMv} mV`, `CP ${point.cp} mV`]);
  else if (point.cp < CRITERIA.overMv) found.push(["Monitor", `Over-protected: ${point.cp} mV, past ${CRITERIA.overMv} mV`, `Over-protected ${point.cp} mV`]);
  if (point.wall !== undefined) {
    const percent = Math.round((point.wall / survey.nominalWall) * 100);
    if (point.wall < survey.minWall) found.push(["Repair", `Wall ${point.wall} mm, below the ${survey.minWall} mm minimum allowable`, `Wall ${point.wall} mm, under minimum`]);
    else if (point.wall < survey.nominalWall * CRITERIA.millTolerance) found.push(["Monitor", `Wall ${point.wall} mm, ${percent}% of nominal ${survey.nominalWall} mm`, `Wall ${percent}%`]);
  }
  if (point.anode !== undefined) {
    if (point.anode > CRITERIA.anodeRetrofit) found.push(["Repair", `Anode ${point.anode}% consumed; plan a retrofit`, `Anode ${point.anode}%`]);
    else if (point.anode > CRITERIA.anodeWatch) found.push(["Monitor", `Anode ${point.anode}% consumed`, `Anode ${point.anode}%`]);
  }
  const code = POINT_CODES[point.code];
  if (code && code.result !== "Accept") found.push([code.result, code.label, code.label]);
  return { result: worst(found.map(([result]) => result)), reasons: found.map(([, reason]) => reason), tags: found.map(([, , tag]) => tag) };
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
  return {
    ...state,
    surveys: state.surveys!.map((item) => item.id === id ? { ...item, status: "Issued", issuedBy: actor, issuedAt: timestamp, updatedAt: timestamp } : item),
    activity: [activity("Survey report issued", `${survey.number} · ${repair} for repair, ${monitor} to monitor`, actor, timestamp), ...state.activity],
  };
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isText = (value: unknown): value is string => typeof value === "string";

export function isSurvey(value: unknown): value is Survey {
  if (!value || typeof value !== "object") return false;
  const survey = value as Partial<Survey>;
  return [survey.id, survey.number, survey.title, survey.line, survey.site, survey.createdAt, survey.updatedAt].every(isText) && isDateString(survey.date)
    && (survey.rovId === undefined || isText(survey.rovId)) && Array.isArray(survey.equipmentIds) && survey.equipmentIds.every(isText)
    && isNumber(survey.nominalWall) && survey.nominalWall > 0 && isNumber(survey.minWall) && survey.minWall > 0
    && (survey.status === "Draft" || survey.status === "Issued") && (survey.issuedAt === undefined || isText(survey.issuedAt))
    && Array.isArray(survey.points) && survey.points.every((point) => Boolean(point) && isText(point.id) && isNumber(point.kp) && isText(point.code)
      && [point.cp, point.wall, point.anode].every((reading) => reading === undefined || isNumber(reading)) && (point.note === undefined || isText(point.note)));
}
