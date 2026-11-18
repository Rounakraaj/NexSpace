import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditDocument, getDocumentAccess } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";

const snapshotSchema = z.object({ label: z.string().trim().max(120).optional() }).default({});

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  const snapshots = await prisma.documentSnapshot.findMany({ where: { documentId }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, label: true, content: true, createdAt: true, author: { select: { id: true, name: true, image: true } } } });
  return NextResponse.json({ ok: true, snapshots });
}

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  if (!canEditDocument(access.role)) return NextResponse.json({ ok: false, message: "You cannot create a snapshot." }, { status: 403 });
  let input: unknown = {};
  try { input = await request.json(); } catch { return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 }); }
  const parsed = snapshotSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Snapshot label is invalid." }, { status: 400 });
  const document = await prisma.document.findUnique({ where: { id: documentId }, select: { content: true } });
  if (!document) return NextResponse.json({ ok: false, message: "Document not found." }, { status: 404 });
  const snapshot = await prisma.documentSnapshot.create({ data: {
    documentId, createdById: access.user!.id, label: parsed.data.label ?? "Manual snapshot",
    content: document.content === null ? {} : document.content as Prisma.InputJsonValue,
  }, select: { id: true, label: true, createdAt: true } });
  return NextResponse.json({ ok: true, snapshot }, { status: 201 });
}
