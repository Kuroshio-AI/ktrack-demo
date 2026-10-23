import type { ConnectionSpec, Inspection, Joint, Limit } from "./types";

// Grades a tally sheet's joints against the connection's dimension table. Only Premium or Reject:
// the client's table gives Premium class limits, and Class 2 waits for their Class 2 table.
export type Grade = "Premium" | "Reject" | "Pending";
export type Failure = { column: string; value: number; limit: number; side: "min" | "max" };

// Gauges read to a thousandth of an inch, so compare at three decimals; a value on the limit passes.
const thou = (value: number) => Math.round(value * 1000) / 1000;
export const inches = (value: number) => value.toFixed(3);

export function limitFailure(limit: Limit, value: number | undefined): Failure | undefined {
  if (value === undefined) return undefined;
  if (limit.min !== undefined && thou(value) < thou(limit.min)) return { column: limit.column, value, limit: limit.min, side: "min" };
  if (limit.max !== undefined && thou(value) > thou(limit.max)) return { column: limit.column, value, limit: limit.max, side: "max" };
  return undefined;
}

// One failed limit or a failed visual check rejects the joint at once; otherwise it waits until every value is in.
export function gradeJoint(spec: ConnectionSpec, joint: Joint): { grade: Grade; failures: Failure[] } {
  const failures = spec.limits.flatMap((limit) => limitFailure(limit, joint.values[limit.column]) ?? []);
  if (failures.length || joint.visual === "fail") return { grade: "Reject", failures };
  const measured = spec.limits.every((limit) => joint.values[limit.column] !== undefined);
  return { grade: measured && joint.visual === "pass" ? "Premium" : "Pending", failures };
}

// "Tong space box 5.940, min 6.000"
export const failureText = ({ column, value, limit, side }: Failure) => `${column} ${inches(value)}, ${side} ${inches(limit)}`;

export const limitText = ({ min, max }: Limit) => min !== undefined && max !== undefined ? `${inches(min)} to ${inches(max)}` : min !== undefined ? `min ${inches(min)}` : max !== undefined ? `max ${inches(max)}` : "";

export const connectionLabel = (spec: Pick<ConnectionSpec, "size" | "weight" | "connection" | "grade">) => `${spec.size}" ${spec.weight} ${spec.connection} grade ${spec.grade}`;

export const VISUAL = "Visual";

export type TallySummary = {
  total: number;
  premium: number;
  reject: number;
  pending: number;
  // How many joints each limit (or the visual check) rejected; a joint can fail more than one.
  reasons: { column: string; count: number }[];
  rejects: { joint: Joint; failures: Failure[] }[];
};

export function summarizeTally(spec: ConnectionSpec, joints: Joint[]): TallySummary {
  const graded = joints.map((joint) => ({ joint, ...gradeJoint(spec, joint) }));
  const rejects = graded.filter((item) => item.grade === "Reject");
  const reasons = [...spec.limits.map((limit) => limit.column), VISUAL]
    .map((column) => ({ column, count: rejects.filter(({ joint, failures }) => column === VISUAL ? joint.visual === "fail" : failures.some((failure) => failure.column === column)).length }))
    .filter((reason) => reason.count > 0);
  return {
    total: joints.length,
    premium: graded.filter((item) => item.grade === "Premium").length,
    reject: rejects.length,
    pending: graded.filter((item) => item.grade === "Pending").length,
    reasons,
    rejects: rejects.map(({ joint, failures }) => ({ joint, failures })),
  };
}

// A tally sheet can go for approval once every joint is graded.
export const tallyComplete = (inspection: Pick<Inspection, "connection" | "joints">) =>
  Boolean(inspection.connection && inspection.joints?.length && inspection.joints.every((joint) => gradeJoint(inspection.connection!, joint).grade !== "Pending"));

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isOptionalNumber = (value: unknown) => value === undefined || isNumber(value);

export function isConnectionSpec(value: unknown): value is ConnectionSpec {
  if (!value || typeof value !== "object") return false;
  const spec = value as Partial<ConnectionSpec>;
  return [spec.id, spec.size, spec.weight, spec.connection, spec.grade].every((item) => typeof item === "string")
    && (spec.sample === undefined || typeof spec.sample === "boolean")
    && Array.isArray(spec.limits) && spec.limits.every((limit) => Boolean(limit && typeof limit === "object" && typeof limit.column === "string" && isOptionalNumber(limit.min) && isOptionalNumber(limit.max)));
}

export function isJoint(value: unknown): value is Joint {
  if (!value || typeof value !== "object") return false;
  const joint = value as Partial<Joint>;
  return Number.isSafeInteger(joint.no) && (joint.serial === undefined || typeof joint.serial === "string")
    && ["pass", "fail", "pending"].includes(joint.visual as string)
    && Boolean(joint.values && typeof joint.values === "object" && !Array.isArray(joint.values) && Object.values(joint.values).every(isNumber));
}
