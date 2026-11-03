// Which client this build is for. Next inlines NEXT_PUBLIC_ values at build time, so each Vercel project picks one.
// Unset (the Kee Safety demo) keeps every Kee page; "safeen" builds the SAFEEN Subsea ROV and survey equipment demo from the same code.
export const IS_SAFEEN = process.env.NEXT_PUBLIC_CLIENT === "safeen";

export const BRAND = IS_SAFEEN
  ? { name: "SAFEEN Subsea", tagline: "Subsea spread operations", mark: "S" }
  : { name: "Kee Safety", tagline: "Kee Safety operations", mark: "K" };

// Pages one build leaves out: SAFEEN has no warranties or sustainability savings, and Kee has no spreads map, survey tallies or anomaly register.
export const HIDDEN_VIEWS = IS_SAFEEN ? ["warranties", "sustainability"] : ["spreads", "surveys", "anomalies"];
