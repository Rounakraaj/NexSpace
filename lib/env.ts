import { z } from "zod";

const optionalUrlWithProtocols = (...protocols: string[]) => z.preprocess((value) => {
  if (typeof value !== "string" || value.trim() === "") return undefined;
  if (!value.includes("://") && /^(your|replace-me|placeholder)/i.test(value)) return undefined;
  return value;
}, z.string().url().refine((value) => protocols.includes(new URL(value).protocol), `URL must use ${protocols.join(" or ")}`).optional());
const optionalString = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().optional());
const optionalSecret = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().min(32).optional());

const envSchema = z.object({
  DATABASE_URL: optionalUrlWithProtocols("postgres:", "postgresql:"),
  DIRECT_URL: optionalUrlWithProtocols("postgres:", "postgresql:"),
  NEXTAUTH_URL: optionalUrlWithProtocols("http:", "https:"),
  NEXTAUTH_SECRET: optionalString,
  AUTH_TRUST_HOST: z.string().optional(),
  AUTH_SECRET: optionalString,
  GOOGLE_CLIENT_ID: optionalString,
  GOOGLE_CLIENT_SECRET: optionalString,
  REDIS_URL: optionalUrlWithProtocols("redis:", "rediss:"),
  COLLABORATION_REDIS_ENABLED: z.enum(["true", "false"]).optional(),
  COLLABORATION_URL: optionalUrlWithProtocols("ws:", "wss:"),
  NEXT_PUBLIC_COLLABORATION_URL: optionalUrlWithProtocols("ws:", "wss:"),
  COLLABORATION_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  COLLABORATION_SECRET: optionalSecret,
  CANVAS_URL: optionalUrlWithProtocols("ws:", "wss:"),
  NEXT_PUBLIC_CANVAS_URL: optionalUrlWithProtocols("ws:", "wss:"),
  CANVAS_PORT: z.coerce.number().int().min(1).max(65535).optional(),
  NEXT_PUBLIC_TLDRAW_LICENSE_KEY: optionalString,
  OPENAI_API_KEY: optionalString,
  OPENAI_MODEL: optionalString,
  SUPABASE_URL: optionalUrlWithProtocols("http:", "https:"),
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  SUPABASE_STORAGE_BUCKET: optionalString,
});

export const env = envSchema.parse(process.env);

export function isDatabaseConfigured() {
  return Boolean(env.DATABASE_URL);
}

export function getCanvasSyncUrl() {
  return env.NEXT_PUBLIC_CANVAS_URL?.trim()
    || (process.env.NODE_ENV === "development" ? env.CANVAS_URL?.trim() || "ws://localhost:1235" : "");
}

export function getPageCollaborationUrl() {
  return env.NEXT_PUBLIC_COLLABORATION_URL?.trim()
    || (process.env.NODE_ENV === "development" ? env.COLLABORATION_URL?.trim() || "ws://localhost:1234" : "");
}
