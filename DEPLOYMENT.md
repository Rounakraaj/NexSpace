# Deployment

## Current status

No cloud services are configured and no deployment has been performed. The app has initial, password-hash, and Yjs-state Prisma migrations. Deploying the frontend alone does not provide collaboration; page sync, canvas sync, OpenAI, and Supabase Storage each need configured server-side services or credentials.

## PostgreSQL and authentication

1. Copy `.env.example` to `.env`.
2. Set `DATABASE_URL` to a runtime connection and `DIRECT_URL` to a direct PostgreSQL connection. For Supabase, use its pooler for runtime if needed and the direct endpoint for migrations.
3. Generate a random `NEXTAUTH_SECRET` (`openssl rand -base64 32`) and set `NEXTAUTH_URL=http://localhost:3000`.
4. Optionally create a Google OAuth web client and set `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. Add `http://localhost:3000/api/auth/callback/google` as an authorized redirect URI.
5. Run `npm ci`, `npm run db:generate`, and `npm run db:deploy`; start with `npm run dev`.

## Vercel + Supabase release outline

- Configure `DATABASE_URL`, `DIRECT_URL`, `NEXTAUTH_URL`, `NEXTAUTH_SECRET`, `GOOGLE_CLIENT_ID`, and `GOOGLE_CLIENT_SECRET` as server-side Vercel environment variables.
- Register `https://YOUR_DOMAIN/api/auth/callback/google` as a Google OAuth redirect URI.
- Run `npm run db:deploy` as a release step against the production database before routing traffic to new code.
- Use a dedicated migration credential for the direct URL and least-privilege runtime role where practical.
- Set secure HTTPS origin and review cookies, provider settings, backups, and restore procedures before production use.
- Configure the platform readiness probe to call `/api/health`; it returns `200` only when PostgreSQL is reachable and the Auth.js secret is configured.

## Collaboration service

- Deploy the collaboration process separately (Railway or another Node 22+ host) with `npm run collab`.
- Set `DATABASE_URL`, `COLLABORATION_SECRET`, and `COLLABORATION_PORT` on that service. Set the same signing secret on Vercel.
- Set `COLLABORATION_URL` on the server-rendered frontend and `NEXT_PUBLIC_COLLABORATION_URL` to the browser-reachable `wss://` endpoint.
- Set `COLLABORATION_REDIS_ENABLED=true` and `REDIS_URL` on each collaboration instance to enable Redis fanout. Leave it disabled for one local instance.
- Set `REDIS_URL` on the Next.js app to use atomic shared request limits for AI, invitations, uploads, and search. Local development falls back to per-process limits if Redis is stopped or unset. Production requires Redis for these routes and fails closed if the URL is unset or Redis becomes unavailable.
- Deploy the tldraw canvas service separately with `npm run canvas` on Node 22+, sharing `DATABASE_URL` and `COLLABORATION_SECRET`; set `CANVAS_PORT`, `CANVAS_URL`, and `NEXT_PUBLIC_CANVAS_URL` appropriately. `NEXT_PUBLIC_CANVAS_URL` must be reachable by the browser and use `wss://` in production. Run one instance unless the edge/router provides document-aware room affinity; separate in-memory room copies will diverge.
- Set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` only after obtaining a tldraw license that covers production use. Their SDK's default license terms permit development use only: [tldraw license](https://tldraw.dev/community/license).

## Optional integrations

- Create a private Supabase Storage bucket and configure `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`. The service-role key belongs only in server environments.
- Configure `OPENAI_API_KEY` and optionally `OPENAI_MODEL` for streamed AI Copilot responses. Redis-backed request limits apply when `REDIS_URL` is configured.

## Planned infrastructure

Observability, production load validation, backups, and live migration validation remain. Never prefix database, Redis, service-role, collaboration signing, or AI secrets with `NEXT_PUBLIC_`.
