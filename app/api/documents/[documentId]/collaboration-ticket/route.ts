import { NextResponse } from "next/server";
import { getDocumentAccess } from "@/lib/permissions";
import { env } from "@/lib/env";
import { createCollaborationTicket } from "@/lib/collaboration-ticket";

export async function GET(_request: Request, { params }: { params: Promise<{ documentId: string }> }) {
  if (!env.COLLABORATION_SECRET) return NextResponse.json({ message: "Live collaboration is not configured." }, { status: 503 });
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status !== 200 || !access.user) {
    const status = access.status === 401 ? 401 : 404;
    return NextResponse.json({ message: status === 401 ? "Authentication required." : "Document not found." }, { status });
  }
  return NextResponse.json({ token: createCollaborationTicket({ sub: access.user.id, documentId }, env.COLLABORATION_SECRET) }, {
    headers: { "Cache-Control": "no-store, private" },
  });
}
