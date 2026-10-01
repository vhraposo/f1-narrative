-- Migration aditiva: fundação de timeline (V3 Fase 2).
-- Nenhuma operação destrutiva; não altera dados existentes.

CREATE TYPE "TimelineEventKind" AS ENUM ('WORLD_ADVANCED', 'RACE_RESULT_CORRECTED', 'STANDING_CORRECTED', 'NUMBER_CORRECTED');

CREATE TABLE "TimelineEvent" (
    "id" UUID NOT NULL,
    "universeId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "worldDate" TIMESTAMP(3) NOT NULL,
    "kind" "TimelineEventKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "causedBy" TEXT,
    "supersedesId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimelineEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TimelineEvent_universeId_sequence_key" ON "TimelineEvent"("universeId", "sequence");
CREATE INDEX "TimelineEvent_universeId_worldDate_sequence_idx" ON "TimelineEvent"("universeId", "worldDate", "sequence");

CREATE TABLE "WorldSnapshot" (
    "id" UUID NOT NULL,
    "universeId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "worldDate" TIMESTAMP(3) NOT NULL,
    "state" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WorldSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "WorldSnapshot_universeId_sequence_key" ON "WorldSnapshot"("universeId", "sequence");
CREATE INDEX "WorldSnapshot_universeId_sequence_idx" ON "WorldSnapshot"("universeId", "sequence");

ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TimelineEvent" ADD CONSTRAINT "TimelineEvent_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "TimelineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "WorldSnapshot" ADD CONSTRAINT "WorldSnapshot_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
