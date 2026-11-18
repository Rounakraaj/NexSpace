import { createServer } from "node:http";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { InMemorySyncStorage, TLSocketRoom } from "@tldraw/sync-core";
import { createTLSchema, type TLRecord } from "@tldraw/tlschema";
import type { RoomSnapshot } from "@tldraw/sync-core";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { verifyCollaborationTicket } from "@/lib/collaboration-ticket";
import { canEditDocument } from "@/lib/role-policy";

const secret = env.COLLABORATION_SECRET;
const port = env.CANVAS_PORT ?? 1235;
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for the canvas service.");
if (!secret || secret.length < 32) throw new Error("COLLABORATION_SECRET must contain at least 32 characters.");

type Access = { userId: string; documentId: string; role: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER" };
type RoomEntry = { room: TLSocketRoom<TLRecord>; timer: NodeJS.Timeout | null; closeTimer: NodeJS.Timeout | null; writes: Promise<void> };
const rooms = new Map<string, Promise<RoomEntry>>();
const schema = createTLSchema();

function persistRoom(documentId: string, entry: RoomEntry) {
  const content = entry.room.getCurrentSnapshot() as unknown as Prisma.InputJsonValue;
  entry.writes = entry.writes.then(async () => {
    await prisma.document.update({ where: { id: documentId }, data: { content } });
  }).catch((error: unknown) => { console.error("Could not persist canvas snapshot", error); });
  return entry.writes;
}

async function getOrCreateRoom(documentId: string): Promise<RoomEntry> {
  const cached = rooms.get(documentId);
  if (cached) return cached;

  const pending = (async () => {
    const stored = await prisma.document.findFirst({ where: { id: documentId, type: "CANVAS" }, select: { content: true } });
    if (!stored) throw new Error("Canvas document not found.");
    const snapshot = stored.content && typeof stored.content === "object" && !Array.isArray(stored.content)
      ? stored.content as unknown as RoomSnapshot
      : undefined;
    const entry: RoomEntry = { room: null as unknown as TLSocketRoom<TLRecord>, timer: null, closeTimer: null, writes: Promise.resolve() };
    const storage = new InMemorySyncStorage<TLRecord>({
      ...(snapshot && Array.isArray(snapshot.documents) ? { snapshot } : {}),
    });
    const room = new TLSocketRoom<TLRecord>({
      storage,
      schema,
      onDataChange() {
        if (entry.timer) clearTimeout(entry.timer);
        entry.timer = setTimeout(() => {
          entry.timer = null;
          void persistRoom(documentId, entry);
        }, 600);
      },
      onSessionRemoved(_room, { numSessionsRemaining }) {
        if (numSessionsRemaining !== 0) return;
        entry.closeTimer = setTimeout(() => {
          if (room.getNumActiveSessions() !== 0) return;
          if (entry.timer) { clearTimeout(entry.timer); entry.timer = null; }
          void persistRoom(documentId, entry).finally(() => {
            room.close();
            rooms.delete(documentId);
          });
        }, 120_000);
      },
    });
    entry.room = room;
    return entry;
  })();
  rooms.set(documentId, pending);
  try {
    return await pending;
  } catch (error) {
    rooms.delete(documentId);
    throw error;
  }
}

async function authorize(requestUrl: string): Promise<Access | null> {
  const url = new URL(requestUrl, "http://localhost");
  const match = /^\/connect\/([a-f\d-]{36})$/i.exec(url.pathname);
  const documentId = match?.[1];
  const token = url.searchParams.get("token");
  const sessionId = url.searchParams.get("sessionId");
  if (!documentId || !token || !sessionId || sessionId.length > 128 || !/^[\w:-]+$/.test(sessionId)) return null;
  const ticket = verifyCollaborationTicket(token, secret!);
  if (!ticket || ticket.documentId !== documentId) return null;

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      type: "CANVAS",
      workspace: { OR: [{ ownerId: ticket.sub }, { members: { some: { userId: ticket.sub } } }] },
    },
    select: { workspace: { select: { ownerId: true, members: { where: { userId: ticket.sub }, select: { role: true }, take: 1 } } } },
  });
  if (!document) return null;
  const role = document.workspace.ownerId === ticket.sub ? "OWNER" : document.workspace.members[0]?.role;
  if (!role) return null;
  return { userId: ticket.sub, documentId, role };
}

const httpServer = createServer((_request, response) => {
  response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify({ service: "nexspace-canvas", status: "ok" }));
});
const webSockets = new WebSocketServer({ noServer: true, maxPayload: 1_500_000, perMessageDeflate: false });
const connectionDetails = new WeakMap<WebSocket, { access: Access; sessionId: string }>();

httpServer.on("upgrade", (request, socket, head) => {
  void authorize(request.url ?? "").then(async (access) => {
    if (!access) {
      socket.write("HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    const url = new URL(request.url ?? "/", "http://localhost");
    const sessionId = url.searchParams.get("sessionId")!;
    const entry = await getOrCreateRoom(access.documentId);
    if (entry.closeTimer) clearTimeout(entry.closeTimer);
    entry.closeTimer = null;
    webSockets.handleUpgrade(request, socket, head, (webSocket) => {
      connectionDetails.set(webSocket, { access, sessionId });
      webSockets.emit("connection", webSocket, request);
    });
  }).catch((error: unknown) => {
    console.error("Canvas connection setup failed", error);
    if (!socket.destroyed) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n");
      socket.destroy();
    }
  });
});

webSockets.on("connection", (webSocket) => {
  const details = connectionDetails.get(webSocket);
  if (!details) { webSocket.close(1008, "Invalid canvas session"); return; }
  const { access, sessionId } = details;
  void getOrCreateRoom(access.documentId).then(({ room }) => {
    room.handleSocketConnect({ sessionId: `${access.userId}:${sessionId}`, socket: webSocket, isReadonly: !canEditDocument(access.role) });
  }).catch((error: unknown) => {
    console.error("Canvas room could not be opened", error);
    webSocket.close(1011, "Canvas room unavailable");
  });
});

httpServer.on("error", (error) => {
  console.error("Could not start the canvas server", error);
  void prisma.$disconnect().finally(() => { process.exitCode = 1; });
});
httpServer.listen(port, () => process.stdout.write(`NexSpace canvas sync server listening on port ${port}\n`));

let shuttingDown = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      await Promise.all([...rooms.entries()].map(async ([documentId, roomPromise]) => {
        try {
          const entry = await roomPromise;
          if (entry.timer) clearTimeout(entry.timer);
          if (entry.closeTimer) clearTimeout(entry.closeTimer);
          entry.timer = null;
          entry.closeTimer = null;
          await persistRoom(documentId, entry);
          entry.room.close();
        } catch (error) {
          console.error("Could not flush a canvas room during shutdown", error);
        }
      }));
      for (const socket of webSockets.clients) socket.close(1001, "Canvas service shutting down");
      const forcedClose = setTimeout(() => {
        for (const socket of webSockets.clients) socket.terminate();
        httpServer.closeAllConnections();
      }, 5_000);
      forcedClose.unref();
      webSockets.close(() => {
        clearTimeout(forcedClose);
        httpServer.close(() => { void prisma.$disconnect(); });
      });
    })().catch((error: unknown) => {
      console.error("Could not shut down the canvas server cleanly", error);
      void prisma.$disconnect().finally(() => { process.exitCode = 1; });
    });
  });
}
