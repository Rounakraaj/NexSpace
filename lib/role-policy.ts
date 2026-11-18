export type WorkspaceRole = "OWNER" | "EDITOR" | "COMMENTER" | "VIEWER";

export function canReadWorkspace(role?: WorkspaceRole | null) {
  return role != null;
}

export function canManageWorkspace(role?: WorkspaceRole | null) {
  return role === "OWNER";
}

export function canEditDocument(role?: WorkspaceRole | null) {
  return role === "OWNER" || role === "EDITOR";
}

export function canComment(role?: WorkspaceRole | null) {
  return role === "OWNER" || role === "EDITOR" || role === "COMMENTER";
}
