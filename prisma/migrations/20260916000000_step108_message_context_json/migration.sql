-- AlterTable: STEP 108 FASE 4 — contextJson em Message.
-- Snapshot/metadata do contexto narrativo usado na geração (não é fonte de verdade).
ALTER TABLE "Message" ADD COLUMN "contextJson" JSONB;