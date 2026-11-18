import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { authorizeWorkspace, canManageWorkspace } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { workspaceUpdateSchema } from "@/lib/validation";
import { deletePrivateObjects } from "@/lib/supabase-storage";
import { parseJsonRequest } from "@/lib/request";

export async function PATCH(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { workspaceId } = await params;
  const access = await authorizeWorkspace(workspaceId, canManageWorkspace);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: "Workspace update is not allowed." }, { status: access.status });
  const input = await parseJsonRequest(request);
  if (!input.ok) return NextResponse.json({ ok: false, message: input.reason === "too-large" ? "Request body is too large." : "Invalid JSON body." }, { status: input.reason === "too-large" ? 413 : 400 });
  const parsed = workspaceUpdateSchema.safeParse(input.value);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Workspace details are invalid." }, { status: 400 });
  const workspace = await prisma.workspace.update({ where: { id: workspaceId }, data: parsed.data, select: { id: true, name: true, slug: true, description: true, updatedAt: true } });
  return NextResponse.json({ ok: true, workspace });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const { workspaceId } = await params;
  const access = await authorizeWorkspace(workspaceId, canManageWorkspace);
  if (access.status !== 200) return NextResponse.json({ ok: false, message: "Workspace deletion is not allowed." }, { status: access.status });
  const objectKeys = (await prisma.attachment.findMany({ where: { document: { workspaceId } }, select: { objectKey: true } })).map(({ objectKey }) => objectKey);
  await prisma.workspace.delete({ where: { id: workspaceId } });
  const failedCleanup = await deletePrivateObjects(objectKeys);
  if (failedCleanup) console.error("Private attachment cleanup failed after workspace deletion", { failed: failedCleanup });
  return NextResponse.json({ ok: true });
}
