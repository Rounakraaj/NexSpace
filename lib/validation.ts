import { z } from "zod";

export const registrationSchema = z.object({
  name: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(10).max(128).regex(/[a-z]/i).regex(/[0-9]/),
});

function hasSafeEditorUrls(value: unknown, depth = 0): boolean {
  if (depth > 60) return false;
  if (Array.isArray(value)) return value.every((item) => hasSafeEditorUrls(item, depth + 1));
  if (!value || typeof value !== "object") return true;
  const node = value as Record<string, unknown>;
  if (node.type === "image") {
    const src = (node.attrs as Record<string, unknown> | undefined)?.src;
    if (typeof src !== "string" || !isAllowedEditorUrl(src, ["https:"])) return false;
  }
  if (node.type === "link") {
    const href = (node.attrs as Record<string, unknown> | undefined)?.href;
    if (typeof href !== "string" || !isAllowedEditorUrl(href, ["http:", "https:", "mailto:"])) return false;
  }
  return Object.values(node).every((item) => hasSafeEditorUrls(item, depth + 1));
}

function isAllowedEditorUrl(value: string, protocols: string[]) {
  try { return protocols.includes(new URL(value).protocol); } catch { return false; }
}

export const editorContentSchema = z.unknown().refine(
  (value) => typeof value === "object" && value !== null && !Array.isArray(value) && hasSafeEditorUrls(value),
  "Editor content must be a safe rich-text document.",
);

export const invitationCreateSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  role: z.enum(["EDITOR", "COMMENTER", "VIEWER"]).default("VIEWER"),
});

export const memberRoleSchema = z.object({ role: z.enum(["EDITOR", "COMMENTER", "VIEWER"]) });

export const invitationAcceptSchema = z.object({ token: z.string().min(40).max(200) });

export const aiCopilotSchema = z.object({
  action: z.enum(["summarize", "generate", "rewrite", "improve", "explain", "brainstorm"]),
  selection: z.string().trim().max(8_000).optional().default(""),
  instruction: z.string().trim().max(2_000).optional().default(""),
});

export const workspaceCreateSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
});

export const workspaceUpdateSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).nullable().optional(),
}).refine((value) => value.name !== undefined || value.description !== undefined);

export const documentCreateSchema = z.object({
  title: z.string().trim().min(1).max(120),
  workspaceId: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  type: z.enum(["PAGE", "CANVAS"]).default("PAGE"),
});

export const documentUpdateSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  content: z.unknown().optional(),
  baseUpdatedAt: z.string().datetime().optional(),
  favorite: z.boolean().optional(),
  parentId: z.string().uuid().nullable().optional(),
}).refine((value) => Object.keys(value).length > 0);
