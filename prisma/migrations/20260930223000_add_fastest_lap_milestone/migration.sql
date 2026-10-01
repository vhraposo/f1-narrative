-- Milestone de primeira volta mais rápida + tempo da volta rápida por resultado.
-- Aditiva: ADD VALUE em enum e ADD COLUMN nullable (sem rewrite/dados fabricados).
ALTER TYPE "ExternalDriverEventCategory" ADD VALUE 'FIRST_FASTEST_LAP';

ALTER TABLE "ExternalResult" ADD COLUMN "fastestLapTime" TEXT;
