import assert from "node:assert/strict";
import test from "node:test";
import {
  clearRateLimitBucketsForTests,
  consumeCredentialsLoginLimit,
  consumeRateLimit,
  consumeRateLimitWithRedis,
  consumeRegistrationLimit,
  getRequestIp,
  hashRateLimitKey,
  setRateLimitRedisForTests,
} from "../lib/rate-limit.ts";

setRateLimitRedisForTests(null);

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

test("registration and login limits have allowed bursts and blocked retry states", async () => {
  clearRateLimitBucketsForTests();
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const previousEnvironment = mutableEnvironment.NODE_ENV;
  mutableEnvironment.NODE_ENV = "development";
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await consumeRegistrationLimit("192.0.2.10", "ada@example.com")).allowed, true);
    }
    assert.equal((await consumeRegistrationLimit("192.0.2.10", "ada@example.com")).allowed, false);

    clearRateLimitBucketsForTests();
    for (let attempt = 0; attempt < 10; attempt++) {
      assert.equal((await consumeCredentialsLoginLimit("192.0.2.20", "ada@example.com")).allowed, true);
    }
    assert.equal((await consumeCredentialsLoginLimit("192.0.2.20", "ada@example.com")).allowed, false);
  } finally {
    if (previousEnvironment === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previousEnvironment;
  }
});

test("email rate-limit keys normalize email and IP limits are independent", async () => {
  clearRateLimitBucketsForTests();
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const previousEnvironment = mutableEnvironment.NODE_ENV;
  mutableEnvironment.NODE_ENV = "development";
  try {
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await consumeRegistrationLimit(`ip-${attempt}`, "ada@example.com")).allowed, true);
    }
    assert.equal((await consumeRegistrationLimit("another-ip", "ADA@EXAMPLE.COM")).allowed, false);

    clearRateLimitBucketsForTests();
    for (let attempt = 0; attempt < 5; attempt++) {
      assert.equal((await consumeRegistrationLimit("same-ip", `user-${attempt}@example.com`)).allowed, true);
    }
    assert.equal((await consumeRegistrationLimit("same-ip", "another@example.com")).allowed, false);
  } finally {
    if (previousEnvironment === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previousEnvironment;
  }
});

test("rate-limit identifiers are hashed before storage", () => {
  const key = hashRateLimitKey("registration-email:ada@example.com");
  assert.match(key, /^[a-f0-9]{64}$/);
  assert.equal(key.includes("ada@example.com"), false);
});

test("concurrent rate-limit requests cannot exceed the configured burst", async () => {
  clearRateLimitBucketsForTests();
  const results = await Promise.all(
    Array.from({ length: 25 }, () => consumeRateLimit("concurrent-user", 7, 60_000)),
  );
  assert.equal(results.filter((result) => result.allowed).length, 7);
});

test("Redis operation failure fails closed in production", async () => {
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const previousEnvironment = mutableEnvironment.NODE_ENV;
  mutableEnvironment.NODE_ENV = "production";
  try {
    const unavailableRedis = { eval: async () => { throw new Error("Redis unavailable"); } };
    assert.deepEqual(
      await consumeRateLimitWithRedis(unavailableRedis, "login-email:ada@example.com", 10, 60_000),
      { allowed: false, remaining: 0, retryAfterSeconds: 1, unavailable: true },
    );
  } finally {
    if (previousEnvironment === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previousEnvironment;
  }
});

test("Redis operation failure uses the local development fallback", async () => {
  clearRateLimitBucketsForTests();
  const mutableEnvironment = process.env as Record<string, string | undefined>;
  const previousEnvironment = mutableEnvironment.NODE_ENV;
  mutableEnvironment.NODE_ENV = "development";
  try {
    const unavailableRedis = { eval: async () => { throw new Error("Redis unavailable"); } };
    assert.equal((await consumeRateLimitWithRedis(unavailableRedis, "login-email:ada@example.com", 1, 60_000)).allowed, true);
    assert.equal((await consumeRateLimitWithRedis(unavailableRedis, "login-email:ada@example.com", 1, 60_000)).allowed, false);
  } finally {
    if (previousEnvironment === undefined) delete mutableEnvironment.NODE_ENV;
    else mutableEnvironment.NODE_ENV = previousEnvironment;
  }
});

test("concurrent Redis increments enforce one hashed shared bucket", async () => {
  let count = 0;
  const keys: string[] = [];
  const redis = {
    eval: async (_script: string, _keyCount: number, key: string) => {
      keys.push(key);
      count += 1;
      return [count, 60_000];
    },
  };
  const results = await Promise.all(
    Array.from({ length: 25 }, () => consumeRateLimitWithRedis(redis, "login-email:ada@example.com", 7, 60_000)),
  );
  assert.equal(results.filter((result) => result.allowed).length, 7);
  assert.deepEqual(new Set(keys), new Set([`nexspace:rate:${hashRateLimitKey("login-email:ada@example.com")}`]));
  assert.equal(keys.some((key) => key.includes("ada@example.com")), false);
});

test("client IP prefers proxy-aware headers and falls back safely", () => {
  assert.equal(getRequestIp({ get: (name) => name === "cf-connecting-ip" ? "203.0.113.8" : null }), "203.0.113.8");
  assert.equal(getRequestIp({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }), "198.51.100.4");
  assert.equal(getRequestIp(undefined), "unknown");
});
