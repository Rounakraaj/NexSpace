# Testing and Quality

## Implemented checks

`npm test` runs the built-in Node test runner (Node 22+) against:

- The Owner/Editor/Commenter/Viewer permission matrix.
- Workspace/document/invitation validation boundaries.
- Registration and rich-text URL validation.
- Collaboration ticket signature/expiry and Yjs CRDT merge/recovery primitives, including replacement, restore propagation, serialized writes, and deletion waiting.
- Canvas room tests using the installed tldraw 5.6.0 `TLSocketRoom`: concurrent two-user shape edits, persisted room hydration after a client refresh and clean service restart, snapshot restore delivered to two connected sessions, concurrent snapshot/update ordering, stale revision rejection, active-room deletion, and read-only push rejection.
- Rate limiter limits, normalized email identifiers, hashed key privacy, expiry, in-memory and fake Redis concurrency behavior, and fail-closed production behavior when Redis is missing or operations fail. These tests use injected/local implementations and do not contact Redis.
- Bounded JSON and streamed request-body parsing, including malformed JSON, invalid UTF-8, declared-size overflow, and streamed-size overflow without a `Content-Length` header.

Latest local verification: `npm test` — 45 passed; `npx tsc --noEmit` — passed; `npm run lint` — passed; `npx prisma validate` — passed; `npm run build` — passed.

Database integration fixtures, Playwright, and k6 are not installed. The Canvas tests use a fake repository and real in-memory tldraw rooms; they do not run Prisma transactions, the Canvas HTTP control endpoint, browser IndexedDB, or authenticated browser WebSockets. The rich-text persistence tests exercise Yjs and lock helpers only; they do not run Prisma transactions, the Hocuspocus control endpoint, browser IndexedDB, or authenticated multi-client WebSockets. Registration creation, NextAuth credentials/OAuth, Redis-backed rate limiting, Supabase uploads, OpenAI streaming, and load flows have not been run.

## Verification for this pass

- `npx prisma validate` — passed.
- `npx tsc --noEmit` — passed.
- `npm run lint` — passed.
- `npm test` — 45 passed.
- `npm run build` — passed. `/login` reads a request-time callback URL, and `/api/health` runs database and Redis checks only on a request.
- Production-build smoke (`npm run start -- --hostname 127.0.0.1 --port 3017`): `GET /` — HTTP 200; `GET /login` — HTTP 200; `GET /dashboard` — HTTP 200 PPR shell, with an integrated browser navigation landing at `/login`; invalid `POST /api/register` — HTTP 400. No valid registration or authentication mutation was sent.
- `GET /api/health` against that local production server — HTTP 503; response reported PostgreSQL `ok`, Auth.js secret `configured`, and shared rate limiting `unavailable`. The database check is read-only (`SELECT 1`); Redis was not reachable. `ai`, `storage`, and `canvas` flags indicate configuration only, not service connectivity.
- Repro commands (run the server in one terminal, then these in another):

  ```powershell
  npm run start -- --hostname 127.0.0.1 --port 3017
  curl.exe --silent --show-error --output NUL --write-out "GET / -> HTTP %{http_code}\n" http://127.0.0.1:3017/
  curl.exe --silent --show-error --output NUL --write-out "GET /login -> HTTP %{http_code}\n" http://127.0.0.1:3017/login
  curl.exe --silent --show-error --output NUL --write-out "GET /dashboard -> HTTP %{http_code}\n" http://127.0.0.1:3017/dashboard
  curl.exe --silent --show-error --output NUL --write-out "POST /api/register invalid payload -> HTTP %{http_code}\n" --header "Content-Type: application/json" --data-raw '{"name":"Smoke Test","email":"invalid","password":"short"}' http://127.0.0.1:3017/api/register
  curl.exe --silent --show-error --include http://127.0.0.1:3017/api/health
  ```

- Hocuspocus startup — smoke-tested locally in the preceding pass; no authenticated connection was tested.
- Canvas runtime against PostgreSQL and authenticated browser clients — not smoke-tested in this pass; room behavior is covered by real `TLSocketRoom` instances backed by a fake repository.
- `npx prisma migrate status` — six migrations found; database schema reported up to date. No migration was applied by this pass.
- Canvas restart persistence, snapshots, deletion, and authorization — unit-tested with in-memory rooms and a fake repository, but not tested against a reachable PostgreSQL database or authenticated browsers.

## Next coverage

- Integration: Auth.js sessions, database CRUD, tenant isolation, cross-workspace parent rejection, RBAC writes, invitation lifecycle, snapshots, and attachment access.
- Playwright: registration/login, workspace and document creation, page editor autosave, comments/history, invitation acceptance, viewer read-only behavior, search/command palette, canvas editing and image upload.
- Collaboration: connect two authenticated clients to Hocuspocus and tldraw sync; verify convergence, reconnect, DB restoration after restart, authorization, presence, and Redis fanout.
- k6: measure both WebSocket services for handshake/sync success, latency percentiles, disconnects, server errors, and throughput. Do not claim target concurrent-user validation until it has run against configured infrastructure.

## Manual Canvas collaboration check

1. Apply migrations with `npm run db:deploy`, configure the database and collaboration signing secret, and start the app and Canvas service with `npm run dev`.
2. Sign in as an Editor in two separate browser profiles and open the same Canvas document. Draw different shapes in both profiles at the same time and confirm both views converge.
3. Refresh one profile and confirm the current shapes reappear.
4. Create a Canvas snapshot, keep both profiles connected, make additional edits, and restore the snapshot. Confirm both connected views change to the restored state.
5. Add an edit, stop the development stack with `Ctrl+C` (graceful SIGINT), restart it with `npm run dev`, and reopen the Canvas. Confirm the last persisted shapes are present.
6. Attempt to edit as a Viewer or Commenter and confirm edits are rejected. Delete a Canvas while another profile is still connected; confirm the session closes and the document stays deleted after reconnect.
7. Repeat restore, restart, and delete checks against the configured PostgreSQL deployment. Do not run multiple Canvas service instances; horizontal room coordination is not supported.
