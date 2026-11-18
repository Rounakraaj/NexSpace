import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageWorkspace, getCurrentUser, getWorkspaceRole } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";

export async function DELETE(_request: Request, { params }: { params: Promise<{ workspaceId: string; invitationId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  const { workspaceId, invitationId } = await params;
  const role = await getWorkspaceRole(workspaceId, user.id);
  if (!role) return NextResponse.json({ message: "Workspace not found." }, { status: 404 });
  if (!canManageWorkspace(role)) return NextResponse.json({ message: "Owner permission required." }, { status: 403 });
  const result = await prisma.invitation.updateMany({ where: { id: invitationId, workspaceId, status: "PENDING" }, data: { status: "REVOKED" } });
  if (!result.count) return NextResponse.json({ message: "Pending invitation not found." }, { status: 404 });
  await prisma.activityLog.create({ data: { workspaceId, actorId: user.id, action: "invitation.revoked", metadata: { invitationId } } });
  return NextResponse.json({ ok: true });
}
