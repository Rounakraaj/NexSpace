import "server-only";
import { createCollaborationTicket } from "@/lib/collaboration-ticket";
import { env, getCanvasSyncUrl } from "@/lib/env";

export type CanvasCommand = "snapshot" | "restore" | "delete";

export class CanvasCommandError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "CanvasCommandError";
  }
}

export async function sendCanvasCommand(
  documentId: string,
  userId: string,
  command: CanvasCommand,
  body: Record<string, unknown> = {},
) {
  if (!env.COLLABORATION_SECRET) {
    throw new CanvasCommandError("Canvas collaboration is not configured.", 503);
  }
  const wsUrl = env.CANVAS_URL?.trim() || getCanvasSyncUrl();
  if (!wsUrl) {
    throw new CanvasCommandError("The Canvas service URL is not configured.", 503);
  }

  const endpoint = new URL(wsUrl);
  endpoint.protocol = endpoint.protocol === "wss:" ? "https:" : "http:";
  endpoint.pathname = `/internal/canvas/${encodeURIComponent(documentId)}/${command}`;
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
    console.error("Could not reach the Canvas collaboration service.", error);
    throw new CanvasCommandError("The Canvas service is unavailable.", 503);
  }

  const result = await response.json().catch(() => ({})) as { message?: string } & Record<string, unknown>;
  if (!response.ok) {
    throw new CanvasCommandError(result.message ?? "The Canvas service rejected the document operation.", response.status);
  }
  return result;
}
