-- Non-destructive repair for databases where the password-hash migration was
-- previously skipped, drifted, or marked applied without the physical column.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;
