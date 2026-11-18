import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { canEditDocument, getDocumentAccess } from "@/lib/permissions";
import { isDatabaseConfigured, env } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { uploadPrivateObject, deletePrivateObject } from "@/lib/supabase-storage";
import { consumeRateLimit } from "@/lib/rate-limit";
import { readBoundedRequestBody } from "@/lib/request";

const maxFileSize = 10 * 1024 * 1024;
const mimeTypes: Record<string, { extension: string; signature: (bytes: Uint8Array) => boolean }> = {
  "image/png": { extension: "png", signature: (b) => b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a },
  "image/jpeg": { extension: "jpg", signature: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  "image/gif": { extension: "gif", signature: (b) => b.length >= 6 && ["GIF87a", "GIF89a"].includes(String.fromCharCode(...b.slice(0, 6))) },
  "image/webp": { extension: "webp", signature: (b) => b.length >= 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP" },
};

export async function POST(request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY || !env.SUPABASE_STORAGE_BUCKET) return NextResponse.json({ message: "Supabase Storage is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200 || !access.user) return NextResponse.json({ message: access.status === 401 ? "Authentication required." : "Document not found." }, { status: access.status });
  if (!canEditDocument(access.role)) return NextResponse.json({ message: "You cannot upload to this document." }, { status: 403 });
  const rate = await consumeRateLimit(`upload:${access.user.id}`, 20, 60 * 60 * 1000);
  if (rate.unavailable) return NextResponse.json({ message: "Shared request limiting is temporarily unavailable." }, { status: 503 });
  if (!rate.allowed) return NextResponse.json({ message: "Upload limit reached. Try again later." }, { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } });
  const body = await readBoundedRequestBody(request, maxFileSize + 64 * 1024);
  if (!body.ok) return NextResponse.json({ message: body.reason === "too-large" ? "File exceeds the 10 MB upload limit." : "Upload form is invalid." }, { status: body.reason === "too-large" ? 413 : 400 });
  const contentType = request.headers.get("content-type");
  if (!contentType?.toLowerCase().startsWith("multipart/form-data;")) return NextResponse.json({ message: "Upload form is invalid." }, { status: 400 });
  let form: FormData;
  try {
    form = await new Request(request.url, {
      method: "POST",
      headers: { "content-type": contentType },
      body: Buffer.from(body.bytes),
    }).formData();
  } catch {
    return NextResponse.json({ message: "Upload form is invalid." }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ message: "Choose an image file." }, { status: 400 });
  if (!file.size || file.size > maxFileSize) return NextResponse.json({ message: "File must be smaller than 10 MB." }, { status: 413 });
  const image = mimeTypes[file.type];
  if (!image) return NextResponse.json({ message: "Only PNG, JPEG, GIF, and WebP images are supported." }, { status: 415 });
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!image.signature(bytes)) return NextResponse.json({ message: "File content does not match its image type." }, { status: 415 });

  const document = await prisma.document.findUnique({ where: { id: documentId }, select: { workspaceId: true } });
  if (!document) return NextResponse.json({ message: "Document not found." }, { status: 404 });
  const objectKey = `${document.workspaceId}/${documentId}/${randomUUID()}.${image.extension}`;
  try {
    const stored = await uploadPrivateObject(objectKey, file.type, bytes);
    if (!stored) return NextResponse.json({ message: "Storage rejected the upload." }, { status: 502 });
    const attachment = await prisma.attachment.create({ data: {
      documentId,
      uploaderId: access.user.id,
      filename: file.name.replace(/[\\/\u0000-\u001f]/g, "_").slice(0, 160) || `image.${image.extension}`,
      mimeType: file.type,
      sizeBytes: file.size,
      objectKey,
    }, select: { id: true, filename: true, mimeType: true, sizeBytes: true } });
    return NextResponse.json({ ok: true, attachment, url: `/api/attachments/${attachment.id}/file` }, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) {
    try {
      const removed = await deletePrivateObject(objectKey);
      if (!removed) console.error("Supabase Storage upload rollback could not remove the private object.");
    } catch (cleanupError) {
      console.error("Supabase Storage upload rollback failed", cleanupError);
    }
    console.error("Could not save attachment metadata", error);
    return NextResponse.json({ message: "The image could not be stored." }, { status: 502 });
  }
}
