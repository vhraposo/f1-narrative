CREATE TYPE "UniverseAutonomyMode" AS ENUM ('OFF', 'OBSERVER', 'GUIDED', 'FULL');
CREATE TYPE "UniverseAutonomyStatus" AS ENUM ('ACTIVE', 'PAUSED', 'STOPPED');

ALTER TABLE "Universe"
  ADD COLUMN "autonomyMode" "UniverseAutonomyMode" NOT NULL DEFAULT 'OFF',
  ADD COLUMN "autonomyStatus" "UniverseAutonomyStatus" NOT NULL DEFAULT 'PAUSED',
  ADD COLUMN "lastSimulationAt" TIMESTAMP(3),
  ADD COLUMN "nextSimulationAt" TIMESTAMP(3),
  ADD COLUMN "simulationVersion" TEXT;
