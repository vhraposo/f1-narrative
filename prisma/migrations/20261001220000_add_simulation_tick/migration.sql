CREATE TYPE "SimulationTickStatus" AS ENUM (
  'RUNNING',
  'COMPLETED',
  'DRY_RUN',
  'FAILED'
);

CREATE TABLE "SimulationTick" (
  "id" UUID NOT NULL,
  "universeId" UUID NOT NULL,
  "startWorldDate" TIMESTAMP(3) NOT NULL,
  "endWorldDate" TIMESTAMP(3) NOT NULL,
  "simulationVersion" TEXT NOT NULL,
  "status" "SimulationTickStatus" NOT NULL DEFAULT 'RUNNING',
  "dryRun" BOOLEAN NOT NULL DEFAULT false,
  "fingerprint" TEXT NOT NULL,
  "summary" JSONB,
  "error" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),

  CONSTRAINT "SimulationTick_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SimulationTick_fingerprint_key"
  ON "SimulationTick"("fingerprint");
CREATE INDEX "SimulationTick_universeId_startWorldDate_idx"
  ON "SimulationTick"("universeId", "startWorldDate");
CREATE INDEX "SimulationTick_universeId_status_idx"
  ON "SimulationTick"("universeId", "status");

ALTER TABLE "SimulationTick"
  ADD CONSTRAINT "SimulationTick_universeId_fkey"
  FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
