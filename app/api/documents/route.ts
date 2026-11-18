import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { canEditDocument, getCurrentUser } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { documentCreateSchema } from "@/lib/validation";
import { parseJsonRequest } from "@/lib/request";

const toSlug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "untitled";

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId || !z.string().uuid().safeParse(workspaceId).success) return NextResponse.json({ ok: false, message: "A valid workspaceId is required." }, { status: 400 });

  const membership = await prisma.workspace.findFirst({
    where: { id: workspaceId, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    select: { ownerId: true, members: { where: { userId: user.id }, select: { role: true }, take: 1 } },
  });
  if (!membership) return NextResponse.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const documents = await prisma.document.findMany({
    where: { workspaceId },
    orderBy: [{ parentId: "asc" }, { updatedAt: "desc" }],
    select: { id: true, workspaceId: true, parentId: true, title: true, slug: true, type: true, favorite: true, updatedAt: true, createdAt: true, author: { select: { id: true, name: true, image: true } } },
  });
  return NextResponse.json({ ok: true, documents });
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });
  const input = await parseJsonRequest(request);
  if (!input.ok) return NextResponse.json({ ok: false, message: input.reason === "too-large" ? "Request body is too large." : "Invalid JSON body." }, { status: input.reason === "too-large" ? 413 : 400 });
  const parsed = documentCreateSchema.safeParse(input.value);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Document details are invalid." }, { status: 400 });

  const { workspaceId, parentId, title, type } = parsed.data;
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    select: { ownerId: true, members: { where: { userId: user.id }, select: { role: true }, take: 1 } },
  });
  if (!workspace) return NextResponse.json({ ok: false, message: "Workspace not found." }, { status: 404 });
  const role = workspace.ownerId === user.id ? "OWNER" : workspace.members[0]?.role;
  if (!canEditDocument(role)) return NextResponse.json({ ok: false, message: "You cannot create documents in this workspace." }, { status: 403 });
  if (parentId) {
    const parent = await prisma.document.findFirst({ where: { id: parentId, workspaceId }, select: { id: true } });
    if (!parent) return NextResponse.json({ ok: false, message: "Parent page not found in this workspace." }, { status: 400 });
  }

  const document = await prisma.$transaction(async (tx) => {
    const created = await tx.document.create({ data: {
      workspaceId, parentId: parentId ?? null, createdById: user.id, title,
      slug: `${toSlug(title)}-${crypto.randomUUID().slice(0, 8)}`,
      type,
      content: type === "PAGE" ? { type: "doc", content: [{ type: "paragraph" }] } : undefined,
    }, select: { id: true, workspaceId: true, parentId: true, title: true, slug: true, type: true, favorite: true, createdAt: true, updatedAt: true } });
    await tx.activityLog.create({ data: { workspaceId, documentId: created.id, actorId: user.id, action: "document.created" } });
    return created;
  });
  return NextResponse.json({ ok: true, document }, { status: 201 });
}
