import assert from "node:assert/strict";
import test from "node:test";
import { parseJsonRequest, readBoundedRequestBody } from "../lib/request.ts";

test("JSON request parsing accepts bounded valid payloads", async () => {
  const request = new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ok: true }),
  });
  assert.deepEqual(await parseJsonRequest(request), { ok: true, value: { ok: true } });
});

test("JSON request parsing rejects oversized declared and streamed payloads", async () => {
  const declared = new Request("http://localhost", {
    method: "POST",
    headers: { "content-type": "application/json", "content-length": "20" },
    body: "{}",
  });
  assert.deepEqual(await parseJsonRequest(declared, 10), { ok: false, reason: "too-large" });

  const streamInit = {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"large":"payload"}'));
        controller.close();
      },
    }),
  } as RequestInit;
  const streamed = new Request("http://localhost", streamInit);
  assert.deepEqual(await parseJsonRequest(streamed, 10), { ok: false, reason: "too-large" });
});

test("bounded body reader caps streamed uploads without a content length", async () => {
  const streamInit = {
    method: "POST",
    duplex: "half",
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(11));
        controller.close();
      },
    }),
  } as RequestInit;
  const request = new Request("http://localhost", streamInit);
  assert.deepEqual(await readBoundedRequestBody(request, 10), { ok: false, reason: "too-large" });
});

test("JSON request parsing rejects malformed JSON and invalid UTF-8", async () => {
  const malformed = new Request("http://localhost", { method: "POST", body: "{" });
  assert.deepEqual(await parseJsonRequest(malformed), { ok: false, reason: "invalid" });

  const invalidUtf8 = new Request("http://localhost", {
    method: "POST",
    body: new Uint8Array([0xff]),
  });
  assert.deepEqual(await parseJsonRequest(invalidUtf8), { ok: false, reason: "invalid" });
});
