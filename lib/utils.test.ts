import assert from "node:assert/strict";
import test from "node:test";
import { formatDate, formatDateTime, formatLocalDate, readablePassword } from "./utils";

test("dates read the way people write them, timestamps in local time", () => {
  process.env.TZ = "Asia/Kolkata";
  assert.equal(formatDate("2026-09-28"), "28 Sep 2026");
  assert.equal(formatDate("2027-01-05"), "5 Jan 2027");
  assert.equal(formatDateTime("2026-09-28T11:30:00.000Z"), "28 Sep 2026, 17:00");
  assert.equal(formatLocalDate("2026-09-28T20:00:00.000Z"), "29 Sep 2026");
});

test("a new password reads clearly and is never the same twice", () => {
  const password = readablePassword();
  assert.match(password, /^[a-hjkmnp-z2-9]{4}(-[a-hjkmnp-z2-9]{4}){3}$/);
  assert.notEqual(readablePassword(), password);
});
