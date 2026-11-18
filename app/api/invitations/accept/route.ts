import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { invitationAcceptSchema } from "@/lib/validation";
import { parseJsonRequest } from "@/lib/request";

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  if (!user.email) return NextResponse.json({ message: "Your account needs an email address to accept an invitation." }, { status: 403 });
  const input = await parseJsonRequest(request);
  if (!input.ok) return NextResponse.json({ message: input.reason === "too-large" ? "Request body is too large." : "Invalid JSON body." }, { status: input.reason === "too-large" ? 413 : 400 });
  const parsed = invitationAcceptSchema.safeParse(input.value);
  if (!parsed.success) return NextResponse.json({ message: "Invitation token is invalid." }, { status: 400 });
  const tokenHash = createHash("sha256").update(parsed.data.token).digest("hex");
  const invitation = await prisma.invitation.findUnique({ where: { tokenHash }, select: { id: true, workspaceId: true, email: true, role: true, status: true, expiresAt: true } });
  if (!invitation || invitation.status !== "PENDING") return NextResponse.json({ message: "Invitation is invalid, expired, or already used." }, { status: 404 });
  if (invitation.expiresAt && invitation.expiresAt <= new Date()) {
    await prisma.invitation.updateMany({ where: { id: invitation.id, status: "PENDING", expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
    return NextResponse.json({ message: "This invitation has expired." }, { status: 410 });
  }
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) return NextResponse.json({ message: "Sign in with the email address this invitation was sent to." }, { status: 403 });
  try {
    await prisma.$transaction(async (tx) => {
      const claimed = await tx.invitation.updateMany({ where: { id: invitation.id, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, data: { status: "ACCEPTED", acceptedAt: new Date() } });
      if (claimed.count !== 1) throw new Error("INVITATION_NOT_PENDING");
      await tx.workspaceMember.create({ data: { workspaceId: invitation.workspaceId, userId: user.id, role: invitation.role } });
      await tx.activityLog.create({ data: { workspaceId: invitation.workspaceId, actorId: user.id, action: "invitation.accepted", metadata: { invitationId: invitation.id } } });
    });
  } catch (error) {
    if (error instanceof Error && error.message === "INVITATION_NOT_PENDING") return NextResponse.json({ message: "This invitation is no longer available." }, { status: 409 });
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") return NextResponse.json({ message: "You are already a member of this workspace." }, { status: 409 });
    console.error("Invitation acceptance failed", error);
    return NextResponse.json({ message: "Could not accept this invitation." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, workspaceId: invitation.workspaceId });
}
