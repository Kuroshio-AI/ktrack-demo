import { betterAuth, type BetterAuthOptions } from "better-auth";
import { getCloudflareContext } from "@opennextjs/cloudflare";

// Trial sign-in: email and password accounts made by scripts/trial-accounts.mjs, never by signing up. Each account has
// one role; a Customer account also names the customer (a job's Customer field) whose records it may read.
export const ACCOUNT_ROLES = ["Admin", "Engineer", "Reviewer", "Manager", "Customer"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

export const authOptions = (database: BetterAuthOptions["database"]) => ({
  database,
  emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12 },
  user: { additionalFields: { role: { type: "string", required: true, input: false }, customer: { type: "string", required: false, input: false } } },
  // Inspectors work offline for days, so a session lasts 30 days and renews while in use.
  session: { expiresIn: 60 * 60 * 24 * 30, updateAge: 60 * 60 * 24 },
  // Counted in D1, so every worker instance sees the same sign-in attempts.
  rateLimit: { enabled: true, storage: "database" },
}) satisfies BetterAuthOptions;

let auth: ReturnType<typeof create> | undefined;
const create = () => betterAuth(authOptions(getCloudflareContext().env.DB));
// One instance per worker instance; BETTER_AUTH_SECRET and BETTER_AUTH_URL come from the worker's secrets and vars.
export const getAuth = () => (auth ??= create());

export type SessionUser = { id: string; name: string; email: string; role: AccountRole; customer?: string | null };
export async function sessionUser(request: Request): Promise<SessionUser | undefined> {
  const session = await getAuth().api.getSession({ headers: request.headers });
  const user = session?.user as SessionUser | undefined;
  return user && (ACCOUNT_ROLES as readonly string[]).includes(user.role) ? user : undefined;
}
