-- The Al Mansoori trial's database (D1). Applied with: npx wrangler d1 migrations apply DB --local or --remote

-- Better Auth's tables, generated from lib/auth.ts by better-auth/db/migration.
create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "role" text not null, "customer" text);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "rateLimit" ("id" text not null primary key, "key" text not null unique, "count" integer not null, "lastRequest" bigint not null);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");

-- Shared records (app/api/sync): one row per job, tally sheet, dimension table row, instrument, damage criterion and
-- audit entry. data is the item as the app keeps it, null once removed. version goes up on every change, and a change is
-- taken only from the version it was based on. seq orders every change across rows, so a laptop asks for what is newer
-- than the last it saw. customer is the lower-case customer name on jobs and their tally sheets.
create table "item" ("kind" text not null, "id" text not null, "data" text, "version" integer not null, "seq" integer not null, "customer" text, "updatedBy" text not null, "updatedAt" text not null, primary key ("kind", "id"));

create index "item_seq_idx" on "item" ("seq");

create index "item_customer_idx" on "item" ("customer", "seq");
