# NexSpace

**Think together. Build better.** NexSpace is a collaborative workspace application in active development.

The root page remains a browser-local preview. The authenticated `/dashboard` uses PostgreSQL-backed workspace and document APIs; page links open the Tiptap editor and canvas links open a collaborative tldraw board. Email/password registration provisions a private owner workspace and welcome page; Google OAuth is optional. Apply migrations before enabling registration. Page collaboration (Hocuspocus/Yjs) and canvas sync run as separate WebSocket services.

## Stack

- Next.js 16 App Router, React 19, TypeScript
- Tailwind CSS v4, Base UI shadcn components, Lucide, Framer Motion
- Auth.js v4 + Prisma adapter, scrypt password hashing, and optional Google OAuth
- PostgreSQL and Prisma 5

Tiptap 3.34, Yjs, Hocuspocus 4, tldraw 5.6, optional Redis fanout, the Vercel AI SDK/OpenAI provider, and Supabase Storage REST integration are wired. AI and storage features need credentials. tldraw production use needs a license key.

## Local setup

1. Install Node.js and npm.
2. Copy `.env.example` to `.env`.
3. Set `DATABASE_URL` and `DIRECT_URL` to your PostgreSQL database URLs.
4. Optionally create a Google OAuth client. Add `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`; set its callback URL to `http://localhost:3000/api/auth/callback/google`.
5. Generate `NEXTAUTH_SECRET` with `npx auth secret` or `openssl rand -base64 32`.
6. Install and migrate, then run the app:

```bash
npm ci
npm run db:generate
npm run db:migrate
npm run dev
```

Run `npm run db:deploy`, then open http://localhost:3000/login to register or sign in. `/dashboard` requires a configured database and `NEXTAUTH_SECRET`. The root preview works independently.

`npm run dev` checks the frontend, tldraw Canvas, and Hocuspocus ports before starting all three services together. It refuses to start duplicates when a service port is occupied, stops the other services if one fails, and shuts the group down when you stop the command. Do not start standalone service commands at the same time as `npm run dev`.

For page collaboration, use the same random `COLLABORATION_SECRET` in the Next.js and collaboration service environments. Set `COLLABORATION_URL` to the server-side endpoint and `NEXT_PUBLIC_COLLABORATION_URL` to the browser-reachable endpoint. The Canvas server uses the same ticket-signing secret and `DATABASE_URL`. Local Canvas defaults are `ws://localhost:1235`; set `CANVAS_URL`, `NEXT_PUBLIC_CANVAS_URL`, and `CANVAS_PORT` for other environments.

To run a service by itself for debugging, use `npm run canvas` or `npm run collab` in a separate terminal, with the corresponding other processes already running.

Start all three services in one PowerShell terminal:

```powershell
# Terminal
Set-Location D:\Nexvia_INTERN\nexspace
npm run dev
```

The services load the same local `.env`. Generate a private signing secret once (for example, `node -p "require('node:crypto').randomBytes(32).toString('hex')"`) and put it in `COLLABORATION_SECRET`; never use a `NEXT_PUBLIC_` variable for it. Redis fanout is optional for page collaboration; enable `COLLABORATION_REDIS_ENABLED=true` and configure `REDIS_URL` for multiple Hocuspocus instances. The app also uses `REDIS_URL` for shared request limits. Canvas rooms currently require a single service process or document-aware room affinity.

Redis is optional for a single local development instance. If `REDIS_URL` points to a stopped Redis server, request limits fall back to this process. Production must set `REDIS_URL` to a `redis://` or `rediss://` endpoint for AI, invitations, uploads, and search; those routes fail closed if Redis is missing or unavailable. Hocuspocus Redis fanout is separately enabled with `COLLABORATION_REDIS_ENABLED=true`.

To enable canvas image uploads, create a **private** Supabase Storage bucket and set `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and `SUPABASE_STORAGE_BUCKET`. To enable AI Copilot, set the server-side `OPENAI_API_KEY`; `OPENAI_MODEL` defaults to `gpt-4.1-mini`. Set `NEXT_PUBLIC_TLDRAW_LICENSE_KEY` only after obtaining a key appropriate for production use.

After signing in once, optionally create a starter workspace:

```bash
# Set SEED_OWNER_EMAIL to the Google account used above
npm run db:seed
```

## Useful commands

```bash
npm run lint
npm test # built-in Node tests; use Node.js 22+
npx tsc --noEmit
npm run build
npm run db:deploy # apply committed migrations in a deployment release step
```

## Documentation

- [Project audit](PROJECT_AUDIT.md)
- [Architecture](ARCHITECTURE.md)
- [Development progress](DEVELOPMENT_PROGRESS.md)
- [Database](DATABASE.md)
- [API](API_DOCUMENTATION.md)
- [Security](SECURITY.md)
- [Deployment](DEPLOYMENT.md)
- [Testing](TESTING.md)
