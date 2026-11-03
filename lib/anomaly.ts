import { activity, isDateString, nowIso } from "./domain";
import { gradePoint, KIND_OF_CODE, worse, type FindingKind, type Survey, type SurveyPoint, type SurveyResult } from "./survey";
import type { AppState, Role } from "./types";

// The anomaly register: every finding an issued survey makes becomes a tracked item, kept from the day it is found until it
// is closed out. A later campaign on the same line updates the same anomaly instead of starting a new one.

export type AnomalyStatus = "Open" | "Action planned" | "Repaired" | "Re-inspected" | "Closed";
export const ANOMALY_STATUSES: AnomalyStatus[] = ["Open", "Action planned", "Repaired", "Re-inspected", "Closed"];
export type Sighting = { surveyId: string; survey: string; date: string; kp: number; measure: string; result: SurveyResult };
export type AnomalyEvent = { status: AnomalyStatus; date: string; at: string; by: Role | "system"; note: string };
export type Anomaly = {
  id: string; number: string; line: string; kind: FindingKind; kp: number;
  result: SurveyResult; action: string; target?: string;
  status: AnomalyStatus; sightings: Sighting[]; history: AnomalyEvent[];
};

// What a contractor usually recommends for each kind; the reviewer can change it when planning the work.
export const RECOMMENDED: Record<FindingKind, string> = {
  "Low CP": "CP survey and anode retrofit", "Over-protection": "Check anode output", "Wall loss": "Engineering assessment",
  "Anode depletion": "Anode replacement", "Free span": "Grout bag support", "Exposure": "Rock dump to restore cover",
  "Coating damage": "Coating repair", "Dent": "Engineering assessment", "Debris": "Debris removal",
};

// A finding within 100 m of an open anomaly of the same kind on the same line is the same anomaly seen again.
const SAME_PLACE_KM = 0.1;
const near = (a: number, b: number, km = SAME_PLACE_KM) => Math.abs(a - b) <= km + 1e-9;
const event = (status: AnomalyStatus, date: string, at: string, by: Role | "system", note: string): AnomalyEvent => ({ status, date, at, by, note });

function nextNumber(anomalies: Anomaly[]) {
  const last = Math.max(229, ...anomalies.map((item) => Number(item.number.slice(4)) || 0));
  return `ANM-${String(last + 1).padStart(4, "0")}`;
}

// Files an issued survey's findings. New ones open; known ones get a new sighting, and one already repaired goes back to
// Action planned if it still fails. A repaired anomaly the survey passed over without a finding is re-inspected.
export function syncAnomalies(state: AppState, survey: Survey, actor: Role, timestamp: string): AppState {
  let anomalies = [...(state.anomalies ?? [])];
  const log = [] as ReturnType<typeof activity>[];
  const seen = new Set<string>();
  for (const point of survey.points) {
    for (const finding of gradePoint(point, survey).findings) {
      const sighting: Sighting = { surveyId: survey.id, survey: survey.number, date: survey.date, kp: point.kp, measure: finding.measure, result: finding.result };
      const known = anomalies.find((item) => item.line === survey.line && item.kind === finding.kind && item.status !== "Closed" && near(item.kp, point.kp) && !seen.has(item.id));
      if (!known) {
        const created: Anomaly = { id: `anm-${survey.id}-${point.id}-${finding.kind}`, number: nextNumber(anomalies), line: survey.line, kind: finding.kind, kp: point.kp, result: finding.result, action: RECOMMENDED[finding.kind], status: "Open", sightings: [sighting], history: [event("Open", survey.date, timestamp, actor, `Found in ${survey.number}: ${finding.reason}`)] };
        anomalies = [created, ...anomalies];
        seen.add(created.id);
        if (finding.result === "Repair") log.push(activity("Anomaly opened", `${created.number} · ${finding.kind} at KP ${point.kp.toFixed(3)} · Repair`, actor, timestamp));
        continue;
      }
      seen.add(known.id);
      const before = known.sightings.at(-1);
      const note = known.status === "Repaired" ? `Re-inspected in ${survey.number} and still failing: ${finding.reason}`
        : before && worse(finding.result, known.result) ? `Worse in ${survey.number}: ${before.measure} to ${finding.measure}, now ${finding.result}`
        : `Seen again in ${survey.number}: ${finding.measure}`;
      const status: AnomalyStatus = known.status === "Repaired" || known.status === "Re-inspected" ? "Action planned" : known.status;
      anomalies = anomalies.map((item) => item.id === known.id ? { ...item, kp: point.kp, result: finding.result, status, sightings: [...item.sightings, sighting], history: [...item.history, event(status, survey.date, timestamp, actor, note)] } : item);
    }
  }
  // Repaired anomalies inside the surveyed stretch that this campaign no longer finds have passed their re-inspection.
  const kps = survey.points.map((point) => point.kp);
  const [from, to] = [Math.min(...kps), Math.max(...kps)];
  anomalies = anomalies.map((item) => item.line === survey.line && item.status === "Repaired" && !seen.has(item.id) && item.kp >= from - SAME_PLACE_KM && item.kp <= to + SAME_PLACE_KM
    ? { ...item, status: "Re-inspected", history: [...item.history, event("Re-inspected", survey.date, timestamp, actor, `Not found in ${survey.number}; ready to close out`)] }
    : item);
  return { ...state, anomalies, activity: [...log, ...state.activity] };
}

// The next step for an anomaly. Planning names the work and a target date; the repair records the work order; only a
// reviewer closes out, and only after a later survey has re-inspected it.
export const NEXT_STEP: Partial<Record<AnomalyStatus, AnomalyStatus>> = { Open: "Action planned", "Action planned": "Repaired", "Re-inspected": "Closed" };
export const canAdvance = (anomaly: Pick<Anomaly, "status">, role: Role) => Boolean(NEXT_STEP[anomaly.status]) && role !== "Manager" && (anomaly.status !== "Re-inspected" || role === "Admin" || role === "Reviewer");

export function advanceAnomaly(state: AppState, id: string, note: string, change: { action?: string; target?: string } = {}, actor = state.role, timestamp = nowIso()): AppState {
  const anomaly = state.anomalies?.find((item) => item.id === id);
  const next = anomaly && NEXT_STEP[anomaly.status];
  if (!anomaly || !next || !canAdvance(anomaly, actor) || !note.trim() || (next === "Action planned" && !(change.action ?? anomaly.action).trim())) return state;
  const action = next === "Action planned" ? (change.action ?? anomaly.action).trim() : anomaly.action;
  const target = next === "Action planned" ? change.target || undefined : anomaly.target;
  return {
    ...state,
    anomalies: state.anomalies!.map((item) => item.id === id ? { ...item, status: next, action, target, history: [...item.history, event(next, state.demoDate, timestamp, actor, note.trim())] } : item),
    activity: [activity(`Anomaly ${next.toLowerCase()}`, `${anomaly.number} · ${note.trim()}`, actor, timestamp), ...state.activity],
  };
}

// Year on year: the same line in two campaigns, point matched to point by KP. Each measurement that failed in either campaign,
// or moved by more than its threshold, becomes one row: new, worse, unchanged or resolved.
export type Change = "New" | "Worsened" | "Unchanged" | "Resolved";
export type ChangeRow = { kp: number; item: string; before: string; after: string; change: Change; result: SurveyResult };
const SAME_POINT_KM = 0.05;
// How far a reading has to move to count as worse: towards the CP limit, wall lost, anode used, span or exposure grown.
const THRESHOLD = { cp: 50, wall: 0.5, anode: 10, length: 2 };

export function compareSurveys(older: Survey, newer: Survey): ChangeRow[] {
  const rows: ChangeRow[] = [];
  for (const after of newer.points) {
    const before = older.points.find((point) => near(point.kp, after.kp, SAME_POINT_KM));
    const was = before ? gradePoint(before, older).findings : [];
    const now = gradePoint(after, newer).findings;
    const failing = (findings: typeof now, kinds: FindingKind[]) => findings.find((item) => kinds.includes(item.kind));
    const numeric = (item: string, kinds: FindingKind[], read: (point: SurveyPoint) => number | undefined, unit: string, worseBy: (from: number, to: number) => number, threshold: number) => {
      const from = before && read(before);
      const to = read(after);
      const wasBad = failing(was, kinds);
      const isBad = failing(now, kinds);
      if (to === undefined || (!wasBad && !isBad && (from === undefined || worseBy(from, to) < threshold))) return;
      const result = isBad?.result ?? "Accept";
      const change: Change = from === undefined ? "New" : worseBy(from, to) >= threshold || (isBad && wasBad && worse(isBad.result, wasBad.result)) ? "Worsened" : wasBad && !isBad ? "Resolved" : isBad && !wasBad ? "Worsened" : "Unchanged";
      rows.push({ kp: after.kp, item, before: from === undefined ? "Not read" : `${from}${unit}`, after: `${to}${unit}`, change, result });
    };
    numeric("CP reading", ["Low CP", "Over-protection"], (point) => point.cp, " mV", (from, to) => to - from, THRESHOLD.cp);
    numeric("Wall thickness", ["Wall loss"], (point) => point.wall, " mm", (from, to) => from - to, THRESHOLD.wall);
    numeric("Anode", ["Anode depletion"], (point) => point.anode, "% depleted", (from, to) => to - from, THRESHOLD.anode);
    // Seen-on-video findings: present now and not before is new, grown or graded worse is worse, gone is resolved.
    const visual = (point?: SurveyPoint) => point && KIND_OF_CODE[point.code] ? point : undefined;
    const then = visual(before);
    const seen = visual(after);
    const describe = (point: SurveyPoint) => point.length !== undefined ? `${point.length} m` : "Present";
    if (seen) {
      const kind = KIND_OF_CODE[seen.code];
      const finding = now.find((item) => item.kind === kind);
      const earlier = then?.code === seen.code ? then : undefined;
      const grown = earlier?.length !== undefined && seen.length !== undefined && seen.length - earlier.length >= THRESHOLD.length;
      const graded = finding && was.some((item) => item.kind === kind && worse(finding.result, item.result));
      rows.push({ kp: after.kp, item: kind, before: earlier ? describe(earlier) : "Not present", after: describe(seen), change: !earlier ? "New" : grown || graded ? "Worsened" : "Unchanged", result: finding?.result ?? "Monitor" });
    }
    if (then && then.code !== seen?.code) rows.push({ kp: after.kp, item: KIND_OF_CODE[then.code], before: describe(then), after: "Not found", change: "Resolved", result: "Accept" });
  }
  return rows.sort((a, b) => a.kp - b.kp);
}

// The campaign before this one on the same line, if one was issued.
export const previousCampaign = (surveys: Survey[], survey: Survey) =>
  surveys.filter((item) => item.id !== survey.id && item.line === survey.line && item.status === "Issued" && item.date < survey.date).sort((a, b) => b.date.localeCompare(a.date))[0];

const isText = (value: unknown): value is string => typeof value === "string";
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const RESULTS = ["Accept", "Monitor", "Repair"];

export function isAnomaly(value: unknown): value is Anomaly {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<Anomaly>;
  return [item.id, item.number, item.line, item.kind, item.action].every(isText) && isNumber(item.kp) && RESULTS.includes(item.result as string)
    && ANOMALY_STATUSES.includes(item.status as AnomalyStatus) && (item.target === undefined || isDateString(item.target))
    && Array.isArray(item.sightings) && item.sightings.every((sighting) => Boolean(sighting) && [sighting.surveyId, sighting.survey, sighting.measure].every(isText) && isDateString(sighting.date) && isNumber(sighting.kp) && RESULTS.includes(sighting.result))
    && Array.isArray(item.history) && item.history.every((entry) => Boolean(entry) && ANOMALY_STATUSES.includes(entry.status) && isDateString(entry.date) && isText(entry.at) && isText(entry.note));
}
