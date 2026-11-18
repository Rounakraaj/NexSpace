# Development Progress

Updated: 2026-11-18

## Canvas connection repair and live schema verification

- The active ignored .env lacked CANVAS_URL, NEXT_PUBLIC_CANVAS_URL, CANVAS_PORT, and COLLABORATION_SECRET, which caused the editor's "Canvas sync is not configured" error. Added local ws://localhost:1235 values and generated a private 256-bit signing secret without printing it.
- Added a development-only localhost fallback, kept production URL configuration explicit, and improved Canvas loading/error/retry handling plus browser offline/online recovery. The client fetches a fresh signed collaboration ticket on each new session; the existing server rechecks document/workspace membership and edit role, and persists tldraw snapshots to PostgreSQL.
- Read-only introspection via DATABASE_URL and DIRECT_URL reports the same Supabase host, postgres database, public schema, role, and search_path. Prisma schema diffs against both live endpoints are empty, covering all model fields/types, enums, indexes, and relations. Both passwordHash and collaborationState are present as nullable text/bytea columns.
- A later read-only `npx prisma migrate status` reported six migrations and an up-to-date database. This confirms migration metadata status only; it is not proof of safe live application behavior.
- Started the real Canvas service and opened a signed WebSocket as the owner of an existing Canvas document; the service authorized membership, loaded the room, and returned HTTP 101. The smoke test made no document changes.

## Completed phases

- Backend foundation, Prisma singleton, environment parsing, shared validation and role policy.
- Credentials registration/login with scrypt hashes and optional Google OAuth. Registration creates a private owner workspace, membership, welcome page, and activity record in a transaction.
- Authenticated workspace and document CRUD, membership authorization, role checks, nested parent validation, duplicate/move APIs, comments/replies/resolve, snapshots and restore APIs.
- Database-backed `/dashboard`, workspace switching, member/invitation management, pending invite revocation, and signed-in invitation acceptance. Invite links are returned for the owner to share; an email sender is not configured.
- Tiptap page editor with formatting, tables, tasks, links, images by HTTPS URL, title edits, local autosave, Hocuspocus/Yjs live mode, cursors/presence, and a local-save fallback.
- Durable Yjs state in PostgreSQL, with collaboration ticket authentication and role checks. Optional Hocuspocus Redis fanout is implemented.
- Editor comments and history panels support threads/replies, resolve/reopen, snapshot preview, manual snapshot, and restore.
- Collaborative tldraw canvas with a separate authenticated WebSocket service, per-document rooms, readonly role enforcement, debounced PostgreSQL snapshot persistence, dashboard canvas creation, and authenticated Supabase image upload/download routes.
- Optional streaming AI Copilot using the Vercel AI SDK and OpenAI provider. It supports summary, drafting, rewrite, improve, explain, and brainstorm actions. Its server-only API key is optional; actions are disabled with a configuration message when it is absent.
- Global dashboard command palette with keyboard shortcut, title-based cross-workspace search, workspace switching, page/canvas creation, and people settings shortcut.
- Added fixed-window rate limits for invitations, AI generation, uploads, and search. A configured Redis URL provides atomic shared limits; single-process development falls back to an in-memory limiter. Uploads also enforce request/file size and MIME-signature checks.
- Added registration and credentials-login limits, generic duplicate-email responses, dummy password verification for unknown accounts, and HMAC-keyed identifiers in both Redis and local buckets. Production requires the shared Auth.js secret and Redis for rate-limited paths.
- Added bounded streaming JSON parsing for API request bodies and sanitized unexpected 5xx messages from collaboration control endpoints.
- Added `/api/health` readiness reporting for PostgreSQL/Auth.js and optional integration configuration.
- Updated architecture, API, security, deployment, database, testing, and setup documentation.

## Current boundaries and deployment blockers

- `/` remains a browser-local preview; authenticated PostgreSQL use is `/dashboard`.
- A prior read-only migration status check reported six migrations and an up-to-date database. Recheck that status after deployments; never reset or overwrite production data.
- No authenticated browser was available for two-user visual editing. Multi-user sync, reconnect behavior in a browser, two-browser presence, and Redis fanout still need browser/infrastructure validation.
- Canvas sync rooms are held by one canvas-service process. Do not horizontally scale this service behind a load balancer without room affinity or a distributed room coordinator. Hocuspocus Redis fanout does not coordinate tldraw rooms.
- tldraw's SDK requires an appropriate license for production use. Configure `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` according to the project's licensing terms before commercial deployment.
- Supabase Storage requires a private bucket plus `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`. The integration is implemented but was not exercised without credentials.
- AI requires `OPENAI_API_KEY`; `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Provider calls and streamed output were not exercised without credentials. Redis-backed limits are implemented but were not exercised without Redis credentials; local development falls back to process memory.
- Outstanding roadmap work includes isolated database-backed integration fixtures, Playwright critical flows, k6/WebSocket load validation, canvas room scaling, content search, nested-page/tree navigation, workspace visibility/settings, cover images, email delivery, notification UI, operational metrics/backup configuration, and verified production deployment.

## Verification

- `npx prisma validate`: passed.
- `npx prisma generate`: previously passed; a prior rerun hit Windows EPERM replacing the Prisma engine DLL while other Node processes were already running. A subsequent production build's TypeScript phase passed.
- `npx tsc --noEmit`: passed in the final verification pass.
- `npm run lint`: passed.
- `npm test`: 45 passed in the final verification pass.
- `npm audit`: 0 vulnerabilities after removing the unused shadcn CLI and pinning the fixed minimatch release under the ESLint parser dependency.
- `npm audit --omit=dev`: 0 production dependency advisories.
- `npm run build`: passed in the final verification pass. `/api/health` is request-time and requires shared Redis for production readiness.
- `npm run collab`: local Hocuspocus startup smoke check passed in the prior pass.
- Canvas HTTP health returned nexspace-canvas:ok; an authorized existing-document WebSocket handshake returned HTTP 101.
- Read-only Prisma introspection and migrate diff against both DATABASE_URL and DIRECT_URL: both live schema diffs were empty.
- `npx prisma migrate status`: last read-only check reported six migrations and an up-to-date database. No migrations were applied by the audit.

## Next implementation task

Configure deployed WebSocket endpoints, Redis, Supabase Storage, OpenAI, and the tldraw production license. Establish Prisma migration history safely if production will use migrate deploy. Verify two-client Yjs/tldraw synchronization, reconnect behavior, asset authorization, AI streaming, invite acceptance, and Redis cross-instance behavior. Add integration/browser/load tests and production monitoring before release.
