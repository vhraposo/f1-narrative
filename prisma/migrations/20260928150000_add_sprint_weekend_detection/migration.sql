-- Migration aditiva: determinação de Sprint Weekend (V3 Race Weekend, parte 1).
-- Nenhuma operação destrutiva; não altera dados existentes.

ALTER TABLE "ExternalRace" ADD COLUMN "hasSprint" BOOLEAN;
ALTER TABLE "Race" ADD COLUMN "sprintOverride" BOOLEAN;
ALTER TABLE "Race" ADD COLUMN "sprintExternal" BOOLEAN;
