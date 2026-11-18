export type JsonRequestResult =
  | { ok: true; value: unknown }
  | { ok: false; reason: "invalid" | "too-large" };

export type BoundedRequestBodyResult =
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "invalid" | "too-large" };

export async function readBoundedRequestBody(request: Request, maxBytes: number): Promise<BoundedRequestBodyResult> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) return { ok: false, reason: "invalid" };
    if (Number(declaredLength) > maxBytes) return { ok: false, reason: "too-large" };
  }
  if (!request.body) return { ok: false, reason: "invalid" };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      try {
        await reader.cancel();
      } catch {
        // The size limit still applies if the client has already closed the stream.
      }
      return { ok: false, reason: "too-large" };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes };
}

export async function parseJsonRequest(request: Request, maxBytes = 64 * 1024): Promise<JsonRequestResult> {
  const body = await readBoundedRequestBody(request, maxBytes);
  if (!body.ok) return body;
  try {
    return { ok: true, value: JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body.bytes)) as unknown };
  } catch {
    return { ok: false, reason: "invalid" };
  }
}
