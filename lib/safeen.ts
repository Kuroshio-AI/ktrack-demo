// SAFEEN Subsea build: where each spread is working, what each kind of equipment owes, and the checks it gets before it is certified.
// Positions are field-level demo fixes off Abu Dhabi, not live vessel tracking.

export type SpreadSite = { name: string; kind: "Vessel" | "Unmanned vessel" | "Harbour tug" | "Base"; activity: string; lat: number; lon: number };

export const SPREAD_SITES: SpreadSite[] = [
  { name: "SAFEEN Surveyor", kind: "Vessel", activity: "On DP at Upper Zakum · ROV visual and CP survey of risers", lat: 24.853, lon: 53.662 },
  { name: "SAFEEN Green", kind: "Unmanned vessel", activity: "Run from an onshore control centre · pipeline route survey to Das Island", lat: 25.105, lon: 52.965 },
  { name: "SEMIAH", kind: "Harbour tug", activity: "On station at Khalifa Port", lat: 24.833, lon: 54.667 },
  { name: "Mussafah Base", kind: "Base", activity: "Workshop · calibration and spread mobilisation", lat: 24.333, lon: 54.517 },
];

export const siteFor = (name: string) => SPREAD_SITES.find((site) => site.name.toLowerCase() === name.trim().toLowerCase());

// 24°50.52′N 053°39.66′E, the way a survey log writes a fix.
export function formatFix(lat: number, lon: number): string {
  const part = (value: number, degrees: number, positive: string, negative: string) => {
    const abs = Math.abs(value);
    return `${String(Math.floor(abs)).padStart(degrees, "0")}°${((abs % 1) * 60).toFixed(2).padStart(5, "0")}′${value >= 0 ? positive : negative}`;
  };
  return `${part(lat, 2, "N", "S")} ${part(lon, 3, "E", "W")}`;
}

// What a kind of equipment owes: the deadline's name, the document an approved check produces, the guidance it follows, and its checks.
export type Obligation = { due: string; document: string; reference: string; checklist: string[] };

// First match wins, so tooling (an "ROV UT gauge") is caught before the ROV itself. The phone form allows 12 items.
const OBLIGATIONS: [RegExp, Obligation][] = [
  [/positioning verification/i, { due: "Positioning verification due", document: "Positioning verification record", reference: "IOGP 624-01 · IMCA S 017", checklist: ["DGNSS position checked against a known point (record the delta in metres)", "Gyro heading compared against the quay or a reference (record the delta in degrees)", "USBL verified on a seabed transponder; calibrated if it failed", "Sensor offsets in the navigation software match the dimensional survey", "Sound velocity profile compared against the probe at the transducer", "Results signed off by the party chief"] }],
  [/torque|cp probe|thickness|\but\b|cleaning|cutter|hot stab|tool/i, { due: "Calibration due", document: "Calibration check record", reference: "OEM calibration procedure", checklist: ["Calibration certificate in date and serial number matches", "Reading checked against the reference block, cell or verification unit", "Hot stab, interface and seals undamaged", "Hydraulic or electrical connections tested on deck", "Tool flushed, cleaned and stowed after the last dive"] }],
  [/usbl|beacon|transponder/i, { due: "Verification due", document: "USBL verification record", reference: "IOGP 624-01", checklist: ["Serial number and channel match the navigation setup", "Batteries charged and release tested", "Housings, O-rings and seats undamaged", "Verification against a seabed reference within tolerance", "Cables and connectors dry and undamaged"] }],
  [/gnss|gps|gyro|\bins\b|motion|tracker|magnetometer/i, { due: "Calibration due", document: "Calibration check record", reference: "OEM calibration procedure", checklist: ["Serial number matches the calibration certificate", "Offsets in the navigation software match the vessel survey", "Position or heading check against a reference within tolerance", "Cables, antennas and connectors undamaged"] }],
  [/sonar|echo|mbes|sss|profiler|svp|sound velocity/i, { due: "Calibration due", document: "Calibration check record", reference: "Patch test · OEM calibration", checklist: ["Patch test or calibration within tolerance", "Sound velocity probe compared against a reference cast", "Transducer face clean and undamaged", "Mounting or tow cable secure", "Logging and PPS time sync checked"] }],
  // IMCA R 011 covers ROV launch and recovery only; a diver LARS lifts people, cranes and loose gear follow LOLER, and towing gear is not lifting equipment.
  [/diver lars|basket/i, { due: "Thorough examination due", document: "Report of thorough examination", reference: "IMCA D 018 · LOLER reg. 9", checklist: ["SWL marking legible and load test in date", "Basket, gate and secondary lifting point undamaged", "Wire rope free of broken wires, kinks and corrosion", "Brakes and hydraulics hold the load", "Emergency recovery tested", "Limit switches and emergency stop work"] }],
  [/lars|a-frame|umbilical/i, { due: "Thorough examination due", document: "Report of thorough examination", reference: "IMCA R 011 · LOLER reg. 9", checklist: ["SWL marking legible and load test in date", "Sheaves, pins and shackles free of wear and cracks", "Wire rope or umbilical free of broken wires, kinks and corrosion", "Brakes and hydraulics hold the load", "Latch or snubber locks the vehicle", "Limit switches and emergency stop work"] }],
  [/crane/i, { due: "Thorough examination due", document: "Report of thorough examination", reference: "LOLER reg. 9 · DNV-ST-0378", checklist: ["SWL chart and markings legible", "Hook, sheaves and wire rope free of wear and damage", "Slew, luff and hoist brakes hold the load", "Heave compensation tested", "Overload protection and limits work", "Emergency stop works"] }],
  [/sling|shackle|lifting/i, { due: "Thorough examination due", document: "Report of thorough examination", reference: "LOLER reg. 9", checklist: ["Each item has its ID tag and SWL", "Slings free of cuts, broken wires and crushing", "Shackle pins and bodies free of wear, cracks and distortion", "Colour code matches the current period", "Quarantined items removed from the rack"] }],
  [/towing|tow wire/i, { due: "Towing gear survey due", document: "Towing gear survey record", reference: "Class towing gear survey", checklist: ["Hook releases under load and from the bridge", "Winch brake holds the rated pull", "Tow wire free of broken wires and kinks", "Fairleads and pins free of wear", "Emergency release tested"] }],
  [/manipulator|grabber/i, { due: "Service due", document: "Service record", reference: "OEM maintenance manual", checklist: ["All functions run through full range", "Jaw closes and holds; wrist rotates both ways", "No hydraulic leaks at the joints", "Compensator at the right level", "Master controller and feedback agree"] }],
  [/helmet|bandmask|diving|diver|cylinder|gas bank|chamber/i, { due: "Examination due", document: "Certificate of examination", reference: "IMCA D 018", checklist: ["Demand regulator and free-flow valve tested", "Neck dam, clamp and seals in good condition", "Communications and lights working", "Bailout and emergency gas valves checked", "Gas cylinders within their test date", "Umbilical and hoses pressure-tested"] }],
  [/rov|tms/i, { due: "ROV system inspection due", document: "ROV system inspection report", reference: "IMCA R 004 Rev 6 · R 006 Rev 3", checklist: ["Hydraulic power unit: pressure and oil level correct, no leaks", "Thrusters run in all axes", "Cameras, lights and pan-and-tilt working", "Line insulation monitor reads healthy", "High-voltage isolation and interlocks verified", "Frame, buoyancy and fasteners undamaged", "Tether and termination free of kinks and damage", "Emergency stop and fail-safes tested"] }],
];

const GENERAL: Obligation = { due: "Inspection due", document: "Inspection certificate", reference: "SAFEEN maintenance system", checklist: ["Identity and markings legible", "Free from visible damage or corrosion", "Certificate and documentation on board", "Stowage and sea-fastening acceptable"] };

// Crew tickets (BOSIET, H2S, medicals) are checked against the original, not inspected like equipment.
const CREW: Obligation = { due: "Certificate expiry", document: "Certificate check", reference: "Training provider certificate", checklist: ["Original certificate sighted", "Name and photo match the holder", "Issued by an accredited centre", "Expiry date entered correctly"] };

export function obligationFor(record: { assetType: string; recordType: "equipment" | "licence" }): Obligation {
  if (record.recordType === "licence") return CREW;
  return OBLIGATIONS.find(([pattern]) => pattern.test(record.assetType))?.[1] ?? GENERAL;
}

export const subseaChecklist = (record: { assetType: string; recordType: "equipment" | "licence" }) => obligationFor(record).checklist;
