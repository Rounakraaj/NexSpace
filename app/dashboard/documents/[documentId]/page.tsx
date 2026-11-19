import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentUser, getDocumentAccess } from "@/lib/permissions";
import { DocumentEditor } from "@/components/editor/document-editor";
import { getCanvasSyncUrl, getPageCollaborationUrl } from "@/lib/env";

export const instant = false;

export default async function DocumentPage({ params }: { params: Promise<{ documentId: string }> }) {
  // Session and document authorization are request-specific.
  await connection();
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const { documentId } = await params;
  const access = await getDocumentAccess(documentId);
  if (access.status === 401) redirect("/login");
  if (access.status !== 200 || !access.role) notFound();
  const collaborationUrl = getPageCollaborationUrl();
  const canvasUrl = getCanvasSyncUrl();
  return <DocumentEditor documentId={documentId} canEdit={access.role === "OWNER" || access.role === "EDITOR"} canComment={access.role !== "VIEWER"} userId={user.id} collaborationUrl={collaborationUrl} canvasUrl={canvasUrl} userName={user.name ?? user.email ?? "Teammate"} licenseKey={process.env.TLDRAW_LICENSE_KEY} aiAvailable={Boolean(process.env.OPENAI_API_KEY)} />;
}
