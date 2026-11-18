import assert from "node:assert/strict";
import test from "node:test";
import { OutgoingMessage } from "@hocuspocus/server";
import * as Y from "yjs";
import { applyRichTextReplacement, DocumentLocks, getYjsUpdateFromHocuspocusMessage, mergeYjsUpdates } from "../collaboration/rich-text-state.ts";

function updateMessage(documentId: string, update: Uint8Array) {
  return new OutgoingMessage(documentId).createSyncMessage().writeUpdate(update).toUint8Array();
}

function textUpdate(text: string) {
  const document = new Y.Doc();
  document.getText("shared").insert(0, text);
  const update = Y.encodeStateAsUpdate(document);
  document.destroy();
  return update;
}

function xmlUpdate(text: string) {
  const document = new Y.Doc();
  const paragraph = new Y.XmlElement("paragraph");
  const content = new Y.XmlText();
  content.insert(0, text);
  paragraph.insert(0, [content]);
  document.getXmlFragment("default").insert(0, [paragraph]);
  const update = Y.encodeStateAsUpdate(document);
  document.destroy();
  return update;
}

test("concurrent Yjs updates are parsed and merged without losing either user", () => {
  const first = textUpdate("first");
  const second = textUpdate("second");
  const parsed = getYjsUpdateFromHocuspocusMessage(updateMessage("page-1", first));
  assert.ok(parsed);

  const merged = new Y.Doc();
  Y.applyUpdate(merged, mergeYjsUpdates([parsed, second]));
  assert.equal(merged.getText("shared").toString().length, "first".length + "second".length);
  merged.destroy();
});

test("persisted Yjs state restores into a new collaboration document", () => {
  const before = textUpdate("saved ");
  const after = textUpdate("state");
  const persisted = mergeYjsUpdates([before, after]);
  const restored = new Y.Doc();
  Y.applyUpdate(restored, persisted);
  assert.equal(restored.getText("shared").toString().length, 11);
  restored.destroy();
});

test("JSON replacement updates an active Y.Doc through a Yjs delete and insert", () => {
  const active = new Y.Doc();
  Y.applyUpdate(active, xmlUpdate("old content"));
  applyRichTextReplacement(active, xmlUpdate("new content"));
  assert.equal(active.getXmlFragment("default").toString(), "<paragraph>new content</paragraph>");
  active.destroy();
});

test("snapshot restoration propagates to an already connected Y.Doc", () => {
  const active = new Y.Doc();
  const peer = new Y.Doc();
  Y.applyUpdate(active, xmlUpdate("current"));
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(active));

  const beforeRestore = Y.encodeStateVector(peer);
  applyRichTextReplacement(active, xmlUpdate("restored snapshot"));
  Y.applyUpdate(peer, Y.encodeStateAsUpdate(active, beforeRestore));

  assert.equal(peer.getXmlFragment("default").toString(), "<paragraph>restored snapshot</paragraph>");
  active.destroy();
  peer.destroy();
});

test("offline Yjs edits merge with updates made before reconnection", () => {
  const offline = new Y.Doc();
  const remote = new Y.Doc();
  offline.getText("shared").insert(0, "offline");
  remote.getText("shared").insert(0, "remote");

  const reconnectedState = mergeYjsUpdates([
    Y.encodeStateAsUpdate(offline),
    Y.encodeStateAsUpdate(remote),
  ]);
  Y.applyUpdate(offline, reconnectedState);
  Y.applyUpdate(remote, reconnectedState);
  assert.equal(offline.getText("shared").toString(), remote.getText("shared").toString());
  assert.equal(offline.getText("shared").toString().length, 13);
  offline.destroy();
  remote.destroy();
});

test("a delayed older persistence operation cannot replace newer Yjs state", async () => {
  const locks = new DocumentLocks();
  const older = textUpdate("older");
  const newer = textUpdate("newer");
  let stored = mergeYjsUpdates([]);

  await Promise.all([
    locks.runExclusive("page-1", async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      stored = mergeYjsUpdates([stored, older]);
    }),
    locks.runExclusive("page-1", async () => {
      stored = mergeYjsUpdates([stored, newer]);
    }),
  ]);

  const restored = new Y.Doc();
  Y.applyUpdate(restored, stored);
  assert.equal(restored.getText("shared").toString().length, 10);
  restored.destroy();
});

test("document deletion waits for an in-flight collaboration write", async () => {
  const locks = new DocumentLocks();
  let persisted = false;
  const write = locks.runExclusive("page-1", async () => {
    await new Promise((resolve) => setTimeout(resolve, 15));
    persisted = true;
  });
  const deletion = locks.runExclusive("page-1", async () => {
    assert.equal(persisted, true);
  });
  await Promise.all([write, deletion]);
  assert.equal(persisted, true);
});
