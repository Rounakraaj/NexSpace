import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditDocument, getDocumentAccess } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { documentUpdateSchema, editorContentSchema } from "@/lib/validation";
import { deletePrivateObjects } from "@/lib/supabase-storage";
import { isRichTextCollaborationConfigured, RichTextCommandError, sendRichTextCommand } from "@/lib/rich-text-collaboration";

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { id: true, workspaceId: true, parentId: true, title: true, slug: true, type: true, content: true, favorite: true, createdAt: true, updatedAt: true, author: { select: { id: true, name: true, image: true } } },
  });
  if (!document) return NextResponse.json({ ok: false, message: "Document not found." }, { status: 404 });
  return NextResponse.json({ ok: true, document });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  if (!canEditDocument(access.role)) return NextResponse.json({ ok: false, message: "You cannot edit this document." }, { status: 403 });

  const raw = await request.text();
  if (raw.length > 1_500_000) return NextResponse.json({ ok: false, message: "Request body is too large." }, { status: 413 });
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 }); }
  const parsed = documentUpdateSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Document changes are invalid." }, { status: 400 });
  if (access.document?.type === "CANVAS" && parsed.data.content !== undefined) {
    return NextResponse.json({ ok: false, message: "Canvas content is saved by the collaborative canvas service." }, { status: 400 });
  }
  if (parsed.data.parentId) {
    const parent = await prisma.document.findFirst({ where: { id: parsed.data.parentId, workspaceId: access.document!.workspaceId }, select: { id: true } });
    if (!parent || parsed.data.parentId === documentId) return NextResponse.json({ ok: false, message: "Parent page is invalid." }, { status: 400 });
    let ancestorId: string | null = parsed.data.parentId;
    const visited = new Set<string>();
    while (ancestorId && !visited.has(ancestorId)) {
      if (ancestorId === documentId) return NextResponse.json({ ok: false, message: "A page cannot be moved inside its own descendants." }, { status: 400 });
      visited.add(ancestorId);
      const ancestor: { parentId: string | null } | null = await prisma.document.findUnique({ where: { id: ancestorId }, select: { parentId: true } });
      ancestorId = ancestor?.parentId ?? null;
    }
  }

  const nextContent = parsed.data.content;
  if (nextContent !== undefined && (nextContent === null || typeof nextContent !== "object" || Array.isArray(nextContent))) {
    return NextResponse.json({ ok: false, message: "Document content must be an object." }, { status: 400 });
  }
  if (nextContent !== undefined && !editorContentSchema.safeParse(nextContent).success) {
    return NextResponse.json({ ok: false, message: "Document content contains an unsupported or unsafe link." }, { status: 400 });
  }
  if (nextContent !== undefined && !parsed.data.baseUpdatedAt) {
    return NextResponse.json({ ok: false, message: "A document revision is required when saving page content." }, { status: 400 });
  }
  if (nextContent !== undefined && isRichTextCollaborationConfigured()) {
    try {
      await sendRichTextCommand(documentId, access.user!.id, "replace", {
        content: nextContent,
        expectedUpdatedAt: parsed.data.baseUpdatedAt,
      });
    } catch (error) {
      if (error instanceof RichTextCommandError) {
        return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
      }
      throw error;
    }
  }
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      let current: { content: Prisma.JsonValue | null; updatedAt: Date } | null = null;
      if (nextContent !== undefined) {
        current = await tx.document.findUnique({ where: { id: documentId }, select: { content: true, updatedAt: true } });
        if (!current) return null;
        if (!isRichTextCollaborationConfigured() && current.updatedAt.toISOString() !== parsed.data.baseUpdatedAt) {
          throw new RichTextCommandError("The page changed while this edit was pending. Reopen the page before retrying.", 409);
        }
        if (!isRichTextCollaborationConfigured() && current.content && Date.now() - current.updatedAt.getTime() >= 10 * 60 * 1000) {
          await tx.documentSnapshot.create({ data: { documentId, createdById: access.user!.id, label: "Automatic save", content: current.content as Prisma.InputJsonValue } });
        }
      }

      const data = {
        ...(parsed.data.title !== undefined ? { title: parsed.data.title } : {}),
        ...(!isRichTextCollaborationConfigured() && nextContent !== undefined
          ? { content: nextContent as Prisma.InputJsonValue, collaborationState: null }
          : {}),
        ...(parsed.data.favorite !== undefined ? { favorite: parsed.data.favorite } : {}),
        ...(parsed.data.parentId !== undefined ? { parentId: parsed.data.parentId } : {}),
      };
      if (!isRichTextCollaborationConfigured() && nextContent !== undefined && current) {
        const write = await tx.document.updateMany({
          where: { id: documentId, updatedAt: current.updatedAt },
          data,
        });
        if (write.count !== 1) {
          throw new RichTextCommandError("The page changed while this edit was pending. Reopen the page before retrying.", 409);
        }
        return tx.document.findUnique({
          where: { id: documentId },
          select: { id: true, workspaceId: true, parentId: true, title: true, slug: true, type: true, favorite: true, createdAt: true, updatedAt: true },
        });
      }
      if (Object.keys(data).length === 0) {
        return tx.document.findUnique({
          where: { id: documentId },
          select: { id: true, workspaceId: true, parentId: true, title: true, slug: true, type: true, favorite: true, createdAt: true, updatedAt: true },
        });
      }
      return tx.document.update({
        where: { id: documentId },
        data,
        select: { id: true, workspaceId: true, parentId: true, title: true, slug: true, type: true, favorite: true, createdAt: true, updatedAt: true },
      });
    });
  } catch (error) {
    if (error instanceof RichTextCommandError) {
      return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
    }
    throw error;
  }
  if (!updated) return NextResponse.json({ ok: false, message: "Document not found." }, { status: 404 });
  return NextResponse.json({ ok: true, document: updated });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  if (!canEditDocument(access.role)) return NextResponse.json({ ok: false, message: "You cannot delete this document." }, { status: 403 });
  const objectKeys = (await prisma.attachment.findMany({ where: { documentId }, select: { objectKey: true } })).map(({ objectKey }) => objectKey);
  if (isRichTextCollaborationConfigured()) {
    try {
      await sendRichTextCommand(documentId, access.user!.id, "delete");
    } catch (error) {
      if (error instanceof RichTextCommandError) {
        return NextResponse.json({ ok: false, message: error.message }, { status: error.status });
      }
      throw error;
    }
  } else {
    await prisma.document.delete({ where: { id: documentId } });
  }
  const failedCleanup = await deletePrivateObjects(objectKeys);
  if (failedCleanup) console.error("Private attachment cleanup failed after document deletion", { failed: failedCleanup });
  return NextResponse.json({ ok: true });
}
