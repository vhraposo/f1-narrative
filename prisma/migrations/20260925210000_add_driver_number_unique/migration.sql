-- Migration aditiva: unicidade de número de piloto por temporada (V3 Fase 4).
-- Diagnóstico prévio no DEV: 0 duplicatas, 0 entradas com #17, 0 fora de 1-99.
-- Postgres permite múltiplos NULLs em índice único (pilotos sem número).

CREATE UNIQUE INDEX "SeasonDriverEntry_seasonId_number_key" ON "SeasonDriverEntry"("seasonId", "number");
