# API Documentation

JSON routes derive identity from the Auth.js session, except public registration and Auth.js endpoints. Bodies are byte-limited during parsing (64 KB by default, 16 KB for registration, 12 KB for AI, and 1.5 MB for document content). Database routes return `503` when `DATABASE_URL` is absent. Workspace membership is checked server-side; unknown and inaccessible workspace/document IDs are returned as not found.

- `GET /api/health` — no-store readiness check for PostgreSQL/Auth.js and configuration flags for optional integrations. Production returns `503` when PostgreSQL, shared Redis, or the Auth.js secret is not ready.

## Authentication

- `GET/POST /api/auth/[...nextauth]` — Auth.js handlers. Google OAuth is registered only when both OAuth credentials exist. Credentials attempts are limited to ten per normalized email and twenty per IP per 15 minutes.
- `POST /api/register` — validates and creates a credentials account plus its initial workspace, owner membership, welcome page, and activity log in one transaction. Limited to five attempts per normalized email and per IP per hour. Duplicate-email requests return the same response as a new registration to avoid account enumeration.
- `GET /login` — credentials sign-in and registration page; Google OAuth appears when configured.

## Workspaces

- `GET /api/workspaces` — list only workspaces owned by or joined by the current user.
- `POST /api/workspaces` — create a workspace; actor becomes owner. Body: `{ "name": string, "description?": string }`.
- `PATCH /api/workspaces/:workspaceId` — owner-only update. Body accepts `name` and/or `description`.
- `DELETE /api/workspaces/:workspaceId` — owner-only delete.
- `GET /api/workspaces/:workspaceId/members` — list members; owners also receive pending invitation metadata.
- `POST /api/workspaces/:workspaceId/members` — owner-only invitation creation. Body: `{ "email": string, "role?": "EDITOR"|"COMMENTER"|"VIEWER" }`. Returns a one-time invite URL; token hash only is stored.
- `PATCH /api/workspaces/:workspaceId/members/:memberId` — owner-only role update; owners cannot be demoted here.
- `DELETE /api/workspaces/:workspaceId/members/:memberId` — owner-only member removal.
- `DELETE /api/workspaces/:workspaceId/invitations/:invitationId` — owner-only pending invitation revocation.
- `POST /api/invitations/accept` — signed-in user accepts a token matching their account email. Body: `{ "token": string }`.

## Documents

- `GET /api/documents?workspaceId=...` — list documents after confirming current membership.
- `POST /api/documents` — owner/editor creates a page or canvas. Body: `{ "workspaceId": uuid, "title": string, "parentId?": uuid|null, "type?": "PAGE"|"CANVAS" }`.
- `GET /api/documents/:documentId` — read a document for any workspace member.
- `PATCH /api/documents/:documentId` — owner/editor update title, page content, favorite, or parent. JSON body is limited to 1.5 MB. Canvas content is saved through its sync service.
- `GET /api/documents/:documentId/collaboration-ticket` — issues a five-minute signed ticket after checking workspace access. Used by Hocuspocus and tldraw sync.
- `DELETE /api/documents/:documentId` — owner/editor delete.
- `POST /api/documents/:documentId/duplicate` — owner/editor creates a copy in the same workspace and parent.
- `GET/POST /api/documents/:documentId/comments` — read threads or add an anchored comment (commenter/editor/owner).
- `POST /api/comments/:commentId/replies` — add a reply for a member with comment permission.
- `PATCH /api/comments/:commentId` — owner/editor or the comment author resolves/reopens a comment.
- `GET/POST /api/documents/:documentId/snapshots` — list up to 100 versions or create a manual snapshot (owner/editor).
- `POST /api/documents/:documentId/snapshots/:snapshotId/restore` — restore a version; current state is saved first.
- `POST /api/documents/:documentId/ai` — authenticated, shared Redis rate-limited streaming AI task in production (per-process fallback in development) using page content and selected text. Requires server-side `OPENAI_API_KEY`; canvas is not supported.
- `POST /api/documents/:documentId/attachments` — editor-only PNG/JPEG/GIF/WebP upload up to 10 MB to configured private Supabase Storage.
- `GET/DELETE /api/attachments/:attachmentId/file` — membership-authorized image retrieval or editor/uploader removal. Responses are private and not cached.
- `GET /api/search?q=...` — search accessible workspace and document titles (2 to 80 characters); results are not cached.

Page collaboration uses a separate Hocuspocus process. Canvas WebSockets use the separate tldraw sync process at `/connect/:documentId`; both verify the same short-lived ticket and current membership.
