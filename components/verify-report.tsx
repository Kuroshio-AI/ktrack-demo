"use client";

// The verify page renders on the server, and tally-report.tsx also holds the report dialog's hooks, so a scanned report is
// drawn in the browser.
export { TallyReport as VerifyReport } from "@/components/tally-report";
