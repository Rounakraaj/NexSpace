import { InMemorySyncStorage, TLSocketRoom, type RoomSnapshot } from "@tldraw/sync-core";
import { createTLSchema, type TLRecord } from "@tldraw/tlschema";

export type PersistedCanvas = { content: unknown | null; version: number };
export type CanvasSnapshotResult = { id: string; label: string | null; createdAt: string };
export type CanvasRestoreResult = { restoredSnapshotId: string; label: string | null };
export type CanvasRole = "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";

export function resolveCanvasRole(ownerId: string, userId: string, memberRole?: CanvasRole | null): CanvasRole | null {
  if (ownerId === userId) return "OWNER";
  return memberRole ?? null;
}

export interface CanvasRoomRepository {
  load(documentId: string): Promise<PersistedCanvas | null>;
  persist(documentId: string, snapshot: RoomSnapshot, version: number): Promise<number>;
  createSnapshot(
    documentId: string,
    userId: string,
    label: string,
    snapshot: RoomSnapshot,
    version: number,
  ): Promise<{ snapshot: CanvasSnapshotResult; version: number }>;
  restoreSnapshot(
    documentId: string,
    snapshotId: string,
    userId: string,
    current: RoomSnapshot,
    version: number,
  ): Promise<{ snapshot: RoomSnapshot; result: CanvasRestoreResult; version: number }>;
  deleteDocument(documentId: string, userId: string): Promise<void>;
}

export type CanvasRoomEntry = {
  room: TLSocketRoom<TLRecord>;
  timer: NodeJS.Timeout | null;
  closeTimer: NodeJS.Timeout | null;
  queue: Promise<void>;
  version: number;
  evictionGeneration: number;
  deleting: boolean;
};

export class CanvasRoomError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "CanvasRoomError";
    this.status = status;
  }
}

const schema = createTLSchema();

export function isRoomSnapshot(value: unknown): value is RoomSnapshot {
  return Boolean(
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    "documents" in value &&
    Array.isArray(value.documents) &&
    "schema" in value &&
    value.schema &&
    typeof value.schema === "object",
  );
}

export function assertValidCanvasSnapshot(value: unknown): asserts value is RoomSnapshot {
  if (!isRoomSnapshot(value)) {
    throw new CanvasRoomError("Canvas snapshot is invalid.", 400);
  }
  const validationRoom = new TLSocketRoom<TLRecord>({
    storage: new InMemorySyncStorage<TLRecord>({ snapshot: value }),
    schema,
  });
  validationRoom.close();
}

export class CanvasRoomManager {
  private readonly rooms = new Map<string, Promise<CanvasRoomEntry>>();
  private readonly deletingDocuments = new Set<string>();
  private readonly repository: CanvasRoomRepository;
  private readonly options: { persistDelayMs?: number; idleCloseDelayMs?: number };
  private closed = false;

  constructor(
    repository: CanvasRoomRepository,
    options: { persistDelayMs?: number; idleCloseDelayMs?: number } = {},
  ) {
    this.repository = repository;
    this.options = options;
  }

  isDeleting(documentId: string) {
    return this.deletingDocuments.has(documentId);
  }

  async getOrCreateRoom(documentId: string): Promise<CanvasRoomEntry> {
    if (this.closed) throw new CanvasRoomError("Canvas service is shutting down.", 503);
    if (this.isDeleting(documentId)) throw new CanvasRoomError("Canvas document is being deleted.", 404);
    const cached = this.rooms.get(documentId);
    if (cached) return cached;

    const pending = (async () => {
      const stored = await this.repository.load(documentId);
      if (!stored) throw new CanvasRoomError("Canvas document not found.", 404);
      if (this.closed) throw new CanvasRoomError("Canvas service is shutting down.", 503);
      if (this.isDeleting(documentId)) throw new CanvasRoomError("Canvas document is being deleted.", 404);

      let snapshot: RoomSnapshot | undefined;
      if (stored.content !== null) {
        assertValidCanvasSnapshot(stored.content);
        snapshot = stored.content;
      }

      const entry: CanvasRoomEntry = {
        room: null as unknown as TLSocketRoom<TLRecord>,
        timer: null,
        closeTimer: null,
        queue: Promise.resolve(),
        version: stored.version,
        evictionGeneration: 0,
        deleting: false,
      };
      const storage = new InMemorySyncStorage<TLRecord>({
        ...(snapshot ? { snapshot } : {}),
      });
      entry.room = new TLSocketRoom<TLRecord>({
        storage,
        schema,
        onDataChange: () => this.schedulePersist(documentId, entry),
        onSessionRemoved: (_room, { numSessionsRemaining }) => {
          if (numSessionsRemaining !== 0 || entry.deleting || this.isDeleting(documentId)) return;
          this.scheduleClose(documentId, entry);
        },
      });
      return entry;
    })();

    this.rooms.set(documentId, pending);
    try {
      return await pending;
    } catch (error) {
      if (this.rooms.get(documentId) === pending) this.rooms.delete(documentId);
      throw error;
    }
  }

  retain(entry: CanvasRoomEntry) {
    entry.evictionGeneration++;
    if (entry.closeTimer) clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
  }

  async flush(documentId: string) {
    const entry = await this.getOrCreateRoom(documentId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    await this.enqueue(entry, async () => {
      if (entry.deleting || this.isDeleting(documentId)) {
        throw new CanvasRoomError("Canvas document is being deleted.", 404);
      }
      entry.version = await this.repository.persist(documentId, entry.room.getCurrentSnapshot(), entry.version);
    });
  }

  async createSnapshot(documentId: string, userId: string, label: string) {
    const entry = await this.getOrCreateRoom(documentId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    return this.enqueue(entry, async () => {
      if (entry.deleting || this.isDeleting(documentId)) {
        throw new CanvasRoomError("Canvas document is being deleted.", 404);
      }
      const result = await this.repository.createSnapshot(
        documentId,
        userId,
        label,
        entry.room.getCurrentSnapshot(),
        entry.version,
      );
      entry.version = result.version;
      return result.snapshot;
    });
  }

  async restoreSnapshot(documentId: string, snapshotId: string, userId: string) {
    const entry = await this.getOrCreateRoom(documentId);
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = null;
    return this.enqueue(entry, async () => {
      if (entry.deleting || this.isDeleting(documentId)) {
        throw new CanvasRoomError("Canvas document is being deleted.", 404);
      }
      const result = await this.repository.restoreSnapshot(
        documentId,
        snapshotId,
        userId,
        entry.room.getCurrentSnapshot(),
        entry.version,
      );
      assertValidCanvasSnapshot(result.snapshot);
      entry.room.loadSnapshot(result.snapshot);
      entry.version = result.version;
      return result.result;
    });
  }

  async deleteDocument(documentId: string, userId: string) {
    if (this.deletingDocuments.has(documentId)) {
      throw new CanvasRoomError("Canvas document deletion is already in progress.", 409);
    }
    this.deletingDocuments.add(documentId);
    let entry: CanvasRoomEntry | undefined;
    try {
      const pending = this.rooms.get(documentId);
      if (pending) {
        try {
          entry = await pending;
        } catch (error) {
          if (!this.isDeleting(documentId)) throw error;
        }
      }
      if (entry) {
        entry.deleting = true;
        entry.evictionGeneration++;
        if (entry.timer) clearTimeout(entry.timer);
        if (entry.closeTimer) clearTimeout(entry.closeTimer);
        entry.timer = null;
        entry.closeTimer = null;
        entry.room.close();
        await entry.queue;
      }
      await this.repository.deleteDocument(documentId, userId);
      if (this.rooms.get(documentId) && entry) {
        const current = this.rooms.get(documentId);
        if (current && await current === entry) this.rooms.delete(documentId);
      }
    } catch (error) {
      if (entry) {
        entry.room.close();
        const current = this.rooms.get(documentId);
        if (current && await current === entry) this.rooms.delete(documentId);
      }
      throw error;
    } finally {
      this.deletingDocuments.delete(documentId);
    }
  }

  async closeAll() {
    this.closed = true;
    await Promise.all([...this.rooms.entries()].map(async ([documentId, pending]) => {
      const entry = await pending;
      if (entry.timer) clearTimeout(entry.timer);
      if (entry.closeTimer) clearTimeout(entry.closeTimer);
      entry.timer = null;
      entry.closeTimer = null;
      entry.room.close();
      await this.enqueue(entry, async () => {
        if (!entry.deleting && !this.isDeleting(documentId)) {
          entry.version = await this.repository.persist(documentId, entry.room.getCurrentSnapshot(), entry.version);
        }
      });
    }));
    this.rooms.clear();
  }

  private schedulePersist(documentId: string, entry: CanvasRoomEntry) {
    if (this.closed || entry.deleting || this.isDeleting(documentId)) return;
    if (entry.timer) clearTimeout(entry.timer);
    entry.timer = setTimeout(() => {
      entry.timer = null;
      void this.enqueue(entry, async () => {
        if (entry.deleting || this.isDeleting(documentId)) return;
        entry.version = await this.repository.persist(documentId, entry.room.getCurrentSnapshot(), entry.version);
      }).catch((error: unknown) => {
        console.error("Could not persist canvas snapshot", error);
      });
    }, this.options.persistDelayMs ?? 250);
    entry.timer.unref();
  }

  private scheduleClose(documentId: string, entry: CanvasRoomEntry) {
    if (this.closed || entry.deleting || this.isDeleting(documentId)) return;
    if (entry.closeTimer) clearTimeout(entry.closeTimer);
    const generation = ++entry.evictionGeneration;
    entry.closeTimer = setTimeout(() => {
      entry.closeTimer = null;
      if (entry.room.getNumActiveSessions() !== 0 || generation !== entry.evictionGeneration) return;
      if (entry.timer) clearTimeout(entry.timer);
      entry.timer = null;
      void this.enqueue(entry, async () => {
        if (entry.room.getNumActiveSessions() !== 0 || generation !== entry.evictionGeneration) return;
        entry.version = await this.repository.persist(documentId, entry.room.getCurrentSnapshot(), entry.version);
        if (entry.room.getNumActiveSessions() !== 0 || generation !== entry.evictionGeneration) return;
        entry.room.close();
        const current = this.rooms.get(documentId);
        if (current && await current === entry) this.rooms.delete(documentId);
      }).catch((error: unknown) => {
        console.error("Could not close the inactive canvas room", error);
      });
    }, this.options.idleCloseDelayMs ?? 120_000);
    entry.closeTimer.unref();
  }

  private enqueue<T>(entry: CanvasRoomEntry, operation: () => Promise<T>): Promise<T> {
    const result = entry.queue.then(operation);
    entry.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}
