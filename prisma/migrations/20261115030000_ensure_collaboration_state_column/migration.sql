-- Non-destructive repair if the collaboration-state migration was skipped,
-- drifted, or marked applied without the physical column.
ALTER TABLE "Document" ADD COLUMN IF NOT EXISTS "collaborationState" BYTEA;
