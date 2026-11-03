import { nextDeadline, OUT_OF_SERVICE } from "./domain";
import { siteFor, SPREAD_SITES, type SpreadSite } from "./safeen";
import type { AssetRecord } from "./types";

type Due = { record: AssetRecord; deadline: NonNullable<ReturnType<typeof nextDeadline>> };
export type Readiness = { site: SpreadSite; records: AssetRecord[]; blocking: Due[]; dueThisWeek: Due[]; dueThisMonth: number };

// A spread is not fit to work while anything on it is overdue or out of service; that list is the reason, most urgent first.
export function spreadReadiness(records: AssetRecord[], demoDate: string): Readiness[] {
  const active = records.filter((record) => record.status === "Active");
  return SPREAD_SITES.map((site) => {
    const dues = active.filter((record) => siteFor(record.site) === site).map((record) => ({ record, deadline: nextDeadline(record, demoDate) }));
    const dated = dues.filter((due): due is Due => Boolean(due.deadline)).sort((a, b) => a.deadline.days - b.deadline.days);
    return {
      site,
      records: [...dated.map((due) => due.record), ...dues.filter((due) => !due.deadline).map((due) => due.record)],
      blocking: dated.filter((due) => due.deadline.days < 0 || due.deadline.event === OUT_OF_SERVICE).sort((a, b) => Number(b.deadline.event === OUT_OF_SERVICE) - Number(a.deadline.event === OUT_OF_SERVICE)),
      dueThisWeek: dated.filter((due) => due.deadline.days >= 0 && due.deadline.days <= 7 && due.deadline.event !== OUT_OF_SERVICE),
      dueThisMonth: dated.filter((due) => due.deadline.days >= 0 && due.deadline.days <= 30 && due.deadline.event !== OUT_OF_SERVICE).length,
    };
  });
}

export const unplacedRecords = (records: AssetRecord[]) => records.filter((record) => record.status === "Active" && !siteFor(record.site));
