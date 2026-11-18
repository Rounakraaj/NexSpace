import { Server } from "@hocuspocus/server";
import { Redis } from "@hocuspocus/extension-redis";
import { TiptapTransformer } from "@hocuspocus/transformer";
import { Prisma } from "@prisma/client";
import StarterKit from "@tiptap/starter-kit";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import * as Y from "yjs";
import { prisma } from "@/lib/prisma";
import { env } from "@/lib/env";
import { verifyCollaborationTicket } from "@/lib/collaboration-ticket";
import { canEditDocument } from "@/lib/role-policy";
import { editorContentSchema } from "@/lib/validation";
import { applyRichTextReplacement, DocumentLocks, getYjsUpdateFromHocuspocusMessage } from "./rich-text-state.ts";

type Context = { userId: string; documentId: string; role: "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER" };

const secret = env.COLLABORATION_SECRET;
if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required for the collaboration service.");
if (!secret || secret.length < 32) throw new Error("COLLABORATION_SECRET must contain at least 32 characters.");

const extensions = [
  StarterKit.configure({ link: { openOnClick: false } }),
  TaskList,
  TaskItem.configure({ nested: true }),
  Image.configure({ inline: false, allowBase64: false }),
  TableKit.configure({ table: { resizable: true } }),
];
const documentLocks = new DocumentLocks();
const pendingMessageLocks = new WeakMap<object, () => void>();
const deletingDocuments = new Set<string>();

const emptyDocument = { type: "doc", content: [{ type: "paragraph" }] };

function jsonResponse(response: import("node:http").ServerResponse, status: number, body: Record<string, unknown>) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: import("node:http").IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 1_500_000) throw Object.assign(new Error("Request body is too large."), { status: 413 });
    chunks.push(bytes);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    throw Object.assign(new Error("Invalid JSON body."), { status: 400 });
  }
}

async function persistMergedState(
  documentId: string,
  candidate: Y.Doc,
  userId: string | undefined,
  options: { expectedUpdatedAt?: string; beforeRestore?: boolean } = {},
) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${documentId}::uuid FOR UPDATE`;
    const current = await tx.document.findUnique({
      where: { id: documentId },
      select: {
        collaborationState: true,
        content: true,
        createdById: true,
        createdAt: true,
        updatedAt: true,
        snapshots: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      },
    });
    if (!current) throw Object.assign(new Error("Document not found."), { status: 404 });
    if (options.expectedUpdatedAt && current.updatedAt.toISOString() !== options.expectedUpdatedAt) {
      throw Object.assign(new Error("The page changed while this offline edit was pending. Reopen the page before retrying."), { status: 409 });
    }

    const merged = new Y.Doc();
    try {
      if (current.collaborationState) Y.applyUpdate(merged, new Uint8Array(current.collaborationState));
      Y.applyUpdate(merged, Y.encodeStateAsUpdate(candidate));
      const state = Y.encodeStateAsUpdate(merged);
      const content = TiptapTransformer.fromYdoc(merged, "default") as Prisma.InputJsonValue;

      if (options.beforeRestore && current.content) {
        await tx.documentSnapshot.create({
          data: {
            documentId,
            createdById: userId ?? current.createdById,
            label: "Before restore",
            content: current.content as Prisma.InputJsonValue,
          },
        });
      } else {
        const lastSnapshotAt = current.snapshots[0]?.createdAt ?? current.createdAt;
        if (current.content && Date.now() - lastSnapshotAt.getTime() >= 10 * 60 * 1000) {
          await tx.documentSnapshot.create({
            data: {
              documentId,
              createdById: userId ?? current.createdById,
              label: "Automatic collaboration snapshot",
              content: current.content as Prisma.InputJsonValue,
            },
          });
        }
      }

      await tx.document.update({
        where: { id: documentId },
        data: { collaborationState: Buffer.from(state), content },
      });
      return state;
    } finally {
      merged.destroy();
    }
  });
}

async function loadOrInitializeDocument(documentId: string) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${documentId}::uuid FOR UPDATE`;
    const stored = await tx.document.findUnique({
      where: { id: documentId },
      select: { collaborationState: true, content: true },
    });
    if (!stored) throw new Error("Document not found.");
    if (stored.collaborationState) return new Uint8Array(stored.collaborationState);

    const initial = TiptapTransformer.toYdoc(stored.content ?? emptyDocument, "default", extensions);
    try {
      const state = Y.encodeStateAsUpdate(initial);
      await tx.document.update({
        where: { id: documentId },
        data: {
          collaborationState: Buffer.from(state),
          content: TiptapTransformer.fromYdoc(initial, "default") as Prisma.InputJsonValue,
        },
      });
      return state;
    } finally {
      initial.destroy();
    }
  });
}

async function handleControlRequest(
  request: import("node:http").IncomingMessage,
  response: import("node:http").ServerResponse,
  instance: import("@hocuspocus/server").Hocuspocus<Context>,
) {
  const url = new URL(request.url ?? "/", "http://localhost");
  const match = /^\/internal\/rich-text\/([a-f\d-]{36})\/(replace|restore|delete)$/i.exec(url.pathname);
  if (!match) return;

  const [, documentId, operation] = match;
  if (!documentId || !operation) return;
  try {
    if (!secret) throw new Error("Collaboration signing is not configured.");
    if (request.method !== "POST") {
      jsonResponse(response, 405, { message: "Method not allowed." });
      throw null;
    }
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, "") ?? "";
    const ticket = verifyCollaborationTicket(token, secret);
    if (!ticket || ticket.documentId !== documentId) {
      jsonResponse(response, 401, { message: "Invalid or expired collaboration ticket." });
      throw null;
    }

    const access = await prisma.document.findFirst({
      where: {
        id: documentId,
        type: "PAGE",
        workspace: { OR: [{ ownerId: ticket.sub }, { members: { some: { userId: ticket.sub } } }] },
      },
      select: { createdById: true, workspace: { select: { ownerId: true, members: { where: { userId: ticket.sub }, select: { role: true }, take: 1 } } } },
    });
    if (!access) {
      jsonResponse(response, 404, { message: "Document not found." });
      throw null;
    }
    const role = access.workspace.ownerId === ticket.sub ? "OWNER" : access.workspace.members[0]?.role;
    if (!role || !canEditDocument(role)) {
      jsonResponse(response, 403, { message: "You cannot edit this page." });
      throw null;
    }

    if (operation === "delete") {
      if (deletingDocuments.has(documentId)) {
        jsonResponse(response, 409, { message: "Document deletion is already in progress." });
        throw null;
      }
      deletingDocuments.add(documentId);
      try {
        const document = instance.documents.get(documentId);
        if (document) {
          instance.closeConnections(documentId);
          const deadline = Date.now() + 5_000;
          while (document.getConnectionsCount() > 0 && Date.now() < deadline) {
            await new Promise((resolve) => setTimeout(resolve, 25));
          }
          if (document.getConnectionsCount() > 0) {
            throw Object.assign(new Error("Active collaboration sessions could not be closed."), { status: 503 });
          }
          await instance.debouncer.executeNow(`onStoreDocument-${documentId}`);
          await document.saveMutex.runExclusive(async () => {});
          await documentLocks.runExclusive(documentId, async () => {});
          await instance.unloadDocument(document);
        }
        await prisma.document.delete({ where: { id: documentId } });
        deletingDocuments.delete(documentId);
        jsonResponse(response, 200, { ok: true });
      } catch (error) {
        deletingDocuments.delete(documentId);
        throw error;
      }
      throw null;
    }

    const input = await readJsonBody(request);
    const payload = input && typeof input === "object" ? input as Record<string, unknown> : {};
    if (operation === "replace") {
      const content = editorContentSchema.safeParse(payload.content);
      if (!content.success || typeof payload.expectedUpdatedAt !== "string" || !Number.isFinite(Date.parse(payload.expectedUpdatedAt))) {
        jsonResponse(response, 400, { message: "Document content or revision is invalid." });
        throw null;
      }
    } else {
      const content = editorContentSchema.safeParse(payload.content);
      if (!content.success) {
        jsonResponse(response, 400, { message: "Snapshot content is invalid." });
        throw null;
      }
    }

    const active = await instance.openDirectConnection(documentId, { userId: ticket.sub, documentId, role });
    const document = active.document;
    if (!document) throw new Error("Could not open the collaboration document.");
    try {
      await documentLocks.runExclusive(documentId, async () => {
        if (deletingDocuments.has(documentId)) throw Object.assign(new Error("Document is being deleted."), { status: 404 });
        const candidate = new Y.Doc();
        try {
          Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
          const replacement = TiptapTransformer.toYdoc(payload.content, "default", extensions);
          try {
            applyRichTextReplacement(candidate, Y.encodeStateAsUpdate(replacement));
          } finally {
            replacement.destroy();
          }
          const state = await persistMergedState(documentId, candidate, ticket.sub, {
            ...(operation === "replace" ? { expectedUpdatedAt: payload.expectedUpdatedAt as string } : { beforeRestore: true }),
          });
          Y.applyUpdate(document, state);
        } finally {
          candidate.destroy();
        }
      });
      jsonResponse(response, 200, { ok: true });
    } finally {
      await active.disconnect({ unloadImmediately: false });
    }
  } catch (error) {
    if (response.headersSent) throw null;
    const status = error && typeof error === "object" && "status" in error && typeof error.status === "number" ? error.status : 500;
    if (status === 500) console.error("Rich-text collaboration operation failed.", error);
    jsonResponse(response, status, {
      message: status >= 500 ? "The collaboration operation failed." : error instanceof Error ? error.message : "The collaboration operation failed.",
    });
  }
  throw null;
}

function redisExtension() {
  if (process.env.COLLABORATION_REDIS_ENABLED !== "true") return [];
  const address = env.REDIS_URL;
  if (!address) throw new Error("Set REDIS_URL when COLLABORATION_REDIS_ENABLED=true.");
  const url = new URL(address);
  if (url.protocol !== "redis:" && url.protocol !== "rediss:") throw new Error("REDIS_URL must use redis:// or rediss://.");
  const options = {
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: url.pathname.length > 1 ? Number(url.pathname.slice(1)) : 0,
    ...(url.protocol === "rediss:" ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    retryStrategy: (attempt: number) => Math.min(attempt * 500, 5000),
  };
  const extension = new Redis({ host: url.hostname, port: Number(url.port || 6379), options, awaitInitialSyncTimeout: 1500 });
  let errorReported = false;
  for (const client of [extension.pub, extension.sub]) {
    client.on("error", (error) => {
      if (!errorReported) {
        console.error("Collaboration Redis is unavailable; reconnect attempts will continue.", error);
        errorReported = true;
      }
    });
    client.on("ready", () => { errorReported = false; });
  }
  return [extension];
}

const server = new Server<Context>({
  name: `nexspace-${process.env.HOSTNAME ?? "collaboration"}`,
  port: env.COLLABORATION_PORT ?? 1234,
  debounce: 500,
  maxDebounce: 1_000,
  quiet: true,
  websocketOptions: { maxPayload: 1_500_000 },
  maxUnauthenticatedQueueSize: 1_000_000,
  maxUnauthenticatedQueueMessages: 100,
  maxPendingDocuments: 5,
  stopOnSignals: false,
  extensions: redisExtension(),

  async onRequest({ request, response, instance }) {
    await handleControlRequest(request, response, instance);
  },

  async onAuthenticate({ documentName, token, connectionConfig }) {
    const ticket = verifyCollaborationTicket(token, secret);
    if (!ticket || ticket.documentId !== documentName || deletingDocuments.has(documentName)) {
      throw new Error("Invalid, expired, or unavailable collaboration document.");
    }

    const document = await prisma.document.findFirst({
      where: {
        id: documentName,
        workspace: { OR: [{ ownerId: ticket.sub }, { members: { some: { userId: ticket.sub } } }] },
      },
      select: { type: true, workspace: { select: { ownerId: true, members: { where: { userId: ticket.sub }, select: { role: true }, take: 1 } } } },
    });
    if (!document || document.type !== "PAGE") throw new Error("You no longer have access to this page.");
    const role = document.workspace.ownerId === ticket.sub ? "OWNER" : document.workspace.members[0]?.role;
    if (!role) throw new Error("You no longer have access to this document.");
    connectionConfig.readOnly = !canEditDocument(role);
    return { userId: ticket.sub, documentId: documentName, role };
  },

  async onLoadDocument({ documentName }) {
    if (deletingDocuments.has(documentName)) throw new Error("Document is being deleted.");
    return loadOrInitializeDocument(documentName);
  },

  async beforeHandleMessage({ document, documentName, connection, context, update }) {
    if (deletingDocuments.has(documentName)) throw new Error("Document is being deleted.");
    const incomingUpdate = getYjsUpdateFromHocuspocusMessage(update);
    if (!incomingUpdate) return;
    if (!canEditDocument(context.role)) throw new Error("This collaboration session is read-only.");

    const release = await documentLocks.acquire(documentName);
    try {
      if (deletingDocuments.has(documentName)) throw new Error("Document is being deleted.");
      const candidate = new Y.Doc();
      try {
        Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document));
        Y.applyUpdate(candidate, incomingUpdate);
        await persistMergedState(documentName, candidate, context.userId);
      } finally {
        candidate.destroy();
      }
      pendingMessageLocks.set(connection, release);
    } catch (error) {
      release();
      throw error;
    }
  },

  async afterHandleMessage({ connection }) {
    const release = pendingMessageLocks.get(connection);
    if (!release) return;
    pendingMessageLocks.delete(connection);
    release();
  },

  async onStoreDocument({ documentName, document, lastContext }) {
    await documentLocks.runExclusive(documentName, async () => {
      await persistMergedState(documentName, document, lastContext?.userId);
    });
  },
});

server.httpServer.once("error", (error: NodeJS.ErrnoException) => {
  console.error("Could not bind the Hocuspocus collaboration server", error);
  void server.destroy().catch((shutdownError: unknown) => {
    console.error("Could not clean up the collaboration server after startup failure", shutdownError);
  }).finally(() => prisma.$disconnect()).finally(() => { process.exitCode = 1; });
});

server.listen().then(() => {
  process.stdout.write(`NexSpace collaboration server listening on port ${env.COLLABORATION_PORT ?? 1234}\n`);
}).catch((error: unknown) => {
  console.error("Could not start the collaboration server", error);
  void server.destroy().finally(() => prisma.$disconnect()).finally(() => { process.exitCode = 1; });
});

let shutdownStarted = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (shutdownStarted) return;
    shutdownStarted = true;
    void server.destroy()
      .catch((error: unknown) => console.error("Could not shut down the collaboration server cleanly", error))
      .finally(() => prisma.$disconnect());
  });
}
