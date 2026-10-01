-- Biography lifecycle: auditoria de geração + contexto de trait de personalidade.
-- Aditiva: novos enums/tabela, coluna com default e troca de índice único.
CREATE TYPE "BiographyGenerationStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'SUCCEEDED_FALLBACK', 'FAILED', 'CANCELLED');
CREATE TYPE "BiographyGenerationMode" AS ENUM ('LLM', 'RICH_DETERMINISTIC', 'COMPACT_FALLBACK');

CREATE TABLE "BiographyGenerationRun" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "externalDriverId" UUID,
    "status" "BiographyGenerationStatus" NOT NULL DEFAULT 'PENDING',
    "mode" "BiographyGenerationMode",
    "provider" TEXT,
    "model" TEXT,
    "prompt" JSONB,
    "promptVersion" TEXT NOT NULL,
    "promptHash" TEXT NOT NULL,
    "evidenceVersion" TEXT,
    "generatorVersion" TEXT NOT NULL,
    "fingerprint" TEXT,
    "fallbackReason" TEXT,
    "failureReason" TEXT,
    "outputSourceId" UUID,
    "timings" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BiographyGenerationRun_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BiographyGenerationRun_characterId_status_idx" ON "BiographyGenerationRun"("characterId", "status");
CREATE INDEX "BiographyGenerationRun_status_startedAt_idx" ON "BiographyGenerationRun"("status", "startedAt");

ALTER TABLE "BiographyGenerationRun" ADD CONSTRAINT "BiographyGenerationRun_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TYPE "PersonaTraitContext" AS ENUM ('ON_TRACK', 'OFF_TRACK');
ALTER TABLE "PersonaTrait" ADD COLUMN "context" "PersonaTraitContext" NOT NULL DEFAULT 'ON_TRACK';
DROP INDEX "PersonaTrait_personaId_key_key";
CREATE UNIQUE INDEX "PersonaTrait_personaId_key_context_key" ON "PersonaTrait"("personaId", "key", "context");
