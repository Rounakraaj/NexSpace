import assert from "node:assert/strict";
import test from "node:test";
import { canComment, canEditDocument, canManageWorkspace, canReadWorkspace } from "../lib/role-policy.ts";

test("owner has full workspace permissions", () => {
  assert.equal(canReadWorkspace("OWNER"), true);
  assert.equal(canManageWorkspace("OWNER"), true);
  assert.equal(canEditDocument("OWNER"), true);
  assert.equal(canComment("OWNER"), true);
});

test("editor can edit and comment but cannot manage the workspace", () => {
  assert.equal(canReadWorkspace("EDITOR"), true);
  assert.equal(canManageWorkspace("EDITOR"), false);
  assert.equal(canEditDocument("EDITOR"), true);
  assert.equal(canComment("EDITOR"), true);
});

test("commenter can read and comment but cannot edit", () => {
  assert.equal(canReadWorkspace("COMMENTER"), true);
  assert.equal(canManageWorkspace("COMMENTER"), false);
  assert.equal(canEditDocument("COMMENTER"), false);
  assert.equal(canComment("COMMENTER"), true);
});

test("viewer can only read", () => {
  assert.equal(canReadWorkspace("VIEWER"), true);
  assert.equal(canManageWorkspace("VIEWER"), false);
  assert.equal(canEditDocument("VIEWER"), false);
  assert.equal(canComment("VIEWER"), false);
});

test("missing role is denied", () => {
  assert.equal(canReadWorkspace(null), false);
  assert.equal(canManageWorkspace(undefined), false);
  assert.equal(canEditDocument(null), false);
  assert.equal(canComment(undefined), false);
});
