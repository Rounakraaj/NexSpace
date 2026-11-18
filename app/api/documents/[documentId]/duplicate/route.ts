import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { canEditDocument, getDocumentAccess } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";

const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "untitled";

export async function POST(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  if (!canEditDocument(access.role)) return NextResponse.json({ ok: false, message: "You cannot duplicate this document." }, { status: 403 });
  const source = await prisma.document.findUnique({ where: { id: documentId }, select: { workspaceId: true, parentId: true, title: true, type: true, content: true } });
  if (!source) return NextResponse.json({ ok: false, message: "Document not found." }, { status: 404 });
  const title = `Copy of ${source.title}`.slice(0, 120);
  const duplicate = await prisma.$transaction(async (tx) => {
    const document = await tx.document.create({ data: {
      ...source,
      content: source.content === null ? Prisma.DbNull : source.content as Prisma.InputJsonValue,
      createdById: access.user!.id,
      title,
      slug: `${slug(title)}-${crypto.randomUUID().slice(0, 8)}`,
      favorite: false,
    }, select: { id: true, workspaceId: true, parentId: true, title: true, slug: true, type: true, favorite: true, createdAt: true, updatedAt: true } });
    await tx.activityLog.create({ data: { workspaceId: source.workspaceId, documentId: document.id, actorId: access.user!.id, action: "document.duplicated", metadata: { sourceDocumentId: documentId } } });
    return document;
  });
  return NextResponse.json({ ok: true, document: duplicate }, { status: 201 });
}
