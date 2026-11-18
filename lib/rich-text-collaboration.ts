import "server-only";
import { createCollaborationTicket } from "@/lib/collaboration-ticket";
import { env, getPageCollaborationUrl } from "@/lib/env";

export type RichTextCommand = "replace" | "restore" | "delete";

export class RichTextCommandError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "RichTextCommandError";
  }
}

export function isRichTextCollaborationConfigured() {
  return Boolean(env.COLLABORATION_SECRET && getPageCollaborationUrl());
}

export async function sendRichTextCommand(
  documentId: string,
  userId: string,
  command: RichTextCommand,
  body: Record<string, unknown> = {},
) {
  if (!env.COLLABORATION_SECRET) {
    throw new RichTextCommandError("Live collaboration is not configured.", 503);
  }
  const wsUrl = getPageCollaborationUrl();
  if (!wsUrl) {
    throw new RichTextCommandError("The collaboration service URL is not configured.", 503);
  }

  const endpoint = new URL(wsUrl);
  endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
  endpoint.pathname = `/internal/rich-text/${encodeURIComponent(documentId)}/${command}`;
  endpoint.search = "";
  endpoint.hash = "";

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${createCollaborationTicket({ sub: userId, documentId }, env.COLLABORATION_SECRET)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    console.error("Could not reach the rich-text collaboration service.", error);
    throw new RichTextCommandError("The collaboration service is unavailable.", 503);
  }

  const result = await response.json().catch(() => ({})) as { message?: string };
  if (!response.ok) {
    throw new RichTextCommandError(result.message ?? "The collaboration service rejected the document operation.", response.status);
  }
  return result;
}
