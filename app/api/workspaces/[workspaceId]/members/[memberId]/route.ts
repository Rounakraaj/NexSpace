import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageWorkspace, getCurrentUser, getWorkspaceRole } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { memberRoleSchema } from "@/lib/validation";
import { parseJsonRequest } from "@/lib/request";

type Context = { params: Promise<{ workspaceId: string; memberId: string }> };

async function requireOwner(workspaceId: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, status: 401 } as const;
  const role = await getWorkspaceRole(workspaceId, user.id);
  if (!role) return { user, status: 404 } as const;
  if (!canManageWorkspace(role)) return { user, status: 403 } as const;
  return { user, status: 200 } as const;
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const { workspaceId, memberId } = await params;
  const access = await requireOwner(workspaceId);
  if (access.status !== 200) return NextResponse.json({ message: access.status === 401 ? "Authentication required." : access.status === 403 ? "Owner permission required." : "Workspace not found." }, { status: access.status });
  const body = await parseJsonRequest(request);
  if (!body.ok) return NextResponse.json({ message: body.reason === "too-large" ? "Request body is too large." : "Invalid JSON body." }, { status: body.reason === "too-large" ? 413 : 400 });
  const parsed = memberRoleSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ message: "Member role is invalid." }, { status: 400 });
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } });
  const member = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId, userId: { not: workspace?.ownerId } }, select: { id: true } });
  if (!member) return NextResponse.json({ message: "Member not found." }, { status: 404 });
  const updated = await prisma.workspaceMember.update({ where: { id: memberId }, data: { role: parsed.data.role }, select: { id: true, role: true } });
  await prisma.activityLog.create({ data: { workspaceId, actorId: access.user!.id, action: "workspace.member.role_updated", metadata: { memberId, role: updated.role } } });
  return NextResponse.json({ ok: true, member: updated });
}

export async function DELETE(_request: Request, { params }: Context) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const { workspaceId, memberId } = await params;
  const access = await requireOwner(workspaceId);
  if (access.status !== 200) return NextResponse.json({ message: access.status === 401 ? "Authentication required." : access.status === 403 ? "Owner permission required." : "Workspace not found." }, { status: access.status });
  const workspace = await prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } });
  const member = await prisma.workspaceMember.findFirst({ where: { id: memberId, workspaceId, userId: { not: workspace?.ownerId } }, select: { id: true, userId: true } });
  if (!member) return NextResponse.json({ message: "Member not found." }, { status: 404 });
  await prisma.$transaction([
    prisma.workspaceMember.delete({ where: { id: memberId } }),
    prisma.activityLog.create({ data: { workspaceId, actorId: access.user!.id, action: "workspace.member.removed", metadata: { memberId } } }),
  ]);
  return NextResponse.json({ ok: true });
}
