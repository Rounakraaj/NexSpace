import assert from "node:assert/strict";
import test from "node:test";
import { hashPassword, verifyPassword } from "../lib/password.ts";

test("registration password hashes can be verified by the credentials login format", async () => {
  const password = "Nexspace2026";
  const encoded = await hashPassword(password);

  assert.match(encoded, /^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/);
  assert.equal(await verifyPassword(password, encoded), true);
  assert.equal(await verifyPassword("incorrect", encoded), false);
});

test("password verification rejects malformed stored hashes", async () => {
  assert.equal(await verifyPassword("Nexspace2026", "scrypt:broken:not-hex"), false);
  assert.equal(await verifyPassword("Nexspace2026", "bcrypt:00:00"), false);
});
