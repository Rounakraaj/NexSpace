import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { WebSocket } from "ws";
import { WebSocketServer } from "ws";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { verifyCollaborationTicket } from "@/lib/collaboration-ticket";
import { canEditDocument } from "@/lib/role-policy";
import {
  assertValidCanvasSnapshot,
  CanvasRoomError,
  CanvasRoomManager,
  resolveCanvasRole,
  type CanvasRoomRepository,
} from "./canvas-room-manager.ts";

const secret = env.COLLABORATION_SECRET;
const port = env.CANVAS_PORT ?? 1235;
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for the canvas service.");
if (!secret || secret.length < 32) throw new Error("COLLABORATION_SECRET must contain at least 32 characters.");

type Access = { userId: string; documentId: string; role: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER" };
const snapshotInputSchema = z.object({ label: z.string().trim().min(1).max(120) });
const restoreInputSchema = z.object({ snapshotId: z.string().uuid() });

function jsonResponse(response: ServerResponse, status: number, body: Record<string, unknown>) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 32_000) throw new CanvasRoomError("Request body is too large.", 413);
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw new CanvasRoomError("Invalid JSON body.", 400);
  }
}

const repository: CanvasRoomRepository = {
  async load(documentId) {
    return prisma.document.findFirst({
      where: { id: documentId, type: "CANVAS" },
      select: { content: true, canvasVersion: true },
    }).then((document) => document
      ? { content: document.content, version: document.canvasVersion }
      : null);
  },

  async persist(documentId, snapshot, version) {
    return prisma.$transaction(async (tx) => {
      const saved = await tx.document.updateMany({
        where: { id: documentId, type: "CANVAS", canvasVersion: version },
        data: { content: snapshot as unknown as Prisma.InputJsonValue, canvasVersion: { increment: 1 } },
      });
      if (saved.count !== 1) {
        const exists = await tx.document.findFirst({ where: { id: documentId, type: "CANVAS" }, select: { id: true } });
        throw new CanvasRoomError(
          exists ? "Canvas state changed outside this room. Reconnect before editing." : "Canvas document not found.",
          exists ? 409 : 404,
        );
      }
      return version + 1;
    });
  },

  async createSnapshot(documentId, userId, label, snapshot, version) {
    return prisma.$transaction(async (tx) => {
      const saved = await tx.document.updateMany({
        where: { id: documentId, type: "CANVAS", canvasVersion: version },
        data: { content: snapshot as unknown as Prisma.InputJsonValue, canvasVersion: { increment: 1 } },
      });
      if (saved.count !== 1) {
        const exists = await tx.document.findFirst({ where: { id: documentId, type: "CANVAS" }, select: { id: true } });
        throw new CanvasRoomError(
          exists ? "Canvas state changed outside this room. Retry the snapshot." : "Canvas document not found.",
          exists ? 409 : 404,
        );
      }
      const created = await tx.documentSnapshot.create({
        data: {
          documentId,
          createdById: userId,
          label,
          content: snapshot as unknown as Prisma.InputJsonValue,
        },
        select: { id: true, label: true, createdAt: true },
      });
      return {
        snapshot: { ...created, createdAt: created.createdAt.toISOString() },
        version: version + 1,
      };
    });
  },

  async restoreSnapshot(documentId, snapshotId, userId, current, version) {
    return prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${documentId}::uuid FOR UPDATE`;
      const document = await tx.document.findFirst({
        where: { id: documentId, type: "CANVAS" },
        select: { id: true, workspaceId: true, canvasVersion: true },
      });
      if (!document) throw new CanvasRoomError("Canvas document not found.", 404);
      if (document.canvasVersion !== version) {
        throw new CanvasRoomError("Canvas state changed outside this room. Reconnect before restoring.", 409);
      }
      const snapshot = await tx.documentSnapshot.findFirst({
        where: { id: snapshotId, documentId },
        select: { id: true, label: true, content: true },
      });
      if (!snapshot) throw new CanvasRoomError("Snapshot not found.", 404);
      assertValidCanvasSnapshot(snapshot.content);

      await tx.documentSnapshot.create({
        data: {
          documentId,
          createdById: userId,
          label: "Before restore",
          content: current as unknown as Prisma.InputJsonValue,
        },
      });
      const updated = await tx.document.updateMany({
        where: { id: documentId, type: "CANVAS", canvasVersion: version },
        data: { content: snapshot.content as Prisma.InputJsonValue, canvasVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new CanvasRoomError("Canvas state changed while restoring. Retry the operation.", 409);
      await tx.activityLog.create({
        data: {
          workspaceId: document.workspaceId,
          documentId,
          actorId: userId,
          action: "document.snapshot.restored",
          metadata: { snapshotId },
        },
      });
      return {
        snapshot: snapshot.content,
        result: { restoredSnapshotId: snapshot.id, label: snapshot.label },
        version: version + 1,
      };
    });
  },

  async deleteDocument(documentId) {
    const deleted = await prisma.document.deleteMany({ where: { id: documentId, type: "CANVAS" } });
    if (deleted.count !== 1) throw new CanvasRoomError("Canvas document not found.", 404);
  },
};

const rooms = new CanvasRoomManager(repository);
let shuttingDown = false;

async function authorize(requestUrl: string): Promise<Access | null> {
  const url = new URL(requestUrl, "http://localhost");
  const match = /^\/connect\/([a-f\d-]{36})$/i.exec(url.pathname);
  const documentId = match?.[1];
  const token = url.searchParams.get("token");
  const sessionId = url.searchParams.get("sessionId");
  if (!documentId || !token || !sessionId || sessionId.length > 128 || !/^[\w:-]+$/.test(sessionId)) return null;
  if (shuttingDown || rooms.isDeleting(documentId)) return null;
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
  if (!document || shuttingDown || rooms.isDeleting(documentId)) return null;
  const role = resolveCanvasRole(document.workspace.ownerId, ticket.sub, document.workspace.members[0]?.role);
  if (!role) return null;
  return { userId: ticket.sub, documentId, role };
}

async function handleCanvasCommand(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const match = /^\/internal\/canvas\/([a-f\d-]{36})\/(snapshot|restore|delete)$/.exec(url.pathname);
  if (!match) return false;
  const [, documentId, command] = match;
  if (!documentId || !command) return false;
  if (shuttingDown) {
    jsonResponse(response, 503, { message: "Canvas service is shutting down." });
    return true;
  }
  if (request.method !== "POST") {
    jsonResponse(response, 405, { message: "Method not allowed." });
    return true;
  }

  const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
  const ticket = verifyCollaborationTicket(token, secret!);
  if (!ticket || ticket.documentId !== documentId) {
    jsonResponse(response, 401, { message: "Invalid or expired collaboration ticket." });
    return true;
  }

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      type: "CANVAS",
      workspace: { OR: [{ ownerId: ticket.sub }, { members: { some: { userId: ticket.sub } } }] },
    },
    select: { workspace: { select: { ownerId: true, members: { where: { userId: ticket.sub }, select: { role: true }, take: 1 } } } },
  });
  if (!document) {
    jsonResponse(response, 404, { message: "Canvas document not found." });
    return true;
  }
  const role = resolveCanvasRole(document.workspace.ownerId, ticket.sub, document.workspace.members[0]?.role);
  if (!role || !canEditDocument(role)) {
    jsonResponse(response, 403, { message: "You cannot edit this canvas." });
    return true;
  }

  try {
    if (command === "snapshot") {
      const input = snapshotInputSchema.safeParse(await readJsonBody(request));
      if (!input.success) throw new CanvasRoomError("Snapshot label is invalid.", 400);
      const snapshot = await rooms.createSnapshot(documentId, ticket.sub, input.data.label);
      jsonResponse(response, 200, { ok: true, snapshot });
    } else if (command === "restore") {
      const input = restoreInputSchema.safeParse(await readJsonBody(request));
      if (!input.success) throw new CanvasRoomError("Snapshot identifier is invalid.", 400);
      const result = await rooms.restoreSnapshot(documentId, input.data.snapshotId, ticket.sub);
      jsonResponse(response, 200, { ok: true, ...result });
    } else if (command === "delete") {
      await rooms.deleteDocument(documentId, ticket.sub);
      jsonResponse(response, 200, { ok: true });
    } else {
      jsonResponse(response, 404, { message: "Canvas command not found." });
    }
  } catch (error) {
    const status = error instanceof CanvasRoomError ? error.status : 500;
    if (status === 500) console.error("Canvas collaboration operation failed.", error);
    jsonResponse(response, status, {
      message: status >= 500 ? "The Canvas operation failed." : error instanceof Error ? error.message : "The Canvas operation failed.",
    });
  }
  return true;
}

const httpServer = createServer((request, response) => {
  void (async () => {
    if (await handleCanvasCommand(request, response)) return;
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ service: "nexspace-canvas", status: "ok" }));
  })().catch((error: unknown) => {
    console.error("Canvas HTTP request failed.", error);
    if (!response.headersSent) jsonResponse(response, 500, { message: "Canvas request failed." });
  });
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
    const entry = await rooms.getOrCreateRoom(access.documentId);
    rooms.retain(entry);
    if (shuttingDown || rooms.isDeleting(access.documentId)) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
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
  void rooms.getOrCreateRoom(access.documentId).then((entry) => {
    if (shuttingDown || rooms.isDeleting(access.documentId)) {
      webSocket.close(1008, "Canvas document is being deleted");
      return;
    }
    rooms.retain(entry);
    entry.room.handleSocketConnect({
      sessionId: `${access.userId}:${sessionId}`,
      socket: webSocket,
      isReadonly: !canEditDocument(access.role),
    });
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

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    void (async () => {
      await rooms.closeAll();
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
