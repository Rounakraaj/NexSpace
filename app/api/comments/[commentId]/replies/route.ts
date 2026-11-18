import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canComment, getDocumentAccess } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";

const replySchema = z.object({ body: z.string().trim().min(1).max(5000) });

export async function POST(request: Request, { params }: { params: Promise<{ commentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { commentId } = await params;
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, select: { id: true, thread: { select: { documentId: true } } } });
  if (!comment) return NextResponse.json({ ok: false, message: "Comment not found." }, { status: 404 });
  const access = await getDocumentAccess(comment.thread.documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Comment not found." }, { status: access.status });
  if (!canComment(access.role)) return NextResponse.json({ ok: false, message: "You cannot reply to this comment." }, { status: 403 });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 }); }
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Reply is invalid." }, { status: 400 });
  const reply = await prisma.commentReply.create({ data: { commentId, authorId: access.user!.id, body: parsed.data.body }, select: { id: true, commentId: true, body: true, createdAt: true, author: { select: { id: true, name: true, image: true } } } });
  return NextResponse.json({ ok: true, reply }, { status: 201 });
}
