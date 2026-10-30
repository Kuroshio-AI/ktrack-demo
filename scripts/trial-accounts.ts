// Makes trial accounts. Sign-up is off, so this is the only way in.
//
//   npx tsx scripts/trial-accounts.ts contextforclient/trial-accounts.json
//   npx wrangler d1 execute DB --remote --file .wrangler/trial-accounts.sql
//
// The JSON lists [{ "name", "email", "role", "customer"?, "password"? }]: role is Admin, Engineer (shown as Inspector), Reviewer,
// Manager or Customer, and a Customer account names its customer as typed on its jobs. Emails can be made up, since
// nothing is ever sent to them. Each run sets every listed account's password, the list's or a new random one (an
// existing account loses its sessions), and writes the passwords next to the JSON, which must be git-ignored: this repo is public.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { betterAuth } from "better-auth";
import { getMigrations } from "better-auth/db/migration";
import { ACCOUNT_ROLES, authOptions } from "../lib/auth";

type Account = { name: string; email: string; role: string; customer?: string; password?: string };

async function main() {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: npx tsx scripts/trial-accounts.ts <accounts.json>");
  const passwordsFile = input.replace(/\.json$/, "") + ".passwords.txt";
  for (const file of [input, passwordsFile]) {
    try { execFileSync("git", ["check-ignore", "-q", file]); } catch { throw new Error(`${file} isn't git-ignored. Keep account lists and passwords out of this public repo, in contextforclient/.`); }
  }
  const accounts = JSON.parse(readFileSync(input, "utf8")) as Account[];
  for (const account of accounts) {
    if (!account.name?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.email ?? "")) throw new Error(`Each account needs a name and an email: ${JSON.stringify(account)}`);
    if (!(ACCOUNT_ROLES as readonly string[]).includes(account.role)) throw new Error(`${account.email}: role must be one of ${ACCOUNT_ROLES.join(", ")}`);
    if (account.role === "Customer" && !account.customer?.trim()) throw new Error(`${account.email}: a Customer account needs "customer", as typed on its jobs`);
    if (account.password !== undefined && account.password.length < 12) throw new Error(`${account.email}: a password needs at least 12 characters`);
  }

  // Better Auth writes the rows into a throwaway SQLite database, so they come out exactly as it reads them back from D1.
  const db = new DatabaseSync(":memory:");
  const options = { ...authOptions(db), secret: randomBytes(32).toString("hex"), baseURL: "http://localhost" };
  await (await getMigrations(options)).runMigrations();
  const context = await betterAuth(options).$context;
  const passwords: string[] = [];
  for (const account of accounts) {
    const password = account.password ?? randomBytes(12).toString("base64url");
    const user = await context.internalAdapter.createUser({ name: account.name.trim(), email: account.email.trim().toLowerCase(), emailVerified: true, role: account.role, customer: account.role === "Customer" ? account.customer!.trim() : null }, { method: "admin" });
    await context.internalAdapter.linkAccount({ userId: user.id, providerId: "credential", accountId: user.id, password: await context.password.hash(password) });
    passwords.push(`${account.name}\t${account.role}${account.customer ? ` (${account.customer})` : ""}\t${user.email}\t${password}`);
  }

  const literal = (value: unknown) => value === null || value === undefined ? "NULL" : typeof value === "number" || typeof value === "bigint" ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
  const inserts = (table: string) => (db.prepare(`SELECT * FROM "${table}"`).all() as Record<string, unknown>[])
    .map((row) => `INSERT INTO "${table}" (${Object.keys(row).map((column) => `"${column}"`).join(", ")}) VALUES (${Object.values(row).map(literal).join(", ")});`);
  const sql = [
    ...accounts.map((account) => `DELETE FROM "user" WHERE "email" = ${literal(account.email.trim().toLowerCase())};`),
    ...inserts("user"),
    ...inserts("account"),
  ].join("\n");
  mkdirSync(".wrangler", { recursive: true });
  writeFileSync(".wrangler/trial-accounts.sql", sql + "\n");
  writeFileSync(passwordsFile, `Name\tRole\tEmail\tPassword\n${passwords.join("\n")}\n`);
  console.log(`${accounts.length} accounts written to .wrangler/trial-accounts.sql; passwords in ${passwordsFile}.`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
