# Testing and Quality

## Implemented checks

`npm test` runs the built-in Node test runner (Node 22+) against:

- The Owner/Editor/Commenter/Viewer permission matrix.
- Workspace/document/invitation validation boundaries.
- Registration and rich-text URL validation.
- Collaboration ticket signature/expiry and Yjs CRDT merge/recovery primitives, including replacement, restore propagation, serialized writes, and deletion waiting.
- In-memory request limiter burst and reset behavior. Redis mode uses an atomic increment/expiry script and requires a reachable Redis service.

Database integration fixtures, Playwright, and k6 are not installed. The rich-text persistence tests exercise Yjs and lock helpers only; they do not run Prisma transactions, the Hocuspocus control endpoint, browser IndexedDB, or authenticated multi-client WebSockets. Live database/auth, browser, Redis failover, Supabase Storage, OpenAI streaming, and load flows have not been run.

## Verification for this pass

- `npx prisma validate` — passed.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm test` — 16 passed.
- `npm audit` — 0 vulnerabilities.
- `npm run build` — passed. `/login` reads a request-time callback URL, and `/api/health` runs its database probe only on a request.
- Hocuspocus startup — smoke-tested locally in the preceding pass; no authenticated connection was tested.
- Canvas server startup — smoke-tested on a temporary local port and shut down cleanly. Database-backed room creation/persistence and two-client collaboration remain unverified.
- `/api/health` live readiness response — not tested against a reachable database.
- PostgreSQL migration status — attempted earlier; the configured database was unreachable. Migrations are not known to be applied.

## Next coverage

- Integration: Auth.js sessions, database CRUD, tenant isolation, cross-workspace parent rejection, RBAC writes, invitation lifecycle, snapshots, and attachment access.
- Playwright: registration/login, workspace and document creation, page editor autosave, comments/history, invitation acceptance, viewer read-only behavior, search/command palette, canvas editing and image upload.
- Collaboration: connect two authenticated clients to Hocuspocus and tldraw sync; verify convergence, reconnect, DB restoration after restart, authorization, presence, and Redis fanout.
- k6: measure both WebSocket services for handshake/sync success, latency percentiles, disconnects, server errors, and throughput. Do not claim target concurrent-user validation until it has run against configured infrastructure.
