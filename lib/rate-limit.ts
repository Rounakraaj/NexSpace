import { createHmac, randomBytes } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";
import Redis from "ioredis";
import { env } from "./env.ts";

type Bucket = { count: number; resetAt: number };
type RateLimitResult = { allowed: boolean; remaining: number; retryAfterSeconds: number; unavailable?: boolean };
type RedisRateLimitClient = { eval(script: string, keyCount: number, key: string, windowMs: string): Promise<unknown> };
const buckets = new Map<string, Bucket>();
let redis: Redis | null = null;
let redisErrorReported = false;
let redisOverrideForTests: RedisRateLimitClient | null | undefined;
const rateLimitHashSecret = env.NEXTAUTH_SECRET ?? env.AUTH_SECRET ?? randomBytes(32).toString("hex");

export function hashRateLimitKey(key: string): string {
  return createHmac("sha256", rateLimitHashSecret).update(key).digest("hex");
}

function consumeLocalRateLimit(key: string, limit: number, windowMs: number, now: number): RateLimitResult {
  const hashedKey = hashRateLimitKey(key);
  if (buckets.size > 10_000) {
    for (const [currentKey, bucket] of buckets) if (bucket.resetAt <= now) buckets.delete(currentKey);
  }
  const current = buckets.get(hashedKey);
  if (!current || current.resetAt <= now) {
    buckets.set(hashedKey, { count: 1, resetAt: now + windowMs });
    return { allowed: true, remaining: limit - 1, retryAfterSeconds: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil((current.resetAt - now) / 1000)) };
  }
  current.count += 1;
  return { allowed: true, remaining: limit - current.count, retryAfterSeconds: 0 };
}

function getRedis() {
  if (!env.REDIS_URL) return null;
  if (redis) return redis;
  const client = new Redis(env.REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1500,
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    // Keep this shared client alive across outages; requests fail quickly while
    // it reconnects, then resume using Redis without recreating clients.
    retryStrategy: (attempt) => Math.min(attempt * 500, 5_000),
  });
  client.on("error", (error) => {
    if (!redisErrorReported) {
      console.error("Shared rate limiting Redis is unavailable.", error);
      redisErrorReported = true;
    }
  });
  client.on("ready", () => { redisErrorReported = false; });
  redis = client;
  return redis;
}

export async function consumeRateLimitWithRedis(
  client: RedisRateLimitClient,
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): Promise<RateLimitResult> {
  try {
    const result = await client.eval(
      "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; return {count, redis.call('PTTL', KEYS[1])}",
      1,
      `nexspace:rate:${hashRateLimitKey(key)}`,
      String(windowMs),
    ) as [number, number];
    const [count, ttl] = result.map(Number);
    return count > limit
      ? { allowed: false, remaining: 0, retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)) }
      : { allowed: true, remaining: Math.max(0, limit - count), retryAfterSeconds: 0 };
  } catch {
    // A configured but stopped Redis should not block a single-process local
    // development server. Production remains fail-closed because its limits
    // need to be shared across application instances.
    if (process.env.NODE_ENV === "development") {
      if (!redisErrorReported) {
        console.warn("Shared rate limiting Redis is unavailable; using the per-process development fallback.");
        redisErrorReported = true;
      }
      return consumeLocalRateLimit(key, limit, windowMs, now);
    }
    return { allowed: false, remaining: 0, retryAfterSeconds: 1, unavailable: true };
  }
}

export async function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<RateLimitResult> {
  if (process.env.NODE_ENV === "production" && !env.NEXTAUTH_SECRET && !env.AUTH_SECRET) {
    return { allowed: false, remaining: 0, retryAfterSeconds: 1, unavailable: true };
  }
  const client = redisOverrideForTests === undefined ? getRedis() : redisOverrideForTests;
  if (client) return consumeRateLimitWithRedis(client, key, limit, windowMs, now);

  // Production routes rely on a shared counter so multiple instances cannot
  // each grant a separate full limit. A missing Redis URL must fail closed.
  if (process.env.NODE_ENV === "production") {
    return { allowed: false, remaining: 0, retryAfterSeconds: 1, unavailable: true };
  }
  return consumeLocalRateLimit(key, limit, windowMs, now);
}

export async function getRateLimitStatus(): Promise<"shared" | "local" | "unavailable"> {
  if (!env.REDIS_URL) return process.env.NODE_ENV === "production" ? "unavailable" : "local";
  try {
    await getRedis()?.ping();
    return "shared";
  } catch {
    return process.env.NODE_ENV === "development" ? "local" : "unavailable";
  }
}

export function clearRateLimitBucketsForTests() {
  buckets.clear();
}

export function setRateLimitRedisForTests(client: RedisRateLimitClient | null | undefined) {
  redisOverrideForTests = client;
}

export type RateLimitHeaders = Pick<Headers, "get"> | IncomingHttpHeaders;

export function getRequestIp(headers: RateLimitHeaders | undefined): string {
  if (!headers) return "unknown";
  const read = (name: string) => {
    if ("get" in headers && typeof headers.get === "function") {
      const value = headers.get(name);
      if (value) return value;
    }
    const raw = "get" in headers && typeof headers.get === "function"
      ? undefined
      : (headers as IncomingHttpHeaders)[name.toLowerCase()];
    if (Array.isArray(raw)) return raw[0];
    return typeof raw === "string" ? raw : "";
  };
  const forwarded = read("x-forwarded-for");
  const candidate = read("cf-connecting-ip") || read("x-real-ip") || forwarded.split(",")[0]?.trim();
  return candidate?.trim() || "unknown";
}

export async function consumeRegistrationLimit(ip: string, email: string) {
  const ipLimit = await consumeRateLimit(`registration-ip:${ip}`, 5, 60 * 60 * 1000);
  if (!ipLimit.allowed) return ipLimit;
  return consumeRateLimit(`registration-email:${email.toLowerCase()}`, 5, 60 * 60 * 1000);
}

export async function consumeCredentialsLoginLimit(ip: string, email: string) {
  const ipLimit = await consumeRateLimit(`login-ip:${ip}`, 20, 15 * 60 * 1000);
  if (!ipLimit.allowed) return ipLimit;
  return consumeRateLimit(`login-email:${email.toLowerCase()}`, 10, 15 * 60 * 1000);
}
