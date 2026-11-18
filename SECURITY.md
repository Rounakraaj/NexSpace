# Security

## Implemented controls

- Auth.js credentials use scrypt password hashes and JWT sessions; OAuth account data uses the Prisma adapter. Google is enabled only when both OAuth credentials exist; no shared demo identity or hard-coded production secret remains.
- Workspace/document routes derive the actor from the session and constrain reads/writes by workspace ownership or membership.
- Workspace metadata changes/deletes are owner-only. Document mutations are restricted to owners/editors; commenter/viewer roles can read.
- Zod validates API payload shape and bounds names, descriptions, and titles. JSON bodies are byte-limited while streaming: 64 KB by default, 16 KB for registration, 12 KB for AI, and 1.5 MB for document content.
- API responses select fields deliberately; account secrets and session tokens are not returned.
- Registration allows five attempts per normalized email and IP per hour. Duplicate-email submissions use the same success response as new submissions; credentials errors stay generic.
- Credentials login allows ten attempts per normalized email and twenty per IP per 15 minutes. Attempts are counted before password verification; unknown accounts perform a dummy scrypt verification.
- Rate-limit identifiers are HMAC-SHA-256 hashed with the Auth.js secret (or a process-local development secret) for both Redis and the in-memory fallback. Redis uses an atomic increment/expiry script; production fails closed when Redis or the shared Auth.js key is missing or unavailable.
- WebSocket connections require a short-lived HMAC ticket, and Hocuspocus rechecks current workspace membership. Commenters/viewers receive read-only connections.
- Invitation bearer tokens are generated from cryptographic randomness, stored as SHA-256 hashes, limited to seven days, checked against the signed-in account email, and can be revoked by an owner.
- AI requests require workspace membership, cap prompt size/context/output, and apply a fixed-window per-user limit. Local development may fall back to process-local limits; production requires Redis-backed shared limits and fails closed if Redis is unconfigured or unavailable. The OpenAI key stays on the server.
- Canvas image uploads require editor permission, are capped at 10 MB while streaming the multipart body, allow only PNG/JPEG/GIF/WebP, verify file signatures, and use private Supabase object storage. Retrieval checks current workspace membership and disables caching.
- Search results are scoped to the authenticated user's workspace membership.
- Server Actions perform their own authentication and role checks.

## Remaining security work

- Run Auth.js, registration, RBAC, and cross-tenant integration tests against an isolated test database; current unit tests do not exercise live credentials or OAuth.
- Exercise Redis with a configured test instance and tune shared limits from observed usage. Keep Redis available before exposing production instances.
- Rotate `COLLABORATION_SECRET` on both services together. Tickets expire after five minutes; an established WebSocket remains authorized until disconnect.
- Invitation URLs are bearer credentials delivered manually and require a matching signed-in email; account email verification is not enforced for credentials accounts. Add a mail sender and stronger verified-email policy when the identity provider supports it.
- Established WebSocket sessions remain authorized until disconnect after a role change or removal; force-close sessions or shorten the exposure window for stricter revocation.
- Add storage malware scanning, AI budget/usage controls, and canvas room affinity/authentication observability before production scale.
- Production readiness now requires reachable shared Redis as well as PostgreSQL and the Auth.js secret; verify the deployment probe before routing traffic.
- Consider per-user favorites and stricter document content schema validation; current favorite is stored on the shared document.
- Configure production TLS, secret rotation, database least privilege, backups, and retention policies.

The app has not received an external security review. The browser-local preview is not an account store and should not be used for sensitive shared data.
