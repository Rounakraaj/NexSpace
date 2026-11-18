import "server-only";
import { env } from "@/lib/env";

function configuration() {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_STORAGE_BUCKET) {
    throw new Error("Supabase Storage is not configured.");
  }
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(env.SUPABASE_STORAGE_BUCKET)) throw new Error("Supabase storage bucket name is invalid.");
  return { base: env.SUPABASE_URL.replace(/\/$/, ""), key: env.SUPABASE_SERVICE_ROLE_KEY, bucket: env.SUPABASE_STORAGE_BUCKET };
}

function objectUrl(base: string, bucket: string, objectKey: string) {
  const path = objectKey.split("/").map(encodeURIComponent).join("/");
  return `${base}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`;
}

export async function uploadPrivateObject(objectKey: string, contentType: string, bytes: Uint8Array) {
  const { base, key, bucket } = configuration();
  const response = await fetch(objectUrl(base, bucket, objectKey), {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": contentType, "x-upsert": "false" },
    body: Buffer.from(bytes),
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) console.error("Supabase Storage upload request failed", { status: response.status });
  return response.ok;
}

export async function downloadPrivateObject(objectKey: string) {
  const { base, key, bucket } = configuration();
  const response = await fetch(objectUrl(base, bucket, objectKey), {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) console.error("Supabase Storage download request failed", { status: response.status });
  return response;
}

export async function deletePrivateObject(objectKey: string) {
  const { base, key, bucket } = configuration();
  const path = objectKey.split("/").map(encodeURIComponent).join("/");
  const response = await fetch(`${base}/storage/v1/object/${encodeURIComponent(bucket)}/${path}`, {
    method: "DELETE",
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) console.error("Supabase Storage delete request failed", { status: response.status });
  return response.ok;
}

export async function deletePrivateObjects(objectKeys: string[]) {
  let failed = 0;
  const deadline = Date.now() + 30_000;
  for (let offset = 0; offset < objectKeys.length; offset += 8) {
    if (Date.now() >= deadline) return failed + objectKeys.length - offset;
    const batch = objectKeys.slice(offset, offset + 8);
    const results = await Promise.allSettled(batch.map(deletePrivateObject));
    for (const result of results) {
      if (result.status === "rejected" || !result.value) failed += 1;
    }
  }
  return failed;
}
