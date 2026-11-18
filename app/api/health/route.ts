import { NextResponse } from "next/server";
import { env, getCanvasSyncUrl } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { getRateLimitStatus } from "@/lib/rate-limit";

export async function GET(request: Request) {
  // This readiness probe must run per request and must never touch PostgreSQL during prerender.
  void request.url;
  const authConfigured = Boolean(env.NEXTAUTH_SECRET ?? env.AUTH_SECRET);
  const sharedRateLimit = await getRateLimitStatus();
  let database: "ok" | "unconfigured" | "unavailable" = "unconfigured";
  if (env.DATABASE_URL) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      database = "ok";
    } catch {
      database = "unavailable";
    }
  }
  const ready = authConfigured && database === "ok";
  return NextResponse.json({
    ok: ready,
    checks: {
      database,
      authentication: authConfigured ? "configured" : "unconfigured",
      pageCollaboration: Boolean(env.COLLABORATION_SECRET && (env.NEXT_PUBLIC_COLLABORATION_URL || (process.env.NODE_ENV === "development" && env.COLLABORATION_URL))),
      canvas: Boolean(env.COLLABORATION_SECRET && getCanvasSyncUrl()),
      ai: Boolean(env.OPENAI_API_KEY),
      storage: Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY && env.SUPABASE_STORAGE_BUCKET),
      sharedRateLimit,
    },
  }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}
