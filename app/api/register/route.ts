import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { isDatabaseConfigured } from "@/lib/env";
import { hashPassword } from "@/lib/password";
import { registrationSchema } from "@/lib/validation";
import { consumeRegistrationLimit, getRequestIp } from "@/lib/rate-limit";
import { parseJsonRequest } from "@/lib/request";

function duplicateEmailError(error: unknown) {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") return false;
  const target = error.meta?.target;
  const columns = Array.isArray(target) ? target.map(String) : [String(target ?? "")];
  return columns.some((column) => /email/i.test(column));
}

function logRegistrationFailure(error: unknown) {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    console.error("Registration database operation failed", {
      code: error.code,
      model: error.meta?.modelName,
      column: error.meta?.column_name ?? error.meta?.column,
      target: error.meta?.target,
    });
    return;
  }
  console.error("Registration failed", { name: error instanceof Error ? error.name : "UnknownError" });
}

export async function POST(request: Request) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const body = await parseJsonRequest(request, 16 * 1024);
  if (!body.ok) return NextResponse.json({ message: body.reason === "too-large" ? "Registration request is too large." : "Invalid request." }, { status: body.reason === "too-large" ? 413 : 400 });
  const parsed = registrationSchema.safeParse(body.value);
  if (!parsed.success) return NextResponse.json({ message: "Enter your name, a valid email, and a password with at least 10 characters including a number." }, { status: 400 });

  const { name, email, password } = parsed.data;
  const rate = await consumeRegistrationLimit(getRequestIp(request.headers), email);
  if (!rate.allowed) {
    return NextResponse.json(
      { message: rate.unavailable ? "Account registration is temporarily unavailable." : "Too many registration attempts. Please try again later." },
      { status: rate.unavailable ? 503 : 429, headers: rate.retryAfterSeconds > 0 ? { "Retry-After": String(rate.retryAfterSeconds) } : undefined },
    );
  }
  try {
    const passwordHash = await hashPassword(password);
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({ data: { name, email, passwordHash } });
      const workspace = await tx.workspace.create({
        data: { name: `${name.trim().split(/\s+/)[0]}'s workspace`, slug: `workspace-${user.id.slice(0, 8)}`, ownerId: user.id },
      });
      await tx.workspaceMember.create({ data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" } });
      await tx.document.create({
        data: {
          workspaceId: workspace.id,
          createdById: user.id,
          title: "Welcome to NexSpace",
          slug: "welcome-to-nexspace",
          content: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Your workspace is ready. Start writing your first idea here." }] }] },
        },
      });
      await tx.activityLog.create({ data: { workspaceId: workspace.id, actorId: user.id, action: "workspace.created" } });
    });
    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    if (duplicateEmailError(error)) {
      return NextResponse.json({ ok: true }, { status: 201 });
    }
    logRegistrationFailure(error);
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2022") {
      return NextResponse.json({ message: "Account registration is temporarily unavailable while the database schema is updated." }, { status: 503 });
    }
    return NextResponse.json({ message: "We could not create your account. Please try again." }, { status: 500 });
  }
}
