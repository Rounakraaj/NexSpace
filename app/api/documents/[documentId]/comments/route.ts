import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canComment, getDocumentAccess } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { parseJsonRequest } from "@/lib/request";

const commentSchema = z.object({
  body: z.string().trim().min(1).max(5000),
  anchor: z.record(z.string(), z.unknown()).optional(),
});

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  const threads = await prisma.commentThread.findMany({
    where: { documentId },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, anchor: true, createdAt: true, updatedAt: true,
      author: { select: { id: true, name: true, image: true } },
      comments: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true, body: true, resolved: true, createdAt: true, updatedAt: true,
          author: { select: { id: true, name: true, image: true } },
          replies: { orderBy: { createdAt: "asc" }, select: { id: true, body: true, createdAt: true, author: { select: { id: true, name: true, image: true } } } },
        },
      },
    },
  });
  return NextResponse.json({ ok: true, threads });
}

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  if (!canComment(access.role)) return NextResponse.json({ ok: false, message: "You cannot comment on this document." }, { status: 403 });
  const input = await parseJsonRequest(request);
  if (!input.ok) return NextResponse.json({ ok: false, message: input.reason === "too-large" ? "Request body is too large." : "Invalid JSON body." }, { status: input.reason === "too-large" ? 413 : 400 });
  const parsed = commentSchema.safeParse(input.value);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Comment is invalid." }, { status: 400 });
  if (parsed.data.anchor && JSON.stringify(parsed.data.anchor).length > 4000) return NextResponse.json({ ok: false, message: "Comment anchor is too large." }, { status: 400 });

  const thread = await prisma.commentThread.create({ data: {
    documentId,
    createdById: access.user!.id,
    anchor: parsed.data.anchor as Prisma.InputJsonValue | undefined,
    comments: { create: { authorId: access.user!.id, body: parsed.data.body } },
  }, select: { id: true, anchor: true, createdAt: true, comments: { select: { id: true, body: true, resolved: true, createdAt: true } } } });
  return NextResponse.json({ ok: true, thread }, { status: 201 });
}
