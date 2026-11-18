import { NextResponse } from "next/server";
import { getCurrentUser, getWorkspaceRole, canEditDocument } from "@/lib/permissions";
import { isDatabaseConfigured } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { deletePrivateObject, downloadPrivateObject } from "@/lib/supabase-storage";

async function authorizedAttachment(attachmentId: string) {
  const user = await getCurrentUser();
  if (!user) return { status: 401 as const };
  const attachment = await prisma.attachment.findFirst({
    where: {
      id: attachmentId,
      document: { workspace: { OR: [{ ownerId: user.id }, { members: { some: { userId: user.id } } }] } },
    },
    select: { id: true, documentId: true, uploaderId: true, filename: true, mimeType: true, sizeBytes: true, objectKey: true, document: { select: { workspaceId: true } } },
  });
  if (!attachment) return { status: 404 as const };
  const role = await getWorkspaceRole(attachment.document.workspaceId, user.id);
  if (!role) return { status: 404 as const };
  return { status: 200 as const, user, role, attachment };
}

function contentDispositionFilename(filename: string) {
  const fallback = filename.replace(/[^\x20-\x7e"\\]/g, "_");
  const encoded = encodeURIComponent(filename).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  return `inline; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const { attachmentId } = await params;
  const result = await authorizedAttachment(attachmentId);
  if (result.status !== 200) return NextResponse.json({ message: result.status === 401 ? "Authentication required." : "Image not found." }, { status: result.status });
  try {
    const stored = await downloadPrivateObject(result.attachment.objectKey);
    if (!stored.ok) return NextResponse.json({ message: "Image is unavailable." }, { status: 502 });
    return new Response(stored.body, { status: 200, headers: {
      "Content-Type": result.attachment.mimeType,
      "Content-Length": String(result.attachment.sizeBytes),
      "Content-Disposition": contentDispositionFilename(result.attachment.filename),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    console.error("Supabase Storage download failed", error);
    return NextResponse.json({ message: "Image is unavailable." }, { status: 502 });
  }
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ attachmentId: string }> }) {
  if (!isDatabaseConfigured()) return NextResponse.json({ message: "Database is not configured." }, { status: 503 });
  const { attachmentId } = await params;
  const result = await authorizedAttachment(attachmentId);
  if (result.status !== 200) return NextResponse.json({ message: result.status === 401 ? "Authentication required." : "Image not found." }, { status: result.status });
  if (!canEditDocument(result.role) && result.user.id !== result.attachment.uploaderId) return NextResponse.json({ message: "You cannot remove this image." }, { status: 403 });
  try {
    const removed = await deletePrivateObject(result.attachment.objectKey);
    if (!removed) return NextResponse.json({ message: "Storage could not remove the image." }, { status: 502 });
    await prisma.attachment.delete({ where: { id: attachmentId } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Attachment storage or database deletion failed", error);
    return NextResponse.json({ message: "The image could not be removed." }, { status: 502 });
  }
}
