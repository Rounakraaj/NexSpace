import { randomBytes, createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { canManageWorkspace, getCurrentUser, getWorkspaceRole } from "@/lib/permissions";
import { env, isDatabaseConfigured } from "@/lib/env";
import { invitationCreateSchema } from "@/lib/validation";
import { consumeRateLimit } from "@/lib/rate-limit";

export async function GET(_request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  const { workspaceId } = await params;
  const role = await getWorkspaceRole(workspaceId, user.id);
  if (!role) return NextResponse.json({ message: "Workspace not found." }, { status: 404 });
  const [workspace, members, invitations] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { ownerId: true } }),
    prisma.workspaceMember.findMany({ where: { workspaceId }, orderBy: [{ role: "asc" }, { createdAt: "asc" }], select: { id: true, userId: true, role: true, createdAt: true, user: { select: { name: true, email: true, image: true } } } }),
    canManageWorkspace(role) ? prisma.invitation.findMany({ where: { workspaceId, status: "PENDING" }, orderBy: { createdAt: "desc" }, select: { id: true, email: true, role: true, expiresAt: true, createdAt: true } }) : Promise.resolve([]),
  ]);
  return NextResponse.json({ ok: true, ownerId: workspace?.ownerId, members, invitations, canManage: canManageWorkspace(role) });
}

export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  const { workspaceId } = await params;
  const role = await getWorkspaceRole(workspaceId, user.id);
  if (!role) return NextResponse.json({ message: "Workspace not found." }, { status: 404 });
  if (!canManageWorkspace(role)) return NextResponse.json({ message: "Only workspace owners can invite members." }, { status: 403 });
  const rate = await consumeRateLimit(`invite:${user.id}`, 10, 60 * 60 * 1000);
  if (rate.unavailable) return NextResponse.json({ message: "Shared request limiting is temporarily unavailable." }, { status: 503 });
  if (!rate.allowed) return NextResponse.json({ message: "Invitation limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ message: "Invalid JSON body." }, { status: 400 }); }
  const parsed = invitationCreateSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ message: "Invitation details are invalid." }, { status: 400 });
  const { email, role: inviteRole } = parsed.data;
  const [workspace, existingInvitation, existingMember] = await Promise.all([
    prisma.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } }),
    prisma.invitation.findFirst({ where: { workspaceId, email: { equals: email, mode: "insensitive" }, status: "PENDING", OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, select: { id: true } }),
    prisma.workspaceMember.findFirst({ where: { workspaceId, user: { email: { equals: email, mode: "insensitive" } } }, select: { id: true } }),
  ]);
  if (!workspace) return NextResponse.json({ message: "Workspace not found." }, { status: 404 });
  if (existingInvitation) return NextResponse.json({ message: "A pending invitation already exists for this email." }, { status: 409 });
  if (existingMember) return NextResponse.json({ message: "This person is already a workspace member." }, { status: 409 });
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const invitation = await prisma.$transaction(async (tx) => {
    const created = await tx.invitation.create({
      data: { workspaceId, inviterId: user.id, email, role: inviteRole, tokenHash, expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) },
      select: { id: true, email: true, role: true, expiresAt: true, createdAt: true },
    });
    await tx.activityLog.create({ data: { workspaceId, actorId: user.id, action: "invitation.created", metadata: { email, role: inviteRole } } });
    return created;
  });
  const base = env.NEXTAUTH_URL ? new URL(env.NEXTAUTH_URL).origin : new URL(request.url).origin;
  return NextResponse.json({ ok: true, invitation, inviteUrl: `${base}/invite?token=${encodeURIComponent(token)}` }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
}
