-- CreateEnum
CREATE TYPE "PilotEvolutionStatus" AS ENUM ('ACTIVE', 'SUPERSEDED');

-- AlterTable
ALTER TABLE "PersonaTraitEvolution" ADD COLUMN "status" "PilotEvolutionStatus" NOT NULL DEFAULT 'ACTIVE';

-- CreateIndex
CREATE INDEX "PersonaTraitEvolution_personaId_status_idx" ON "PersonaTraitEvolution"("personaId", "status");
