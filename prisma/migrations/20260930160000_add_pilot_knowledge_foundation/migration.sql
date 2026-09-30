-- CreateEnum
CREATE TYPE "ExternalKnowledgeProvider" AS ENUM ('F1DB', 'WIKIDATA', 'F1_OFFICIAL', 'FIA_OFFICIAL', 'TEAM_OFFICIAL', 'DRIVER_OFFICIAL', 'REPUTABLE_NEWS', 'CURATED');

-- CreateEnum
CREATE TYPE "ExternalKnowledgeSourceKind" AS ENUM ('STRUCTURED_RELEASE', 'OFFICIAL_PROFILE', 'INTERVIEW', 'PRESS_CONFERENCE', 'BIOGRAPHY_PAGE', 'NEWS_REPORT', 'DATABASE_EXPORT', 'PUBLIC_STATEMENT');

-- CreateEnum
CREATE TYPE "ExternalKnowledgeLicense" AS ENUM ('CC_BY_4_0', 'CC0', 'CC_BY_SA_4_0', 'PROPRIETARY_REFERENCE_ONLY', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExternalRefreshStatus" AS ENUM ('FRESH', 'STALE', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExternalClaimStatus" AS ENUM ('SUPPORTED', 'UNCERTAIN', 'CONFLICT', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExternalPublicTraitSource" AS ENUM ('DIRECT_SELF_DESCRIPTION', 'OBSERVED_PUBLIC_BEHAVIOR', 'INFERRED');

-- CreateEnum
CREATE TYPE "ExternalPublicEvidenceType" AS ENUM ('SELF_DESCRIPTION', 'OFFICIAL_INTERVIEW', 'FIA_TRANSCRIPT', 'TEAM_PROFILE', 'F1_PROFILE', 'DRIVER_OFFICIAL', 'REPUTABLE_NEWS', 'STRUCTURED_DATA');

-- CreateEnum
CREATE TYPE "DriverRelationshipKind" AS ENUM ('ROMANTIC_PARTNER', 'SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'TEAMMATE', 'TEAM_RELATION', 'MENTOR', 'OTHER_PUBLIC_RELATION');

-- CreateEnum
CREATE TYPE "DriverRelationshipTarget" AS ENUM ('DRIVER', 'PUBLIC_PERSON');

-- CreateEnum
CREATE TYPE "DriverRelationshipState" AS ENUM ('ACTIVE', 'ENDED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "ExternalDriverEventCategory" AS ENUM ('F1_DEBUT', 'FIRST_POINT', 'FIRST_PODIUM', 'FIRST_POLE', 'FIRST_WIN', 'FIRST_CHAMPIONSHIP', 'CHAMPIONSHIP', 'TEAM_CHANGE', 'MAJOR_CAREER_MILESTONE', 'SIGNIFICANT_RACE', 'CAREER_ENTRY');

-- CreateEnum
CREATE TYPE "ExternalEventDerivation" AS ENUM ('DERIVED_RESULTS', 'DERIVED_STANDINGS', 'CURATED_SOURCE');

-- CreateTable
CREATE TABLE "ExternalKnowledgeSource" (
    "id" UUID NOT NULL,
    "provider" "ExternalKnowledgeProvider" NOT NULL,
    "sourceKind" "ExternalKnowledgeSourceKind" NOT NULL,
    "url" TEXT,
    "title" TEXT,
    "license" "ExternalKnowledgeLicense" NOT NULL DEFAULT 'UNKNOWN',
    "attributionRequirement" TEXT,
    "attributionText" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceVersion" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalKnowledgeSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalDriverProfile" (
    "id" UUID NOT NULL,
    "externalDriverId" UUID NOT NULL,
    "fullName" TEXT,
    "publicName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "placeOfBirth" TEXT,
    "nationality" TEXT,
    "representedCountry" TEXT,
    "driverNumber" INTEGER,
    "driverCode" TEXT,
    "currentTeamName" TEXT,
    "officialLinks" JSONB,
    "biographyDisplay" TEXT,
    "biographyContext" TEXT,
    "biographySourceId" UUID,
    "wikidataQid" TEXT,
    "f1dbDriverId" TEXT,
    "refreshStatus" "ExternalRefreshStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastVerifiedAt" TIMESTAMP(3),
    "sourceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalDriverPersona" (
    "id" UUID NOT NULL,
    "profileId" UUID NOT NULL,
    "schemaVersion" TEXT NOT NULL DEFAULT 'external-persona.v1',
    "summary" TEXT,
    "status" "ExternalClaimStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDriverPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPersonaTrait" (
    "id" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "traitKey" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "sourceKind" "ExternalPublicTraitSource" NOT NULL,
    "status" "ExternalClaimStatus" NOT NULL DEFAULT 'SUPPORTED',
    "confidence" DOUBLE PRECISION,
    "evidenceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPersonaTrait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalPersonaEvidence" (
    "id" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "traitKey" TEXT NOT NULL,
    "proposedValue" TEXT NOT NULL,
    "evidenceType" "ExternalPublicEvidenceType" NOT NULL,
    "sourceId" UUID,
    "summary" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "status" "ExternalClaimStatus" NOT NULL DEFAULT 'SUPPORTED',
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalPersonaEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalDriverRelationship" (
    "id" UUID NOT NULL,
    "externalDriverId" UUID NOT NULL,
    "kind" "DriverRelationshipKind" NOT NULL,
    "targetType" "DriverRelationshipTarget" NOT NULL,
    "targetExternalDriverId" UUID,
    "targetWikidataQid" TEXT,
    "displayName" TEXT NOT NULL,
    "state" "DriverRelationshipState" NOT NULL DEFAULT 'UNKNOWN',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "sourceId" UUID,
    "confidence" DOUBLE PRECISION,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDriverRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalDriverEvent" (
    "id" UUID NOT NULL,
    "externalDriverId" UUID NOT NULL,
    "category" "ExternalDriverEventCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3),
    "seasonYear" INTEGER,
    "externalRaceId" UUID,
    "summary" TEXT,
    "importance" INTEGER NOT NULL DEFAULT 3,
    "derivation" "ExternalEventDerivation" NOT NULL,
    "sourceId" UUID,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDriverEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UniverseDriverRelationship" (
    "id" UUID NOT NULL,
    "universeId" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "kind" "DriverRelationshipKind" NOT NULL,
    "targetType" "DriverRelationshipTarget" NOT NULL,
    "targetCharacterId" UUID,
    "targetWikidataQid" TEXT,
    "displayName" TEXT NOT NULL,
    "state" "DriverRelationshipState" NOT NULL DEFAULT 'UNKNOWN',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UniverseDriverRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalKnowledgeSource_provider_retrievedAt_idx" ON "ExternalKnowledgeSource"("provider", "retrievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalKnowledgeSource_provider_url_key" ON "ExternalKnowledgeSource"("provider", "url");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDriverProfile_externalDriverId_key" ON "ExternalDriverProfile"("externalDriverId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDriverProfile_wikidataQid_key" ON "ExternalDriverProfile"("wikidataQid");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDriverProfile_f1dbDriverId_key" ON "ExternalDriverProfile"("f1dbDriverId");

-- CreateIndex
CREATE INDEX "ExternalDriverProfile_refreshStatus_lastVerifiedAt_idx" ON "ExternalDriverProfile"("refreshStatus", "lastVerifiedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDriverPersona_profileId_key" ON "ExternalDriverPersona"("profileId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalPersonaTrait_personaId_traitKey_key" ON "ExternalPersonaTrait"("personaId", "traitKey");

-- CreateIndex
CREATE INDEX "ExternalPersonaTrait_personaId_idx" ON "ExternalPersonaTrait"("personaId");

-- CreateIndex
CREATE INDEX "ExternalPersonaTrait_evidenceId_idx" ON "ExternalPersonaTrait"("evidenceId");

-- CreateIndex
CREATE INDEX "ExternalPersonaEvidence_personaId_traitKey_idx" ON "ExternalPersonaEvidence"("personaId", "traitKey");

-- CreateIndex
CREATE INDEX "ExternalPersonaEvidence_personaId_status_idx" ON "ExternalPersonaEvidence"("personaId", "status");

-- CreateIndex
CREATE INDEX "ExternalDriverRelationship_externalDriverId_kind_idx" ON "ExternalDriverRelationship"("externalDriverId", "kind");

-- CreateIndex
CREATE INDEX "ExternalDriverRelationship_targetExternalDriverId_idx" ON "ExternalDriverRelationship"("targetExternalDriverId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDriverEvent_externalDriverId_dedupeKey_key" ON "ExternalDriverEvent"("externalDriverId", "dedupeKey");

-- CreateIndex
CREATE INDEX "ExternalDriverEvent_externalDriverId_eventDate_idx" ON "ExternalDriverEvent"("externalDriverId", "eventDate");

-- CreateIndex
CREATE INDEX "UniverseDriverRelationship_universeId_characterId_kind_idx" ON "UniverseDriverRelationship"("universeId", "characterId", "kind");

-- CreateIndex
CREATE INDEX "UniverseDriverRelationship_targetCharacterId_idx" ON "UniverseDriverRelationship"("targetCharacterId");

-- AddForeignKey
ALTER TABLE "ExternalDriverProfile" ADD CONSTRAINT "ExternalDriverProfile_externalDriverId_fkey" FOREIGN KEY ("externalDriverId") REFERENCES "ExternalDriver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverProfile" ADD CONSTRAINT "ExternalDriverProfile_biographySourceId_fkey" FOREIGN KEY ("biographySourceId") REFERENCES "ExternalKnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverProfile" ADD CONSTRAINT "ExternalDriverProfile_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalKnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverPersona" ADD CONSTRAINT "ExternalDriverPersona_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "ExternalDriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPersonaTrait" ADD CONSTRAINT "ExternalPersonaTrait_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "ExternalDriverPersona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPersonaTrait" ADD CONSTRAINT "ExternalPersonaTrait_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "ExternalPersonaEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPersonaEvidence" ADD CONSTRAINT "ExternalPersonaEvidence_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "ExternalDriverPersona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalPersonaEvidence" ADD CONSTRAINT "ExternalPersonaEvidence_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalKnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverRelationship" ADD CONSTRAINT "ExternalDriverRelationship_externalDriverId_fkey" FOREIGN KEY ("externalDriverId") REFERENCES "ExternalDriver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverRelationship" ADD CONSTRAINT "ExternalDriverRelationship_targetExternalDriverId_fkey" FOREIGN KEY ("targetExternalDriverId") REFERENCES "ExternalDriver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverRelationship" ADD CONSTRAINT "ExternalDriverRelationship_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalKnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverEvent" ADD CONSTRAINT "ExternalDriverEvent_externalDriverId_fkey" FOREIGN KEY ("externalDriverId") REFERENCES "ExternalDriver"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverEvent" ADD CONSTRAINT "ExternalDriverEvent_externalRaceId_fkey" FOREIGN KEY ("externalRaceId") REFERENCES "ExternalRace"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDriverEvent" ADD CONSTRAINT "ExternalDriverEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalKnowledgeSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseDriverRelationship" ADD CONSTRAINT "UniverseDriverRelationship_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseDriverRelationship" ADD CONSTRAINT "UniverseDriverRelationship_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseDriverRelationship" ADD CONSTRAINT "UniverseDriverRelationship_targetCharacterId_fkey" FOREIGN KEY ("targetCharacterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseDriverRelationship" ADD CONSTRAINT "UniverseDriverRelationship_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
