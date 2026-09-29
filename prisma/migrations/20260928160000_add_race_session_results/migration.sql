-- Migration aditiva: Race Weekend / Sessions (V3 Fase Race Weekend, parte 2).
-- Nenhuma operação destrutiva; RaceResult permanece intacto.

ALTER TYPE "RaceStatus" ADD VALUE 'PRACTICE';
ALTER TYPE "RaceStatus" ADD VALUE 'SPRINT_QUALIFYING';
ALTER TYPE "RaceStatus" ADD VALUE 'SPRINT';
ALTER TYPE "RaceSession" ADD VALUE 'SPRINT_QUALIFYING';
ALTER TYPE "RaceSession" ADD VALUE 'SPRINT';
ALTER TYPE "TimelineEventKind" ADD VALUE 'SESSION_COMPLETED';

CREATE TABLE "RaceSessionResult" (
    "id" UUID NOT NULL,
    "raceId" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "teamId" UUID,
    "session" "RaceSession" NOT NULL,
    "position" INTEGER,
    "laps" INTEGER,
    "status" TEXT,
    "timeMs" INTEGER,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "provenance" "Provenance" NOT NULL DEFAULT 'CANONICAL',
    "sourceHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "RaceSessionResult_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RaceSessionResult_raceId_driverProfileId_session_key" ON "RaceSessionResult"("raceId", "driverProfileId", "session");
CREATE INDEX "RaceSessionResult_raceId_session_idx" ON "RaceSessionResult"("raceId", "session");
CREATE INDEX "RaceSessionResult_driverProfileId_idx" ON "RaceSessionResult"("driverProfileId");

ALTER TABLE "RaceSessionResult" ADD CONSTRAINT "RaceSessionResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaceSessionResult" ADD CONSTRAINT "RaceSessionResult_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RaceSessionResult" ADD CONSTRAINT "RaceSessionResult_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
