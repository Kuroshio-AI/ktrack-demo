import { addDays, addMonthsClamped, approveInspection, createInitialState, createInspection, importRows, recalculateAlerts, redTagInspection, returnInspection, submitInspection, updateInspection } from "./domain";
import { issueSurvey, newPoint, saveSurvey } from "./survey";
import { subseaChecklist } from "./safeen";
import type { AppState, ChecklistItem, RegisterRow } from "./types";

// Fictional SAFEEN Subsea register. Vessels and sites are public; every make, model, serial, person and certificate is an illustration.
export function subseaRows(demoDate: string, sample: "1" | "2"): RegisterRow[] {
  const at = (days: number) => addDays(demoDate, days);
  // An item last certified one interval before it falls due; certificate numbers follow the issuer's style.
  const kit = (assetRef: string, assetType: string, site: string, owner: string, assignedEngineer: string, serialNo: string, months: number, dueIn: number, certificateNo?: string): RegisterRow => ({
    assetRef, recordType: "equipment", assetType, site, owner, assignedEngineer, serialNo, inspectionIntervalMonths: months, inspectionDueDate: at(dueIn), status: "Active",
    ...(certificateNo ? { certificateNo, certificateIssuedDate: addMonthsClamped(at(dueIn), -months), certificateExpiryDate: at(dueIn) } : {}),
  });
  const ticket = (assetRef: string, assetType: string, site: string, owner: string, supervisor: string, expiresIn: number): RegisterRow => ({ assetRef, recordType: "licence", assetType, site, owner, assignedEngineer: supervisor, licenceExpiryDate: at(expiresIn), status: "Active" });
  const S = "SAFEEN Surveyor", G = "SAFEEN Green", T = "SEMIAH", B = "Mussafah Base";

  if (sample === "2") return [
    kit("ROV-04", "Light work-class ROV · Saab Seaeye Leopard", B, "Khalid Nasser", "Arjun Pillai", "LEO-131", 12, 0),
    kit("LARS-02", "ROV LARS, A-frame and winch · Dynacon", B, "Khalid Nasser", "Liam Doyle", "DYN-0502-23", 12, 7),
    kit("TT-03", "Torque tool Class 1-4 · FET HD", B, "Arjun Pillai", "Arjun Pillai", "TT14-0533", 12, -1, "GCL-CAL-25-0841"),
    kit("BCN-11", "USBL transponder · Kongsberg cNODE MiniS", B, "Vikram Rao", "Vikram Rao", "MiniS-30911", 6, 30),
    ticket("CRW-11", "H2S (OPITO 9014) · ROV pilot technician", B, "Yousef Karim", "Khalid Nasser", 7),
    { assetRef: "ROV-00", recordType: "equipment", assetType: "Observation ROV · Saab Seaeye Falcon", site: B, owner: "Khalid Nasser", serialNo: "FAL-0098", status: "Retired" },
  ];
  return [
    // ROV spread on SAFEEN Surveyor
    kit("ROV-01", "Work-class ROV · SMD Quasar MkII", S, "Khalid Nasser", "Arjun Pillai", "QSR-2207", 12, 5, "SAF-ROV-25-031"),
    kit("ROV-02", "Light work-class ROV · Saab Seaeye Leopard", S, "Khalid Nasser", "Arjun Pillai", "LEO-118", 12, 140, "SAF-ROV-26-007"),
    kit("TMS-01", "ROV tether management system · SMD top-hat", S, "Khalid Nasser", "Arjun Pillai", "TMS-2207", 12, 40, "SAF-ROV-25-032"),
    kit("LARS-01", "ROV LARS, A-frame and winch · Dynacon", S, "Khalid Nasser", "Liam Doyle", "DYN-0461-21", 12, -2, "TE-25-1182"),
    { ...kit("UMB-01", "ROV lift umbilical, armoured 27 mm", S, "Khalid Nasser", "Liam Doyle", "UMB-21-0177", 6, 60, "TE-26-0215"), retirementDueDate: at(21) },
    kit("CRN-01", "Offshore crane, 80 t AHC", S, "Omar Haddad", "Liam Doyle", "CRN-SS-01", 12, 30, "TE-25-1240"),
    kit("SLG-01", "Lifting slings and shackles set", S, "Omar Haddad", "Liam Doyle", "LS-0912", 6, 0, "TE-26-0102"),
    kit("MAN-01", "Manipulator, 7-function · Schilling Titan 4", S, "Arjun Pillai", "Arjun Pillai", "T4-2381", 12, 90),
    kit("MAN-02", "Grabber arm, 5-function · Schilling Orion 4R", S, "Arjun Pillai", "Arjun Pillai", "O4R-1170", 12, 200),
    kit("TT-01", "Torque tool Class 1-4 · FET HD", S, "Arjun Pillai", "Arjun Pillai", "TT14-0418", 12, 3, "GCL-CAL-25-0612"),
    kit("TT-02", "Torque tool Class 5", S, "Arjun Pillai", "Arjun Pillai", "TT5-0092", 12, 180, "GCL-CAL-26-0233"),
    kit("TVS-01", "Torque verification unit, Class 1-7", S, "Arjun Pillai", "Arjun Pillai", "TVS-0033", 12, 45, "GCL-CAL-25-0701"),
    kit("UTG-01", "ROV UT thickness gauge · Cygnus ROV Mountable", S, "Arjun Pillai", "Arjun Pillai", "CYG-57201", 12, -10, "GCL-CAL-25-0519"),
    kit("CP-01", "CP probe, proximity Ag/AgCl", S, "Arjun Pillai", "Arjun Pillai", "CP-0731", 12, 120, "GCL-CAL-26-0118"),
    kit("HS-01", "Hot stab, dual-port API 17H", S, "Arjun Pillai", "Liam Doyle", "HS-0219", 12, 75, "TE-26-0077"),
    kit("PT-01", "Pipe tracker · Teledyne TSS 440", S, "Vikram Rao", "Vikram Rao", "440-1182", 12, 160, "GCL-CAL-26-0190"),
    kit("USBL-01", "USBL transceiver · Kongsberg HiPAP 502", S, "Vikram Rao", "Vikram Rao", "HP502-0144", 12, 25, "NAV-VER-25-044"),
    kit("BCN-07", "USBL transponder · Kongsberg cNODE MiniS", S, "Vikram Rao", "Vikram Rao", "MiniS-30871", 6, 7),
    kit("BCN-08", "USBL transponder · Kongsberg cNODE MiniS", S, "Vikram Rao", "Vikram Rao", "MiniS-30872", 6, 50),
    kit("INS-01", "Subsea INS · Exail Phins", S, "Vikram Rao", "Vikram Rao", "PHS-1093", 24, 300, "GCL-CAL-26-0044"),
    kit("GYR-01", "ROV gyro and motion sensor · Exail Octans", S, "Vikram Rao", "Vikram Rao", "OCT-2210", 24, 410, "GCL-CAL-26-0045"),
    kit("GNSS-01", "DGNSS receiver · Veripos LD900", S, "Vikram Rao", "Vikram Rao", "LD9-004417", 12, 150, "GCL-CAL-26-0101"),
    kit("NAV-SS", "Positioning verification (mobilisation)", S, "Vikram Rao", "Vikram Rao", "SS-NAV", 1, 4, "NAV-VER-26-019"),
    // Air-dive spread on SAFEEN Surveyor
    kit("HLM-01", "Diving helmet · Kirby Morgan KM 77", S, "Faisal Rahman", "Faisal Rahman", "KM77-31544", 12, 64, "DIV-26-0031"),
    kit("HLM-02", "Diving helmet · Kirby Morgan KM 77", S, "Faisal Rahman", "Faisal Rahman", "KM77-31602", 12, 15, "DIV-25-0418"),
    kit("DLARS-01", "Diver LARS and basket", S, "Faisal Rahman", "Liam Doyle", "DLARS-0102", 6, 20, "TE-26-0188"),
    kit("GAS-01", "HP gas bank quad, 16 × 50 L cylinders", S, "Faisal Rahman", "Faisal Rahman", "CYL-447812", 60, 400, "DIV-24-0207"),
    // Survey spread on SAFEEN Green, run from the remote operation centre
    kit("MBES-01", "Multibeam echo sounder · Norbit WINGHEAD i77h", G, "Sara Al Ali", "Vikram Rao", "WH-21877", 12, 14, "GCL-CAL-25-0730"),
    kit("SSS-01", "Side-scan sonar · EdgeTech 4205", G, "Sara Al Ali", "Vikram Rao", "4205-51102", 12, 200, "GCL-CAL-26-0151"),
    kit("SBP-01", "Sub-bottom profiler · Innomar SES-2000 compact", G, "Sara Al Ali", "Vikram Rao", "SES-0612", 12, 95, "GCL-CAL-26-0098"),
    kit("MAG-01", "Caesium magnetometer · Geometrics G-882", G, "Sara Al Ali", "Vikram Rao", "882-40917", 12, 30),
    kit("SVP-01", "Sound velocity profiler · Valeport SWiFT", G, "Sara Al Ali", "Vikram Rao", "SWIFT-71204", 12, 55, "GCL-CAL-26-0120"),
    kit("USBL-02", "Compact USBL · Sonardyne Mini-Ranger 2", G, "Vikram Rao", "Vikram Rao", "MR2-20231", 12, 110, "NAV-VER-26-008"),
    kit("NAV-SG", "Positioning verification (mobilisation)", G, "Vikram Rao", "Vikram Rao", "SG-NAV", 1, 2, "NAV-VER-26-020"),
    // Harbour tug
    kit("TWH-01", "Towing hook, quick-release", T, "Omar Haddad", "Liam Doyle", "TH-2214", 12, 80, "TE-26-0061"),
    kit("TWW-01", "Towing winch", T, "Omar Haddad", "Liam Doyle", "TW-0907", 12, 160, "TE-26-0062"),
    kit("SLG-02", "Lifting slings and shackles", T, "Omar Haddad", "Liam Doyle", "LS-1031", 6, 26, "TE-26-0140"),
    // Mussafah workshop
    kit("ROV-03", "Observation ROV · Saab Seaeye Falcon DR", B, "Khalid Nasser", "Arjun Pillai", "FAL-1244", 12, 45, "SAF-ROV-25-040"),
    kit("THR-01", "Electric thruster test bench", B, "Arjun Pillai", "Arjun Pillai", "TB-0001", 12, 70),
    kit("TWR-01", "Workshop torque wrench · Norbar", B, "Arjun Pillai", "Arjun Pillai", "NB-118204", 12, 9, "GCL-CAL-25-0880"),
    { assetRef: "UTG-00", recordType: "equipment", assetType: "ROV UT thickness gauge · Cygnus ROV Mountable", site: B, owner: "Arjun Pillai", serialNo: "CYG-44101", status: "Retired" },
    // Crew tickets: the holder is the owner, their supervisor follows it up
    ticket("CRW-01", "BOSIET (OPITO) · ROV pilot technician", S, "Omar Haddad", "Khalid Nasser", 12),
    ticket("CRW-02", "H2S (OPITO 9014) · ROV pilot technician", S, "Omar Haddad", "Khalid Nasser", 200),
    ticket("CRW-03", "Diver medical (IMCA D 014) · Air diver", S, "Faisal Rahman", "Khalid Nasser", -4),
    ticket("CRW-04", "H2S (OPITO 9014) · Online surveyor", B, "Sara Al Ali", "Vikram Rao", 6),
    ticket("CRW-05", "BOSIET (OPITO) · Party chief", S, "Vikram Rao", "Khalid Nasser", 540),
    ticket("CRW-06", "DP certificate (Nautical Institute) · DPO", S, "Liam Doyle", "Khalid Nasser", 900),
    ticket("CRW-07", "STCW basic safety · USV remote operator", B, "Hamad Saeed", "Vikram Rao", 300),
  ];
}

// The full demo: the register plus the work around it, so every screen has something to show.
// Checklists are set from the SAFEEN obligations directly, so this reads the same in tests as in the SAFEEN build.
export function subseaDemo(demoDate: string): AppState {
  const stamp = (days: number, time: string) => `${addDays(demoDate, days)}T${time}:00.000Z`;
  let state = importRows(createInitialState(demoDate), subseaRows(demoDate, "1"), "Admin", stamp(-30, "06:00"));
  const id = (ref: string) => state.records.find((record) => record.assetRef === ref)!.id;
  // A checklist answered Pass throughout, with one item failed when the story needs it.
  function inspect(ref: string, days: number, fail?: RegExp, notes = ""): string {
    const record = state.records.find((item) => item.assetRef === ref)!;
    const created = createInspection(state, record.id, "Engineer", stamp(days, "07:10"));
    const checklist: ChecklistItem[] = subseaChecklist(record).map((label, index) => ({ id: `check-${index + 1}`, label, result: fail?.test(label) ? "fail" : "pass" }));
    state = updateInspection(created.state, created.inspection.id, { checklist, notes }, stamp(days, "08:40"));
    state = submitInspection({ ...state, role: "Engineer" }, created.inspection.id, stamp(days, "08:45"));
    return created.inspection.id;
  }

  // Slings examined this morning and certified for six months: a printable certificate with its checklist.
  const slings = inspect("SLG-01", 0, undefined, "All 14 slings and 22 shackles tagged with this period's colour.");
  state = approveInspection({ ...state, role: "Reviewer" }, slings, addMonthsClamped(demoDate, 6), "Reviewer", stamp(0, "09:30"));

  // A transponder flooded on recovery two days ago and was red-tagged.
  const beacon = inspect("BCN-08", -2, /O-rings/, "Water in the battery compartment after recovery from 18 m.");
  state = { ...redTagInspection({ ...state, demoDate: addDays(demoDate, -2), role: "Reviewer" }, beacon, "Flooded on recovery; O-ring seat damaged. Sent to Mussafah for repair.", "Reviewer", stamp(-2, "11:05")), demoDate };

  // The multibeam check came back for its missing patch-test evidence.
  const multibeam = inspect("MBES-01", -1, undefined, "Patch test run on the Das Island approach line.");
  state = returnInspection({ ...state, role: "Reviewer" }, multibeam, "Attach the patch-test report; the roll offset isn't recorded.", "Reviewer", stamp(-1, "15:20"));

  // The LARS examination found the winch brake slipping and waits for the reviewer's decision.
  inspect("LARS-01", 0, /Brakes/, "Winch brake slipped 40 mm during the static hold at 1.1 × SWL. Hydraulic weep at the brake caliper.");

  // The pre-dive check on the main ROV is half done on deck.
  const draft = createInspection(state, id("ROV-01"), "Engineer", stamp(0, "06:30"));
  state = updateInspection(draft.state, draft.inspection.id, { checklist: draft.inspection.checklist.map((item, index) => index < 3 ? { ...item, result: "pass" as const } : item) }, stamp(0, "06:50"));

  // Two survey tallies. The export line was surveyed and issued three weeks ago, while the UT gauge was still in date; the
  // riser survey is on the ROV now, and can't be issued until that gauge is recalibrated.
  const point = (kp: number, cp?: number, wall?: number, anode?: number, code = "OK", note?: string) => ({ ...newPoint(kp), cp, wall, anode, code, ...(note ? { note } : {}) });
  const exportLine = { title: "Export line CP and UT survey, KP 12.0 to 13.2", line: "16\" Das Island export line", site: "SAFEEN Surveyor", date: addDays(demoDate, -21), rovId: id("ROV-02"), equipmentIds: [id("CP-01"), id("UTG-01")], nominalWall: 15.9, minWall: 12.7,
    points: [point(12.0, -1032, 15.7, 30), point(12.15, -1028, 15.8, 32), point(12.3, -1019, 15.6, 35), point(12.45, -1010, 15.7, 41, "CD", "Coating scrape at 3 o'clock, 0.3 m long"), point(12.6, -1004, 15.5, 62), point(12.75, -1015, 15.8, 38), point(12.9, -1021, 15.7, 33), point(13.05, -1026, 15.9, 29), point(13.2, -1030, 15.8, 31)] };
  state = saveSurvey({ ...state, demoDate: exportLine.date }, exportLine, "Engineer", stamp(-21, "16:10"));
  state = { ...issueSurvey(state, state.surveys![0].id, "Reviewer", stamp(-20, "10:30")), demoDate };
  const riser = { title: "Riser R-3 CP and UT survey", line: "Upper Zakum riser R-3", site: "SAFEEN Surveyor", date: demoDate, rovId: id("ROV-01"), equipmentIds: [id("CP-01"), id("UTG-01")], nominalWall: 19.1, minWall: 15.2,
    points: [point(0, -1020, 18.9, 25), point(0.15, -1005, 18.7, 30), point(0.3, -780, 16.1, 90, "CD", "Anode nearly gone; coating holiday beside it"), point(0.45, -995, 18.8, 35), point(0.6, -1012, 18.6, 40, "FS", "Free span about 14 m at the riser base"), point(0.75, -1118, 18.9, 20), point(0.9)] };
  state = saveSurvey(state, riser, "Engineer", stamp(0, "08:05"));

  return recalculateAlerts({ ...state, role: "Admin" }, stamp(0, "09:45"));
}
