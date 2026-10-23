// Which client this build is for. Next inlines NEXT_PUBLIC_ values at build time, so each Vercel project picks one.
// Unset (the Kee Safety demo) keeps every Kee page; "fls" builds the DXB FLS certificate tracker from the same code.
export const IS_FLS = process.env.NEXT_PUBLIC_CLIENT === "fls";
// "ams" builds the drill string inspection demo for Al Mansoori Inspection Services: tally sheets checked against a dimension table.
export const IS_AMS = process.env.NEXT_PUBLIC_CLIENT === "ams";
export const AMS_NAME = "Al Mansoori Inspection Services";

// The FLS sheet's Due Date is always 15 days before the certificate expires (=E-15).
export const FLS_DUE_LEAD_DAYS = 15;

// The FLS service provider's forms answer each item Ok, Not Ok or N/A; Kee's inspections say Pass and Fail.
export const RESULT_LABELS = IS_FLS ? { pass: "Ok", fail: "Not Ok", na: "N/A" } : { pass: "Pass", fail: "Fail", na: "N/A" };
