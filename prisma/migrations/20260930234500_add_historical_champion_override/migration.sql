-- Override histórico de campeão no Universe (temporadas sem Season materializada).
-- Aditiva: dois valores de enum + tabela nova com FKs Cascade.
ALTER TYPE "TimelineEventKind" ADD VALUE 'HISTORICAL_CHAMPION_OVERRIDE_SET';
ALTER TYPE "TimelineEventKind" ADD VALUE 'HISTORICAL_CHAMPION_OVERRIDE_CLEARED';

CREATE TABLE "HistoricalChampionOverride" (
    "id" UUID NOT NULL,
    "universeId" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "timelineEventId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "HistoricalChampionOverride_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HistoricalChampionOverride_universeId_year_key" ON "HistoricalChampionOverride"("universeId", "year");
CREATE INDEX "HistoricalChampionOverride_universeId_idx" ON "HistoricalChampionOverride"("universeId");

ALTER TABLE "HistoricalChampionOverride" ADD CONSTRAINT "HistoricalChampionOverride_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "HistoricalChampionOverride" ADD CONSTRAINT "HistoricalChampionOverride_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
