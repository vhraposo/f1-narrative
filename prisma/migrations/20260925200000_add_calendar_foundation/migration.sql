-- Migration aditiva: calendário automático + next race (V3 Fase 3).
-- Nenhuma operação destrutiva.

ALTER TYPE "TimelineEventKind" ADD VALUE IF NOT EXISTS 'RACE_SCHEDULED';
ALTER TYPE "TimelineEventKind" ADD VALUE IF NOT EXISTS 'RACE_UPDATED';

ALTER TABLE "ExternalBindingRace" ADD COLUMN "contentHash" TEXT;
ALTER TABLE "ExternalBindingRace" ADD COLUMN "externalSnapshot" JSONB;
