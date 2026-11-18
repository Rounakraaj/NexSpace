"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { canEditDocument, getCurrentUser, getWorkspaceRole } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { documentCreateSchema, workspaceCreateSchema } from "@/lib/validation";
const slug = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "untitled";

export async function createWorkspace(input: unknown) {
  if (!isDatabaseConfigured()) return { ok: false as const, message: "Database is not configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, message: "Authentication required." };
  const parsed = workspaceCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Workspace name is invalid." };
  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({ data: { ...parsed.data, slug: `${slug(parsed.data.name)}-${crypto.randomUUID().slice(0, 8)}`, ownerId: user.id } });
    await tx.workspaceMember.create({ data: { workspaceId: created.id, userId: user.id, role: "OWNER" } });
    return created;
  });
  revalidatePath("/");
  return { ok: true as const, workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug } };
}

export async function createDocument(input: unknown) {
  if (!isDatabaseConfigured()) return { ok: false as const, message: "Database is not configured." };
  const user = await getCurrentUser();
  if (!user) return { ok: false as const, message: "Authentication required." };
  const parsed = documentCreateSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: "Document details are invalid." };
  const { title, workspaceId, parentId } = parsed.data;
  const role = await getWorkspaceRole(workspaceId, user.id);
  if (!canEditDocument(role)) return { ok: false as const, message: "Workspace access denied." };
  if (parentId && !await prisma.document.findFirst({ where: { id: parentId, workspaceId }, select: { id: true } })) return { ok: false as const, message: "Parent page not found." };
  const document = await prisma.document.create({ data: {
    workspaceId, parentId: parentId ?? null, createdById: user.id, title,
    slug: `${slug(title)}-${crypto.randomUUID().slice(0, 8)}`,
    type: "PAGE", content: { type: "doc", content: [{ type: "paragraph" }] },
  }, select: { id: true, workspaceId: true, parentId: true, title: true, slug: true, createdAt: true } });
  revalidatePath("/");
  return { ok: true as const, document };
}
