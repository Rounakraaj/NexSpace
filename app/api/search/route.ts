import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { consumeRateLimit } from "@/lib/rate-limit";

const querySchema = z.string().trim().min(2).max(80);

export async function GET(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ message: "Authentication required." }, { status: 401 });
  const rate = await consumeRateLimit(`search:${user.id}`, 60, 60_000);
  if (rate.unavailable) return NextResponse.json({ message: "Shared request limiting is temporarily unavailable." }, { status: 503 });
  if (!rate.allowed) return NextResponse.json({ message: "Search limit reached. Try again shortly." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const query = querySchema.safeParse(new URL(request.url).searchParams.get("q") ?? "");
  if (!query.success) return NextResponse.json({ workspaces: [], documents: [] });

  const [workspaces, documents] = await Promise.all([
    prisma.workspace.findMany({
      where: { name: { contains: query.data, mode: "insensitive" }, OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] },
      orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, name: true },
    }),
    prisma.document.findMany({
      where: { title: { contains: query.data, mode: "insensitive" }, workspace: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] } },
      orderBy: { updatedAt: "desc" }, take: 12, select: { id: true, title: true, type: true, workspaceId: true, workspace: { select: { name: true } } },
    }),
  ]);
  return NextResponse.json({ workspaces, documents }, { headers: { "Cache-Control": "private, no-store" } });
}
