-- AlterEnum
ALTER TYPE "TimelineEventKind" ADD VALUE 'PERSONA_UPDATED';

-- CreateEnum
CREATE TYPE "PilotExperienceType" AS ENUM ('CAREER_MILESTONE', 'SPORTING_VICTORY', 'SPORTING_DEFEAT', 'CHAMPIONSHIP', 'TEAM_CHANGE', 'RELATIONSHIP_EVENT', 'CONFLICT', 'PERSONAL_MILESTONE', 'NARRATIVE_EVENT', 'SIGNIFICANT_RACE', 'OTHER_RELEVANT_EXPERIENCE');

-- CreateEnum
CREATE TYPE "PilotExperienceSource" AS ENUM ('RACE_RESULT', 'STANDING', 'TIMELINE_CORRECTION', 'UNIVERSE_EVENT', 'RELATIONSHIP', 'CURATED');

-- CreateEnum
CREATE TYPE "PilotExperienceStatus" AS ENUM ('ACTIVE', 'INVALIDATED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PilotMemoryDerivation" AS ENUM ('MANUAL', 'DERIVED', 'RULE_DERIVED');

-- CreateEnum
CREATE TYPE "PilotMemoryStatus" AS ENUM ('ACTIVE', 'ARCHIVED', 'SUPERSEDED', 'INVALIDATED');

-- AlterTable
ALTER TABLE "Memory" ADD COLUMN "universeId" UUID,
ADD COLUMN "memoryType" "PilotExperienceType",
ADD COLUMN "derivation" "PilotMemoryDerivation" NOT NULL DEFAULT 'MANUAL',
ADD COLUMN "status" "PilotMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
ADD COLUMN "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN "experienceId" UUID,
ADD COLUMN "timelineEventId" UUID,
ADD COLUMN "derivedKey" TEXT,
ADD COLUMN "updatedByRevisionAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "CharacterPersona" ADD COLUMN "evolutionRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "evolutionAppliedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PilotExperience" (
    "id" UUID NOT NULL,
    "universeId" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "experienceType" "PilotExperienceType" NOT NULL,
    "source" "PilotExperienceSource" NOT NULL,
    "sourceKey" TEXT NOT NULL,
    "seasonYear" INTEGER,
    "seasonId" UUID,
    "raceId" UUID,
    "eventId" UUID,
    "timelineEventId" UUID,
    "occurredAt" TIMESTAMP(3),
    "salience" "MemoryImportance" NOT NULL DEFAULT 'MEDIUM',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "status" "PilotExperienceStatus" NOT NULL DEFAULT 'ACTIVE',
    "invalidationReason" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PilotExperience_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaTraitEvolution" (
    "id" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "traitKey" TEXT NOT NULL,
    "ruleCode" TEXT NOT NULL,
    "rulePriority" INTEGER NOT NULL,
    "value" TEXT,
    "confidenceDelta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "sourceExperienceId" UUID,
    "fingerprint" TEXT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PersonaTraitEvolution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PilotExperience_universeId_characterId_source_sourceKey_key" ON "PilotExperience"("universeId", "characterId", "source", "sourceKey");

-- CreateIndex
CREATE INDEX "PilotExperience_universeId_characterId_status_idx" ON "PilotExperience"("universeId", "characterId", "status");

-- CreateIndex
CREATE INDEX "PilotExperience_universeId_seasonId_idx" ON "PilotExperience"("universeId", "seasonId");

-- CreateIndex
CREATE INDEX "PilotExperience_universeId_raceId_idx" ON "PilotExperience"("universeId", "raceId");

-- CreateIndex
CREATE INDEX "Memory_universeId_status_idx" ON "Memory"("universeId", "status");

-- CreateIndex
CREATE INDEX "Memory_universeId_derivedKey_idx" ON "Memory"("universeId", "derivedKey");

-- CreateIndex
CREATE INDEX "Memory_experienceId_idx" ON "Memory"("experienceId");

-- CreateIndex
CREATE INDEX "Memory_timelineEventId_idx" ON "Memory"("timelineEventId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaTraitEvolution_fingerprint_key" ON "PersonaTraitEvolution"("fingerprint");

-- CreateIndex
CREATE INDEX "PersonaTraitEvolution_personaId_traitKey_idx" ON "PersonaTraitEvolution"("personaId", "traitKey");

-- CreateIndex
CREATE INDEX "PersonaTraitEvolution_sourceExperienceId_idx" ON "PersonaTraitEvolution"("sourceExperienceId");

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "PilotExperience"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_timelineEventId_fkey" FOREIGN KEY ("timelineEventId") REFERENCES "TimelineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotExperience" ADD CONSTRAINT "PilotExperience_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotExperience" ADD CONSTRAINT "PilotExperience_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotExperience" ADD CONSTRAINT "PilotExperience_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotExperience" ADD CONSTRAINT "PilotExperience_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotExperience" ADD CONSTRAINT "PilotExperience_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PilotExperience" ADD CONSTRAINT "PilotExperience_timelineEventId_fkey" FOREIGN KEY ("timelineEventId") REFERENCES "TimelineEvent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaTraitEvolution" ADD CONSTRAINT "PersonaTraitEvolution_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "CharacterPersona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaTraitEvolution" ADD CONSTRAINT "PersonaTraitEvolution_sourceExperienceId_fkey" FOREIGN KEY ("sourceExperienceId") REFERENCES "PilotExperience"("id") ON DELETE SET NULL ON UPDATE CASCADE;
