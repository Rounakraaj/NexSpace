import assert from "node:assert/strict";
import test from "node:test";
import { createCollaborationTicket, verifyCollaborationTicket } from "../lib/collaboration-ticket.ts";
import { documentCreateSchema, documentUpdateSchema, editorContentSchema, invitationAcceptSchema, invitationCreateSchema, memberRoleSchema, registrationSchema, workspaceCreateSchema, workspaceUpdateSchema } from "../lib/validation.ts";

test("registration normalizes email and enforces a strong password shape", () => {
  const input = registrationSchema.parse({ name: " Ada ", email: " ADA@EXAMPLE.COM ", password: "Nexspace2026" });
  assert.equal(input.name, "Ada");
  assert.equal(input.email, "ada@example.com");
  assert.equal(registrationSchema.safeParse({ name: "A", email: "not-email", password: "short" }).success, false);
});

test("editor content allows safe links and rejects script and insecure image URLs", () => {
  assert.equal(editorContentSchema.safeParse({ type: "doc", content: [{ type: "text", text: "hello", marks: [{ type: "link", attrs: { href: "https://example.com" } }] }] }).success, true);
  assert.equal(editorContentSchema.safeParse({ type: "doc", content: [{ type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }] }).success, false);
  assert.equal(editorContentSchema.safeParse({ type: "doc", content: [{ type: "image", attrs: { src: "http://example.com/a.png" } }] }).success, false);
});

test("collaboration tickets are document-bound, signed, and expire", () => {
  const now = 1_800_000_000_000;
  const token = createCollaborationTicket({ sub: "user-1", documentId: "doc-1" }, "a-secret-that-is-long-enough-for-hmac", now);
  assert.deepEqual(verifyCollaborationTicket(token, "a-secret-that-is-long-enough-for-hmac", now), {
    sub: "user-1", documentId: "doc-1", exp: Math.floor(now / 1000) + 300,
  });
  assert.equal(verifyCollaborationTicket(`${token}tampered`, "a-secret-that-is-long-enough-for-hmac", now), null);
  assert.equal(verifyCollaborationTicket(token, "a-different-secret-that-is-long-enough", now), null);
  assert.equal(verifyCollaborationTicket(token, "a-secret-that-is-long-enough-for-hmac", now + 301_000), null);
});

test("invitations normalize email and restrict assignable workspace roles", () => {
  assert.deepEqual(invitationCreateSchema.parse({ email: " TEAM@EXAMPLE.COM ", role: "COMMENTER" }), { email: "team@example.com", role: "COMMENTER" });
  assert.equal(invitationCreateSchema.safeParse({ email: "bad", role: "OWNER" }).success, false);
  assert.equal(memberRoleSchema.safeParse({ role: "VIEWER" }).success, true);
  assert.equal(memberRoleSchema.safeParse({ role: "OWNER" }).success, false);
  assert.equal(invitationAcceptSchema.safeParse({ token: "short" }).success, false);
});

test("Yjs updates merge and survive a serialized reload", async () => {
  const Y = await import("yjs");
  const first = new Y.Doc();
  const second = new Y.Doc();
  first.getText("shared").insert(0, "Hello");
  second.getText("shared").insert(0, "World");
  Y.applyUpdate(first, Y.encodeStateAsUpdate(second));
  Y.applyUpdate(second, Y.encodeStateAsUpdate(first));
  assert.equal(first.getText("shared").toString(), second.getText("shared").toString());

  const restored = new Y.Doc();
  Y.applyUpdate(restored, Y.encodeStateAsUpdate(first));
  assert.equal(restored.getText("shared").toString(), first.getText("shared").toString());
});

test("workspace names are trimmed and bounded", () => {
  assert.equal(workspaceCreateSchema.parse({ name: "  Studio  " }).name, "Studio");
  assert.equal(workspaceCreateSchema.safeParse({ name: "  " }).success, false);
  assert.equal(workspaceCreateSchema.safeParse({ name: "x".repeat(81) }).success, false);
});

test("workspace update requires at least one accepted change", () => {
  assert.equal(workspaceUpdateSchema.safeParse({}).success, false);
  assert.equal(workspaceUpdateSchema.safeParse({ description: null }).success, true);
});

test("document create requires a UUID workspace and bounded title", () => {
  const workspaceId = "00000000-0000-4000-8000-000000000001";
  assert.equal(documentCreateSchema.parse({ title: " Notes ", workspaceId }).title, "Notes");
  assert.equal(documentCreateSchema.safeParse({ title: "Notes", workspaceId: "not-a-uuid" }).success, false);
  assert.equal(documentCreateSchema.safeParse({ title: "", workspaceId }).success, false);
});

test("document update rejects empty and mistyped changes", () => {
  assert.equal(documentUpdateSchema.safeParse({}).success, false);
  assert.equal(documentUpdateSchema.safeParse({ favorite: "yes" }).success, false);
  assert.equal(documentUpdateSchema.safeParse({ favorite: true }).success, true);
});
