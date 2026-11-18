# NexSpace Project Audit

**Updated:** 2026-11-18

## Repository

- Root App Router project (`app/`, no `src/`) with strict TypeScript, Next.js 16, React 19, Tailwind CSS v4, and Base UI shadcn-style primitives.
- The premium dashboard in `app/page.tsx` is a responsive browser-local preview with sample data, search, favorites, page editing, and local storage.
- `/login` supports email/password registration and login via Auth.js credentials, with optional Google OAuth. Registration creates a default owner workspace and welcome page.
- `prisma/schema.prisma` includes Auth.js identity/session models and tenant-scoped workspace, membership, document, comment/reply, snapshot, invitation, attachment, and activity models. An initial migration exists.
- Authenticated API routes provide workspace/document CRUD with workspace membership checks and role gates.

## Findings and risks

- `/dashboard` reads the signed-in user's PostgreSQL workspaces and uses the authenticated APIs for workspace/document management. `/` remains a browser-local preview.
- `/dashboard/documents/:id` routes to a Tiptap page editor or a tldraw canvas. Hocuspocus/Yjs persists page state; a separate tldraw sync service persists room snapshots to PostgreSQL and enforces readonly roles. Both use short-lived signed tickets.
- The editor includes comments/history panels and a server-streamed optional AI Copilot. A global command palette searches accessible workspace/document titles. Invitation links and member administration are wired to the existing models.
- Supabase private object storage upload/download is implemented for canvas images, with authenticated attachment records and MIME/signature/size checks.
- Registration/login and live collaboration have not been exercised end to end. A prior read-only `prisma migrate status` reported six migrations and an up-to-date database; it did not test application reads/writes.
- Live database integration, multi-client browser tests, Redis fanout, Supabase uploads, OpenAI calls, and tldraw room synchronization have not been exercised against configured services. Canvas service is single-process and requires room affinity before horizontal scale-out. tldraw production licensing must be configured.
- The original insecure demo credential behavior was removed: no demo account is accepted or created by requests.
- `next.config.ts` retains the installed Turbopack CSS loader; Tailwind is imported in `app/globals.css`; reduced-motion behavior is present.

## 2026-11-18 authentication and API hardening

- Registration is limited by normalized email and client IP: 5 attempts per email and 5 attempts per IP per hour. The duplicate-email response is generic and does not reveal account existence.
- Credentials login is limited by normalized email and client IP: 10 attempts per email and 20 attempts per IP per 15 minutes. Both limits return generic authentication failure for repeated attempts, while Google OAuth remains unchanged.
- Unknown credentials accounts perform a dummy scrypt verification; invalid credentials are not exposed through user-facing error messages.
- Rate-limit identifiers use HMAC-SHA-256 for both Redis and local fallback keys. Redis uses an atomic increment/expiry script. Production requires a shared Auth.js signing secret and `REDIS_URL` and fails closed if either is missing or Redis operations fail; development uses an in-memory fallback.
- API JSON bodies are size-limited during stream parsing (64 KB default; 16 KB registration; 12 KB AI; 1.5 MB document content). Errors from collaboration services with status 5xx are sanitized before returning to clients.
- Focused unit tests cover rate-limit bursts, normalized identifiers, hashed key shape, local and fake-Redis concurrency, simulated Redis failures, and bounded JSON parsing. They do not execute registration or NextAuth against PostgreSQL.
- A local production-build smoke check returned HTTP 200 for `/` and `/login`, HTTP 400 for an invalid registration payload, and HTTP 503 for `/api/health`. Its read-only PostgreSQL `SELECT 1` succeeded; Redis was unavailable. The unauthenticated dashboard browser navigation landed on `/login`. No valid registration, credentials login, OAuth, storage upload, AI request, or multi-user collaboration was tested.
- Canvas rooms remain a single-instance limitation. The Canvas service has no Redis or other distributed room fanout, and must use room affinity or remain on exactly one instance.
- Page collaboration can use Hocuspocus Redis fanout only when `COLLABORATION_REDIS_ENABLED=true` and `REDIS_URL` is configured. Canvas rooms are not included in that fanout.

## Dependencies

Runtime includes Next.js 16.4, React 19.3, Auth.js/NextAuth 4, Prisma 5, Tiptap 3.34, Hocuspocus 4, Yjs, tldraw 5.6, Vercel AI SDK/OpenAI provider, Base UI, Tailwind 4, Zod 4, Framer Motion, and Lucide. Storage calls use the Supabase Storage REST API; Playwright and k6 are not installed.

## Priority

1. Exercise credentials registration/login plus two-client page and canvas sync against isolated, configured PostgreSQL/WebSocket test services.
2. Configure and validate Supabase Storage, OpenAI streaming, Redis fanout, and the tldraw production license.
3. Add integration/Playwright/k6 coverage, canvas room affinity, content search, nested-page navigation, and production monitoring.

See `DEVELOPMENT_PROGRESS.md` for current verification and next work.
