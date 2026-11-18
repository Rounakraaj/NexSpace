import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditDocument, getDocumentAccess } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { parseJsonRequest } from "@/lib/request";

const resolveSchema = z.object({ resolved: z.boolean() });

export async function PATCH(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { commentId } = await params;
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true, authorId: true, thread: { select: { documentId: true } } } });
  if (!comment) return NextResponse.json({ ok: false, message: "Comment not found." }, { status: 404 });
  const access = await getDocumentAccess(comment.thread.documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Comment not found." }, { status: access.status });
  if (!canEditDocument(access.role) && comment.authorId !== access.user!.id) return NextResponse.json({ ok: false, message: "You cannot resolve this thread." }, { status: 403 });
  const input = await parseJsonRequest(request);
  if (!input.ok) return NextResponse.json({ ok: false, message: input.reason === "too-large" ? "Request body is too large." : "Invalid JSON body." }, { status: input.reason === "too-large" ? 413 : 400 });
  const parsed = resolveSchema.safeParse(input.value);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Resolution state is invalid." }, { status: 400 });
  const updated = await prisma.comment.update({ where: { id: commentId }, data: { resolved: parsed.data.resolved }, select: { id: true, resolved: true, updatedAt: true } });
  return NextResponse.json({ ok: true, comment: updated });
}
