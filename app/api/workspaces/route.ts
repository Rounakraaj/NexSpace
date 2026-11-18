import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getCurrentUser } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { workspaceCreateSchema } from "@/lib/validation";

const slugBase = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "workspace";

export async function GET() {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });

  const workspaces = await prisma.workspace.findMany({
    where: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, name: true, slug: true, description: true, updatedAt: true,
      ownerId: true,
      members: { where: { userId: user.id }, select: { role: true }, take: 1 },
      _count: { select: { members: true, documents: true } },
    },
  });
  return NextResponse.json({ ok: true, workspaces: workspaces.map(({ members, ...workspace }) => ({ ...workspace, role: workspace.ownerId === user.id ? "OWNER" : members[0]?.role ?? null })) });
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ ok: false, message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ ok: false, message: "Authentication required." }, { status: 401 });

  let input: unknown;
  try { input = await request.json(); } catch { return NextResponse.json({ ok: false, message: "Invalid JSON body." }, { status: 400 }); }
  const parsed = workspaceCreateSchema.safeParse(input);
  if (!parsed.success) return NextResponse.json({ ok: false, message: "Workspace details are invalid." }, { status: 400 });

  const workspace = await prisma.$transaction(async (tx) => {
    const created = await tx.workspace.create({ data: {
      name: parsed.data.name,
      slug: `${slugBase(parsed.data.name)}-${crypto.randomUUID().slice(0, 8)}`,
      description: parsed.data.description || null,
      ownerId: user.id,
    } });
    await tx.workspaceMember.create({ data: { workspaceId: created.id, userId: user.id, role: "OWNER" } });
    await tx.activityLog.create({ data: { workspaceId: created.id, actorId: user.id, action: "workspace.created" } });
    return created;
  });
  return NextResponse.json({ ok: true, workspace: { id: workspace.id, name: workspace.name, slug: workspace.slug, description: workspace.description, role: "OWNER" } }, { status: 201 });
}
