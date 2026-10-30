// Loads the client's dimension tables into the trial database, so the first sign-in finds them already imported.
//
//   npx tsx scripts/trial-seed.ts contextforclient/al-mansoori/connections.xlsx contextforclient/al-mansoori/rp7g2.xlsx
//   npx wrangler d1 execute DB --remote --file .wrangler/trial-seed.sql
//
// The spreadsheets are read with the Connections page's own importer, in the order given. DS-1 and API RP 7G-2 values are
// licensed: they go only into the trial's database, never into this public repo or the app's code, so the SQL is written
// to .wrangler/ (git-ignored). Each row's id comes from its size, weight, connection and grade, so running it again adds
// only rows that are new and never duplicates or overwrites one a laptop has already changed.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { importConnections, parseConnectionsWorkbook } from "../lib/ams";
import { createInitialState } from "../lib/domain";

const files = process.argv.slice(2);
if (!files.length) throw new Error("Usage: npx tsx scripts/trial-seed.ts <dimension table.xlsx> [more.xlsx]");
let state = createInitialState();
for (const file of files) {
  const bytes = readFileSync(file);
  const { specs, errors } = parseConnectionsWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
  if (errors.length) throw new Error(`${file}: ${errors.length} rows didn't import, first: row ${errors[0].row} ${errors[0].message}`);
  state = importConnections(state, specs, "Admin");
  console.log(`${file}: ${specs.length} rows`);
}

const literal = (value: string) => `'${value.replaceAll("'", "''")}'`;
const now = new Date().toISOString();
const rows = (state.connections ?? []).map((spec) => {
  const id = `conn-${createHash("sha256").update([spec.size, spec.weight, spec.connection, spec.grade].join("|").toLowerCase()).digest("hex").slice(0, 16)}`;
  return `INSERT INTO item (kind, id, data, version, seq, customer, updatedBy, updatedAt) VALUES ('connection', ${literal(id)}, ${literal(JSON.stringify({ ...spec, id }))}, 1, (SELECT coalesce(max(seq), 0) + 1 FROM item), NULL, 'Pre-import', ${literal(now)}) ON CONFLICT DO NOTHING;`;
});
mkdirSync(".wrangler", { recursive: true });
writeFileSync(".wrangler/trial-seed.sql", rows.join("\n") + "\n");
console.log(`${rows.length} dimension table rows written to .wrangler/trial-seed.sql`);
