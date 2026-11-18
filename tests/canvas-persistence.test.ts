import assert from "node:assert/strict";
import test from "node:test";
import {
  TLSocketRoom,
  type RoomSnapshot,
  type WebSocketMinimal,
} from "@tldraw/sync-core";
import { createTLSchema, toRichText, type TLGeoShape, type TLRecord } from "@tldraw/tlschema";
import { canEditDocument } from "../lib/role-policy.ts";
import {
  CanvasRoomError,
  CanvasRoomManager,
  resolveCanvasRole,
  type CanvasRoomRepository,
  type CanvasSnapshotResult,
} from "../collaboration/canvas-room-manager.ts";

type TestDocument = { content: RoomSnapshot | null; version: number };
type TestSnapshot = CanvasSnapshotResult & { documentId: string; content: RoomSnapshot };

class MemoryCanvasRepository implements CanvasRoomRepository {
  readonly documents = new Map<string, TestDocument>();
  readonly snapshots = new Map<string, TestSnapshot>();
  snapshotDelay: Promise<void> | null = null;
  private nextSnapshotId = 1;

  async load(documentId: string) {
    const document = this.documents.get(documentId);
    return document ? structuredClone({ content: document.content, version: document.version }) : null;
  }

  async persist(documentId: string, snapshot: RoomSnapshot, version: number) {
    const document = this.getExpectedDocument(documentId, version);
    document.content = structuredClone(snapshot);
    return ++document.version;
  }

  async createSnapshot(documentId: string, userId: string, label: string, snapshot: RoomSnapshot, version: number) {
    const document = this.getExpectedDocument(documentId, version);
    if (this.snapshotDelay) await this.snapshotDelay;
    document.content = structuredClone(snapshot);
    const created = this.addSnapshot(documentId, label, snapshot);
    return { snapshot: created, version: ++document.version };
  }

  async restoreSnapshot(documentId: string, snapshotId: string, userId: string, current: RoomSnapshot, version: number) {
    const document = this.getExpectedDocument(documentId, version);
    const snapshot = this.snapshots.get(snapshotId);
    if (!snapshot || snapshot.documentId !== documentId) throw new CanvasRoomError("Snapshot not found.", 404);
    this.addSnapshot(documentId, "Before restore", current);
    document.content = structuredClone(snapshot.content);
    document.version++;
    return {
      snapshot: structuredClone(snapshot.content),
      result: { restoredSnapshotId: snapshot.id, label: snapshot.label },
      version: document.version,
    };
  }

  async deleteDocument(documentId: string) {
    if (!this.documents.delete(documentId)) throw new CanvasRoomError("Canvas document not found.", 404);
  }

  seedSnapshot(documentId: string, label: string, snapshot: RoomSnapshot) {
    return this.addSnapshot(documentId, label, snapshot);
  }

  private getExpectedDocument(documentId: string, version: number) {
    const document = this.documents.get(documentId);
    if (!document) throw new CanvasRoomError("Canvas document not found.", 404);
    if (document.version !== version) throw new CanvasRoomError("Canvas version conflict.", 409);
    return document;
  }

  private addSnapshot(documentId: string, label: string, content: RoomSnapshot) {
    const snapshot = {
      id: `00000000-0000-4000-8000-${String(this.nextSnapshotId++).padStart(12, "0")}`,
      label,
      createdAt: new Date().toISOString(),
      documentId,
      content: structuredClone(content),
    };
    this.snapshots.set(snapshot.id, snapshot);
    return { id: snapshot.id, label: snapshot.label, createdAt: snapshot.createdAt };
  }
}

class MockSocket implements WebSocketMinimal {
  readonly messages: string[] = [];
  readyState = 1;
  send(message: string) { this.messages.push(message); }
  close() { this.readyState = 3; }
  addEventListener() {}
  removeEventListener() {}
}

const schema = createTLSchema();

function shape(id: string, label: string): TLGeoShape {
  return {
    id: `shape:${id}` as TLGeoShape["id"],
    typeName: "shape",
    type: "geo",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a1" as TLGeoShape["index"],
    parentId: "page:page" as TLGeoShape["parentId"],
    isLocked: false,
    opacity: 1,
    meta: {},
    props: {
      geo: "rectangle",
      dash: "solid",
      url: "",
      w: 100,
      h: 100,
      growY: 0,
      scale: 1,
      flipX: false,
      flipY: false,
      labelColor: "black",
      color: "black",
      fill: "solid",
      size: "m",
      font: "draw",
      align: "middle",
      verticalAlign: "middle",
      richText: toRichText(label),
    },
  };
}

function connect(room: TLSocketRoom<TLRecord>, sessionId: string, socket: MockSocket, isReadonly = false) {
  room.handleSocketConnect({ sessionId, socket, isReadonly });
  room.handleSocketMessage(sessionId, JSON.stringify({
    type: "connect",
    connectRequestId: `connect-${sessionId}`,
    lastServerClock: 0,
    protocolVersion: 8,
    schema: schema.serialize(),
  }));
}

function pushShape(room: TLSocketRoom<TLRecord>, sessionId: string, record: TLGeoShape, clientClock: number) {
  room.handleSocketMessage(sessionId, JSON.stringify({
    type: "push",
    clientClock,
    diff: { [record.id]: ["put", record] },
  }));
}

async function snapshotWithShape(record: TLGeoShape): Promise<RoomSnapshot> {
  const room = new TLSocketRoom<TLRecord>({ schema });
  await room.updateStore((store) => store.put(record));
  const snapshot = room.getCurrentSnapshot();
  room.close();
  return snapshot;
}

function managerFor(repository: MemoryCanvasRepository, id = "canvas-1") {
  repository.documents.set(id, { content: null, version: 0 });
  return new CanvasRoomManager(repository, { persistDelayMs: 60_000, idleCloseDelayMs: 60_000 });
}

test("two connected users' concurrent Canvas edits converge in the shared room", async () => {
  const repository = new MemoryCanvasRepository();
  const manager = managerFor(repository);
  const entry = await manager.getOrCreateRoom("canvas-1");
  const firstSocket = new MockSocket();
  const secondSocket = new MockSocket();
  connect(entry.room, "user-a:tab-a", firstSocket);
  connect(entry.room, "user-b:tab-b", secondSocket);

  try {
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(entry.room.getSessions().filter(({ isConnected }) => isConnected).length, 2);
    const firstShape = shape("from-a", "A");
    const secondShape = shape("from-b", "B");
    pushShape(entry.room, "user-a:tab-a", firstShape, 1);
    pushShape(entry.room, "user-b:tab-b", secondShape, 1);
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.equal(entry.room.getRecord(firstShape.id)?.id, firstShape.id);
    assert.equal(entry.room.getRecord(secondShape.id)?.id, secondShape.id);
    assert.ok(secondSocket.messages.some((message) => message.includes(firstShape.id)));
  } finally {
    await manager.closeAll();
  }
});

test("Canvas persistence survives a client refresh and a clean server restart", async () => {
  const repository = new MemoryCanvasRepository();
  const manager = managerFor(repository);
  const entry = await manager.getOrCreateRoom("canvas-1");
  const record = shape("saved", "Persisted");
  await entry.room.updateStore((store) => store.put(record));
  await manager.flush("canvas-1");

  const refreshedSocket = new MockSocket();
  connect(entry.room, "user-a:refreshed-tab", refreshedSocket);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(refreshedSocket.messages.some((message) => message.includes(record.id)));
  await manager.closeAll();

  const restartedManager = new CanvasRoomManager(repository);
  const recoveredRoom = await restartedManager.getOrCreateRoom("canvas-1");
  assert.equal(recoveredRoom.room.getRecord(record.id)?.id, record.id);
  await restartedManager.closeAll();
});

test("a stale room snapshot cannot overwrite a newer persisted Canvas revision", async () => {
  const repository = new MemoryCanvasRepository();
  const manager = managerFor(repository);
  const staleManager = new CanvasRoomManager(repository);
  const currentRoom = await manager.getOrCreateRoom("canvas-1");
  const staleRoom = await staleManager.getOrCreateRoom("canvas-1");
  const newer = shape("newer-revision", "Newer");
  await currentRoom.room.updateStore((store) => store.put(newer));
  await manager.flush("canvas-1");
  const persisted = structuredClone(repository.documents.get("canvas-1")?.content);

  const older = shape("older-revision", "Older");
  await staleRoom.room.updateStore((store) => store.put(older));
  await assert.rejects(staleManager.flush("canvas-1"), /version conflict/);
  assert.deepEqual(repository.documents.get("canvas-1")?.content, persisted);

  if (staleRoom.timer) clearTimeout(staleRoom.timer);
  staleRoom.room.close();
  await manager.closeAll();
});

test("restoring a snapshot updates the room and both connected users", async () => {
  const repository = new MemoryCanvasRepository();
  const manager = managerFor(repository);
  const entry = await manager.getOrCreateRoom("canvas-1");
  const currentShape = shape("current", "Current");
  await entry.room.updateStore((store) => store.put(currentShape));
  const targetShape = shape("restored", "Restored");
  const target = repository.seedSnapshot("canvas-1", "Earlier version", await snapshotWithShape(targetShape));
  const firstSocket = new MockSocket();
  const secondSocket = new MockSocket();
  connect(entry.room, "user-a:tab-a", firstSocket);
  connect(entry.room, "user-b:tab-b", secondSocket);
  firstSocket.messages.length = 0;
  secondSocket.messages.length = 0;

  const result = await manager.restoreSnapshot("canvas-1", target.id, "editor-a");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(result.restoredSnapshotId, target.id);
  assert.equal(entry.room.getNumActiveSessions(), 2);
  assert.equal(entry.room.getRecord(targetShape.id)?.id, targetShape.id);
  assert.equal(entry.room.getRecord(currentShape.id), undefined);
  assert.ok(firstSocket.messages.some((message) => message.includes(targetShape.id)));
  assert.ok(secondSocket.messages.some((message) => message.includes(targetShape.id)));
  assert.equal(repository.documents.get("canvas-1")?.content?.documents.some(({ state }) => state.id === targetShape.id), true);
  await manager.closeAll();
});

test("a concurrent Canvas update is persisted after a manual snapshot without changing its contents", async () => {
  const repository = new MemoryCanvasRepository();
  const manager = managerFor(repository);
  const entry = await manager.getOrCreateRoom("canvas-1");
  const before = shape("before-snapshot", "Before");
  await entry.room.updateStore((store) => store.put(before));
  let releaseSnapshot!: () => void;
  repository.snapshotDelay = new Promise<void>((resolve) => { releaseSnapshot = resolve; });

  const pendingSnapshot = manager.createSnapshot("canvas-1", "editor-a", "Concurrent update");
  await new Promise((resolve) => setTimeout(resolve, 0));
  const concurrent = shape("during-snapshot", "During");
  await entry.room.updateStore((store) => store.put(concurrent));
  releaseSnapshot();
  const created = await pendingSnapshot;
  await manager.flush("canvas-1");

  const savedSnapshot = repository.snapshots.get(created.id);
  assert.ok(savedSnapshot);
  assert.equal(savedSnapshot.content.documents.some(({ state }) => state.id === concurrent.id), false);
  assert.equal(repository.documents.get("canvas-1")?.content?.documents.some(({ state }) => state.id === concurrent.id), true);
  await manager.closeAll();
});

test("deleting an active Canvas room closes sessions and pending saves cannot recreate its row", async () => {
  const repository = new MemoryCanvasRepository();
  const manager = managerFor(repository);
  const entry = await manager.getOrCreateRoom("canvas-1");
  const socket = new MockSocket();
  connect(entry.room, "user-a:tab-a", socket);
  const record = shape("before-delete", "Pending");
  await entry.room.updateStore((store) => store.put(record));

  await manager.deleteDocument("canvas-1", "owner");
  assert.equal(repository.documents.has("canvas-1"), false);
  assert.equal(entry.room.isClosed(), true);
  assert.equal(socket.readyState, 3);
  await assert.rejects(manager.getOrCreateRoom("canvas-1"), /not found/);
  await manager.closeAll();
});

test("unauthorized roles cannot edit and read-only sessions cannot push Canvas changes", async () => {
  assert.equal(resolveCanvasRole("owner", "outsider"), null);
  assert.equal(resolveCanvasRole("owner", "viewer", "VIEWER"), "VIEWER");
  assert.equal(canEditDocument("VIEWER"), false);
  assert.equal(canEditDocument("COMMENTER"), false);
  assert.equal(canEditDocument(null), false);

  const room = new TLSocketRoom<TLRecord>({ schema });
  const socket = new MockSocket();
  connect(room, "viewer:tab", socket, true);
  const deniedShape = shape("readonly", "Not allowed");
  pushShape(room, "viewer:tab", deniedShape, 1);
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(room.getRecord(deniedShape.id), undefined);
  assert.equal(JSON.parse(socket.messages[0] ?? "{}").isReadonly, true);
  room.close();
});
