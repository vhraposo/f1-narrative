-- Migration aditiva: Universe como raiz do universo do usuário.
-- Preserva todos os dados existentes (nenhum DROP de tabela/coluna de dados).
-- Cria um Universe para cada User, faz backfill dos vínculos e troca as
-- constraints globais por constraints escopadas por Universe.

-- 1) Enum + tabela Universe
CREATE TYPE "UniverseStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

CREATE TABLE "Universe" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "status" "UniverseStatus" NOT NULL DEFAULT 'PENDING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Universe_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Universe_userId_key" ON "Universe"("userId");

ALTER TABLE "Universe"
    ADD CONSTRAINT "Universe_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 2) Colunas universeId (nuláveis nesta etapa, para backfill)
ALTER TABLE "Character" ADD COLUMN "universeId" UUID;
ALTER TABLE "Team" ADD COLUMN "universeId" UUID;
ALTER TABLE "Season" ADD COLUMN "universeId" UUID;
ALTER TABLE "WorldState" ADD COLUMN "universeId" UUID;
ALTER TABLE "ExternalBindingDriver" ADD COLUMN "universeId" UUID;
ALTER TABLE "ExternalBindingTeam" ADD COLUMN "universeId" UUID;
ALTER TABLE "ExternalBindingSeason" ADD COLUMN "universeId" UUID;
ALTER TABLE "ExternalBindingRace" ADD COLUMN "universeId" UUID;
ALTER TABLE "ExternalBindingDriverSeason" ADD COLUMN "universeId" UUID;
ALTER TABLE "ExternalBindingResult" ADD COLUMN "universeId" UUID;
ALTER TABLE "ExternalBindingStanding" ADD COLUMN "universeId" UUID;

-- 3) Um Universe por User existente
INSERT INTO "Universe" ("id", "userId", "status", "updatedAt")
SELECT gen_random_uuid(), u."id", 'PENDING', now()
FROM "User" u;

-- 4) Backfill de Character.universeId
-- 4a) personagens com dono pertencem ao universo do dono
UPDATE "Character" c
SET "universeId" = un."id"
FROM "Universe" un
WHERE c."userId" = un."userId";

-- 4b) pilotos de grid órfãos (userId nulo): universo do dono do time da entry
UPDATE "Character" c
SET "universeId" = un."id"
FROM "DriverProfile" dp
JOIN "SeasonDriverEntry" e ON e."driverProfileId" = dp."id"
JOIN "Team" t ON t."id" = e."teamId"
JOIN "Universe" un ON un."userId" = t."userId"
WHERE dp."characterId" = c."id" AND c."universeId" IS NULL;

-- 4c) órfãos que participam de alguma entry sem time derivável: universo principal.
-- Personagens de sistema (sem dono e sem entry) permanecem sem universo.
UPDATE "Character" c
SET "universeId" = (
    SELECT un."id"
    FROM "Universe" un
    LEFT JOIN "Team" t ON t."userId" = un."userId"
    LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id"
    GROUP BY un."id"
    ORDER BY count(e."id") DESC, un."id" ASC
    LIMIT 1
)
WHERE c."universeId" IS NULL
  AND EXISTS (
      SELECT 1
      FROM "DriverProfile" dp
      JOIN "SeasonDriverEntry" e ON e."driverProfileId" = dp."id"
      WHERE dp."characterId" = c."id"
  );

-- 5) Team pertence ao universo do dono
UPDATE "Team" t
SET "universeId" = un."id"
FROM "Universe" un
WHERE t."userId" = un."userId";

-- 6) Season: universo do dono do grid que referencia a temporada; fallback principal
UPDATE "Season" s
SET "universeId" = (
    SELECT un."id"
    FROM "Universe" un
    JOIN "Team" t ON t."userId" = un."userId"
    JOIN "SeasonDriverEntry" e ON e."teamId" = t."id" AND e."seasonId" = s."id"
    GROUP BY un."id"
    ORDER BY count(*) DESC, un."id" ASC
    LIMIT 1
)
WHERE s."universeId" IS NULL;

UPDATE "Season" s
SET "universeId" = (
    SELECT un."id"
    FROM "Universe" un
    LEFT JOIN "Team" t ON t."userId" = un."userId"
    LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id"
    GROUP BY un."id"
    ORDER BY count(e."id") DESC, un."id" ASC
    LIMIT 1
)
WHERE s."universeId" IS NULL;

-- 7) WorldState: universo da temporada corrente; fallback principal
UPDATE "WorldState" w
SET "universeId" = s."universeId"
FROM "Season" s
WHERE w."currentSeasonId" = s."id" AND w."universeId" IS NULL;

UPDATE "WorldState" w
SET "universeId" = (
    SELECT un."id"
    FROM "Universe" un
    LEFT JOIN "Team" t ON t."userId" = un."userId"
    LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id"
    GROUP BY un."id"
    ORDER BY count(e."id") DESC, un."id" ASC
    LIMIT 1
)
WHERE w."universeId" IS NULL;

-- 8) Bindings: universo derivado da entidade vinculada
UPDATE "ExternalBindingDriver" b
SET "universeId" = c."universeId"
FROM "Character" c
WHERE b."characterId" = c."id" AND b."universeId" IS NULL;

UPDATE "ExternalBindingTeam" b
SET "universeId" = t."universeId"
FROM "Team" t
WHERE b."teamId" = t."id" AND b."universeId" IS NULL;

UPDATE "ExternalBindingSeason" b
SET "universeId" = s."universeId"
FROM "Season" s
WHERE b."seasonId" = s."id" AND b."universeId" IS NULL;

UPDATE "ExternalBindingRace" b
SET "universeId" = s."universeId"
FROM "Race" r
JOIN "Season" s ON s."id" = r."seasonId"
WHERE b."raceId" = r."id" AND b."universeId" IS NULL;

UPDATE "ExternalBindingDriverSeason" b
SET "universeId" = s."universeId"
FROM "SeasonDriverEntry" e
JOIN "Season" s ON s."id" = e."seasonId"
WHERE b."seasonDriverEntryId" = e."id" AND b."universeId" IS NULL;

UPDATE "ExternalBindingResult" b
SET "universeId" = s."universeId"
FROM "RaceResult" rr
JOIN "Race" r ON r."id" = rr."raceId"
JOIN "Season" s ON s."id" = r."seasonId"
WHERE b."raceResultId" = rr."id" AND b."universeId" IS NULL;

UPDATE "ExternalBindingStanding" b
SET "universeId" = s."universeId"
FROM "ChampionshipStanding" cs
JOIN "Season" s ON s."id" = cs."seasonId"
WHERE b."championshipStandingId" = cs."id" AND b."universeId" IS NULL;

-- 8b) fallback de bindings sem universo derivável: universo principal
UPDATE "ExternalBindingDriver" b SET "universeId" = (SELECT un."id" FROM "Universe" un LEFT JOIN "Team" t ON t."userId" = un."userId" LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id" GROUP BY un."id" ORDER BY count(e."id") DESC, un."id" ASC LIMIT 1) WHERE b."universeId" IS NULL;
UPDATE "ExternalBindingTeam" b SET "universeId" = (SELECT un."id" FROM "Universe" un LEFT JOIN "Team" t ON t."userId" = un."userId" LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id" GROUP BY un."id" ORDER BY count(e."id") DESC, un."id" ASC LIMIT 1) WHERE b."universeId" IS NULL;
UPDATE "ExternalBindingSeason" b SET "universeId" = (SELECT un."id" FROM "Universe" un LEFT JOIN "Team" t ON t."userId" = un."userId" LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id" GROUP BY un."id" ORDER BY count(e."id") DESC, un."id" ASC LIMIT 1) WHERE b."universeId" IS NULL;
UPDATE "ExternalBindingRace" b SET "universeId" = (SELECT un."id" FROM "Universe" un LEFT JOIN "Team" t ON t."userId" = un."userId" LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id" GROUP BY un."id" ORDER BY count(e."id") DESC, un."id" ASC LIMIT 1) WHERE b."universeId" IS NULL;
UPDATE "ExternalBindingDriverSeason" b SET "universeId" = (SELECT un."id" FROM "Universe" un LEFT JOIN "Team" t ON t."userId" = un."userId" LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id" GROUP BY un."id" ORDER BY count(e."id") DESC, un."id" ASC LIMIT 1) WHERE b."universeId" IS NULL;
UPDATE "ExternalBindingResult" b SET "universeId" = (SELECT un."id" FROM "Universe" un LEFT JOIN "Team" t ON t."userId" = un."userId" LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id" GROUP BY un."id" ORDER BY count(e."id") DESC, un."id" ASC LIMIT 1) WHERE b."universeId" IS NULL;
UPDATE "ExternalBindingStanding" b SET "universeId" = (SELECT un."id" FROM "Universe" un LEFT JOIN "Team" t ON t."userId" = un."userId" LEFT JOIN "SeasonDriverEntry" e ON e."teamId" = t."id" GROUP BY un."id" ORDER BY count(e."id") DESC, un."id" ASC LIMIT 1) WHERE b."universeId" IS NULL;

-- 9) NOT NULL para ownership obrigatório (Character permanece nulável: chars de sistema)
ALTER TABLE "Team" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "Season" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "WorldState" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "ExternalBindingDriver" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "ExternalBindingTeam" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "ExternalBindingSeason" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "ExternalBindingRace" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "ExternalBindingDriverSeason" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "ExternalBindingResult" ALTER COLUMN "universeId" SET NOT NULL;
ALTER TABLE "ExternalBindingStanding" ALTER COLUMN "universeId" SET NOT NULL;

-- 10) FKs para Universe
ALTER TABLE "Character" ADD CONSTRAINT "Character_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Team" ADD CONSTRAINT "Team_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Season" ADD CONSTRAINT "Season_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WorldState" ADD CONSTRAINT "WorldState_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingDriver" ADD CONSTRAINT "ExternalBindingDriver_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingTeam" ADD CONSTRAINT "ExternalBindingTeam_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingSeason" ADD CONSTRAINT "ExternalBindingSeason_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingRace" ADD CONSTRAINT "ExternalBindingRace_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingDriverSeason" ADD CONSTRAINT "ExternalBindingDriverSeason_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingResult" ADD CONSTRAINT "ExternalBindingResult_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ExternalBindingStanding" ADD CONSTRAINT "ExternalBindingStanding_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 11) Índices declarados no schema
CREATE INDEX "Character_universeId_idx" ON "Character"("universeId");
CREATE INDEX "Team_universeId_idx" ON "Team"("universeId");
CREATE INDEX "Season_universeId_idx" ON "Season"("universeId");

-- 12) Troca das constraints globais por constraints escopadas
DROP INDEX "Team_userId_name_key";
CREATE UNIQUE INDEX "Team_universeId_name_key" ON "Team"("universeId", "name");

DROP INDEX "WorldState_key_key";
CREATE UNIQUE INDEX "WorldState_universeId_key_key" ON "WorldState"("universeId", "key");

DROP INDEX "ExternalBindingDriver_externalDriverId_key";
CREATE UNIQUE INDEX "ExternalBindingDriver_universeId_externalDriverId_key" ON "ExternalBindingDriver"("universeId", "externalDriverId");

DROP INDEX "ExternalBindingTeam_externalTeamId_key";
CREATE UNIQUE INDEX "ExternalBindingTeam_universeId_externalTeamId_key" ON "ExternalBindingTeam"("universeId", "externalTeamId");

DROP INDEX "ExternalBindingSeason_externalSeasonId_key";
CREATE UNIQUE INDEX "ExternalBindingSeason_universeId_externalSeasonId_key" ON "ExternalBindingSeason"("universeId", "externalSeasonId");

DROP INDEX "ExternalBindingRace_externalRaceId_key";
CREATE UNIQUE INDEX "ExternalBindingRace_universeId_externalRaceId_key" ON "ExternalBindingRace"("universeId", "externalRaceId");

DROP INDEX "ExternalBindingDriverSeason_externalDriverSeasonId_key";
CREATE UNIQUE INDEX "ExternalBindingDriverSeason_universeId_externalDriverSeasonId_key" ON "ExternalBindingDriverSeason"("universeId", "externalDriverSeasonId");

DROP INDEX "ExternalBindingResult_externalResultId_key";
CREATE UNIQUE INDEX "ExternalBindingResult_universeId_externalResultId_key" ON "ExternalBindingResult"("universeId", "externalResultId");

DROP INDEX "ExternalBindingStanding_externalStandingId_key";
CREATE UNIQUE INDEX "ExternalBindingStanding_universeId_externalStandingId_key" ON "ExternalBindingStanding"("universeId", "externalStandingId");

-- 13) Universos que já possuem grid materializado ficam READY; os demais PENDING
UPDATE "Universe" un
SET "status" = 'READY'
WHERE EXISTS (
    SELECT 1
    FROM "Team" t
    JOIN "SeasonDriverEntry" e ON e."teamId" = t."id"
    WHERE t."universeId" = un."id"
);
