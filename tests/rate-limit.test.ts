import assert from "node:assert/strict";
import test from "node:test";
import { clearRateLimitBucketsForTests, consumeRateLimit } from "../lib/rate-limit.ts";

test("rate limiter allows the configured burst then reports retry time", async () => {
  clearRateLimitBucketsForTests();
  assert.equal((await consumeRateLimit("user-a", 2, 60_000, 1_000)).allowed, true);
  assert.equal((await consumeRateLimit("user-a", 2, 60_000, 2_000)).remaining, 0);
  assert.deepEqual(await consumeRateLimit("user-a", 2, 60_000, 3_000), { allowed: false, remaining: 0, retryAfterSeconds: 58 });
});

test("rate limit buckets reset after their window", async () => {
  clearRateLimitBucketsForTests();
  await consumeRateLimit("user-a", 1, 10_000, 10_000);
  assert.equal((await consumeRateLimit("user-a", 1, 10_000, 20_000)).allowed, true);
});

test("production fails closed when shared Redis is not configured", async () => {
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const previousEnvironment = mutableEnvironment.NODE_ENV;
  mutableEnvironment.NODE_ENV = "production";
  clearRateLimitBucketsForTests();
  try {
    assert.deepEqual(await consumeRateLimit("user-production", 1, 60_000), {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 1,
      unavailable: true,
    });
  } finally {
    if (previousEnvironment === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previousEnvironment;
  }
});
