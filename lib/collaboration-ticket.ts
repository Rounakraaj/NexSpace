import { createHmac, timingSafeEqual } from "node:crypto";

export type CollaborationTicket = { sub: string; documentId: string; exp: number };

function signature(payload: string, secret: string) {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function createCollaborationTicket(input: Omit<CollaborationTicket, "exp">, secret: string, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ ...input, exp: Math.floor(now / 1000) + 300 })).toString("base64url");
  return `${payload}.${signature(payload, secret)}`;
}

export function verifyCollaborationTicket(token: string, secret: string, now = Date.now()): CollaborationTicket | null {
  const [payload, providedSignature, extra] = token.split(".");
  if (!payload || !providedSignature || extra) return null;
  const expected = Buffer.from(signature(payload, secret));
  const actual = Buffer.from(providedSignature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const ticket = parsed as Partial<CollaborationTicket>;
    if (typeof ticket.sub !== "string" || typeof ticket.documentId !== "string" || typeof ticket.exp !== "number") return null;
    if (ticket.exp <= Math.floor(now / 1000)) return null;
    return ticket as CollaborationTicket;
  } catch {
    return null;
  }
}
