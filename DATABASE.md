# Database

## Implemented

PostgreSQL is accessed with Prisma 5.22. The schema is at `prisma/schema.prisma`; the first migration is in `prisma/migrations/20261114000000_init/`. Models include Auth.js users/accounts/sessions, workspaces/memberships, nested documents, comment threads/comments/replies, snapshots, invitations, attachments, and activity logs. IDs are UUIDs; foreign keys define cascade/restrict behavior and listing relations have indexes.

`DATABASE_URL` is the runtime connection string (use a pooled URL for serverless runtime when supported). `DIRECT_URL` is the direct connection used by Prisma migrations and introspection. Both are required by the current Prisma schema.

## Local setup

1. Copy `.env.example` to `.env`.
2. Start PostgreSQL or create a Supabase project and set both URLs.
3. Generate the client and apply the migration:

```bash
npm ci
npm run db:generate
npm run db:migrate
```

For an already deployed database use `npm run db:deploy`; do not use `db push` in production.

To create a starter workspace, first sign in once through Google, then set `SEED_OWNER_EMAIL` to that account and run `npm run db:seed`.

## Tenant safety

The API derives identity from the Auth.js JWT session. OAuth accounts and users persist through the Prisma adapter; password hashes are stored as scrypt digests in `User.passwordHash`. Workspace and document queries are constrained to the current user as owner or member before returning data. Role checks run on mutations. Never accept `ownerId`, `createdById`, or role from an untrusted client.

The `20261115000000_add_password_hash` migration adds the nullable password hash used by credentials accounts. Apply all migrations before enabling registration.

The `20261115010000_add_collaboration_state` migration adds a `BYTEA` Yjs state column to each document. Hocuspocus persists Yjs state there and mirrors current Tiptap JSON into `content` for existing API consumers. The Yjs state is authoritative after a document enters live collaboration. tldraw canvas room snapshots are stored as JSON in `Document.content`; image metadata lives in `Attachment`, with bytes kept in a private Supabase Storage bucket.

## Password hash schema drift repair

The corrective migrations 20261115020000_ensure_password_hash_column and 20261115030000_ensure_collaboration_state_column are non-destructive. They add the nullable "passwordHash" and "collaborationState" BYTEA columns only if missing, preserving all existing rows and data. These are the two fields added after the initial schema migration. Prisma validation, client generation, TypeScript checks, and builds do not inspect or alter the live database. Runtime uses DATABASE_URL; Prisma migration and introspection use DIRECT_URL. Verify both resolve to the same Supabase project, database, and public schema.

When database connectivity is unavailable, inspect the target in the Supabase SQL Editor (or psql) and apply this safe repair:

```sql
SELECT current_database(), current_schema();
SELECT current_user, current_setting('search_path');
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'User'
ORDER BY ordinal_position;
SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
ORDER BY table_name, ordinal_position;
SELECT ns.nspname AS schema_name, tbl.relname AS table_name, con.conname AS constraint_name,
       con.contype AS constraint_type, pg_get_constraintdef(con.oid) AS definition
FROM pg_constraint con
JOIN pg_class tbl ON tbl.oid = con.conrelid
JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
WHERE ns.nspname = 'public'
ORDER BY tbl.relname, con.conname;
SELECT ns.nspname AS schema_name, typ.typname AS enum_name,
       array_agg(enum.enumlabel ORDER BY enum.enumsortorder) AS enum_values
FROM pg_type typ
JOIN pg_enum enum ON enum.enumtypid = typ.oid
JOIN pg_namespace ns ON ns.oid = typ.typnamespace
WHERE ns.nspname = 'public'
GROUP BY ns.nspname, typ.typname
ORDER BY typ.typname;
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

ALTER TABLE public."User"
  ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
ALTER TABLE public."Document"
  ADD COLUMN IF NOT EXISTS "collaborationState" BYTEA;
```

Both new columns are nullable, so existing users and documents remain valid. On a reachable database, inspect _prisma_migrations first if the database was managed with db push or lacks a migration baseline, then deploy the corrective migration with npm run db:deploy.

To inspect migration history when the table exists:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at, logs
FROM public."_prisma_migrations"
ORDER BY started_at;
```

Run the identity and read-only schema queries separately against both connection endpoints. They should report the same database and schema before any migration is applied. The configured URLs may use different ports because one is pooled; never run a schema-changing command until the target identity is confirmed.

## Not yet implemented

Database backups, retention, and a live PostgreSQL migration run remain outstanding. Invitation and attachment models are in active use. Comment/reply/resolve and snapshot/restore APIs have editor panels. Page automatic snapshots are limited to one per document per ten minutes; canvas snapshots use the current room snapshot and do not yet maintain automatic history snapshots.
