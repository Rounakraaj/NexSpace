import "server-only";
import { getServerSession } from "next-auth";
import type { Role } from "@prisma/client";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { canComment, canEditDocument, canManageWorkspace, canReadWorkspace } from "@/lib/role-policy";

export { canComment, canEditDocument, canManageWorkspace, canReadWorkspace };

export async function getCurrentUser() {
  const session = await getServerSession(authOptions);
  const userId = session?.user?.id;
  if (!userId) return null;
  return { id: userId, email: session.user?.email ?? null, name: session.user?.name ?? null };
}

export async function getWorkspaceRole(workspaceId: string, userId: string): Promise<Role | null> {
  const workspace = await prisma.workspace.findFirst({
    where: { id: workspaceId, OR: [{ ownerId: userId }, { members: { some: { userId } } }] },
    select: { ownerId: true, members: { where: { userId }, select: { role: true }, take: 1 } },
  });
  if (!workspace) return null;
  if (workspace.ownerId === userId) return "OWNER";
  return workspace.members[0]?.role ?? null;
}

export async function authorizeWorkspace(workspaceId: string, allowed: (role: Role) => boolean) {
  const user = await getCurrentUser();
  if (!user) return { user: null, role: null, status: 401 as const };
  const role = await getWorkspaceRole(workspaceId, user.id);
  if (!role || !allowed(role)) return { user, role, status: role ? 403 as const : 404 as const };
  return { user, role, status: 200 as const };
}

export async function getDocumentAccess(documentId: string) {
  const user = await getCurrentUser();
  if (!user) return { user: null, role: null, document: null, status: 401 as const };
  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      workspace: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    },
    select: { id: true, workspaceId: true, type: true },
  });
  if (!document) return { user, role: null, document: null, status: 404 as const };
  const role = await getWorkspaceRole(document.workspaceId, user.id);
  return { user, role, document, status: role ? 200 as const : 404 as const };
}
