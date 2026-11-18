import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditDocument, getDocumentAccess } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { isRichTextCollaborationConfigured, RichTextCommandError, sendRichTextCommand } from "@/lib/rich-text-collaboration";

export async function POST(_request: Request, { params }: { params: Promise<{ documentId: string; snapshotId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId, snapshotId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  if (!canEditDocument(access.role)) return NextResponse.json({ ok: false, message: "You cannot restore a snapshot." }, { status: 403 });
  const [document, snapshot] = await Promise.all([
    prisma.document.findUnique({ where: { id: documentId }, select: { id: true, content: true } }),
    prisma.documentSnapshot.findFirst({ where: { id: snapshotId, documentId }, select: { id: true, content: true, label: true } }),
  ]);
  if (!document || !snapshot) return NextResponse.json({ ok: false, message: "Snapshot not found." }, { status: 404 });
  if (access.document?.type === "PAGE" && isRichTextCollaborationConfigured()) {
    try {
      await sendRichTextCommand(documentId, access.user!.id, "restore", { content: snapshot.content });
    } catch (error) {
      if (error instanceof RichTextCommandError) {
        return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
      }
      throw error;
    }
    await prisma.activityLog.create({
      data: {
        workspaceId: access.document!.workspaceId,
        documentId,
        actorId: access.user!.id,
        action: "document.snapshot.restored",
        metadata: { snapshotId },
      },
    });
    return NextResponse.json({ ok: true, restoredSnapshotId: snapshot.id, label: snapshot.label });
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Document" WHERE "id" = ${documentId}::uuid FOR UPDATE`;
    const current = await tx.document.findUnique({ where: { id: documentId }, select: { content: true } });
    if (!current) throw new Error("Document not found.");
    await tx.documentSnapshot.create({ data: {
      documentId, createdById: access.user!.id, label: "Before restore",
      content: current.content === null ? {} : current.content as Prisma.InputJsonValue,
    } });
    await tx.document.update({ where: { id: documentId }, data: { content: snapshot.content as Prisma.InputJsonValue, collaborationState: null } });
    await tx.activityLog.create({ data: { workspaceId: access.document!.workspaceId, documentId, actorId: access.user!.id, action: "document.snapshot.restored", metadata: { snapshotId } } });
  });
  return NextResponse.json({ ok: true, restoredSnapshotId: snapshot.id, label: snapshot.label });
}
