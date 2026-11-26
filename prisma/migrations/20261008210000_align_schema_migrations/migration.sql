DROP INDEX "Conversation_status_idx";

CREATE UNIQUE INDEX "Season_universeId_year_key" ON "Season"("universeId", "year");

ALTER INDEX "ExternalBindingDriverSeason_universeId_externalDriverSeasonId_k" RENAME TO "ExternalBindingDriverSeason_universeId_externalDriverSeason_key";
