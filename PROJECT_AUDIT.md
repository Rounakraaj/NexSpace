# NexSpace Project Audit

**Updated:** 2026-11-15

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
- PostgreSQL migration status was attempted but the configured database could not be reached. Registration/login and live collaboration have not been exercised end to end.
- Live database integration, multi-client browser tests, Redis fanout, Supabase uploads, OpenAI calls, and tldraw room synchronization have not been exercised against configured services. Canvas service is single-process and requires room affinity before horizontal scale-out. tldraw production licensing must be configured.
- The original insecure demo credential behavior was removed: no demo account is accepted or created by requests.
- `next.config.ts` retains the installed Turbopack CSS loader; Tailwind is imported in `app/globals.css`; reduced-motion behavior is present.

## Dependencies

Runtime includes Next.js 16.4, React 19.3, Auth.js/NextAuth 4, Prisma 5, Tiptap 3.34, Hocuspocus 4, Yjs, tldraw 5.6, Vercel AI SDK/OpenAI provider, Base UI, Tailwind 4, Zod 4, Framer Motion, and Lucide. Storage calls use the Supabase Storage REST API; Playwright and k6 are not installed.

## Priority

1. Apply migrations and exercise credentials registration/login plus two-client page and canvas sync against configured PostgreSQL/WebSocket services.
2. Configure and validate Supabase Storage, OpenAI streaming, Redis fanout, and the tldraw production license.
3. Add integration/Playwright/k6 coverage, registration abuse controls, canvas room affinity, content search, nested-page navigation, and production monitoring.

See `DEVELOPMENT_PROGRESS.md` for current verification and next work.
