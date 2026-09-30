-- CreateEnum
CREATE TYPE "PersonaOrigin" AS ENUM ('ORIGINAL', 'REAL_DRIVER', 'AI_CHARACTER');

-- CreateEnum
CREATE TYPE "PersonaTraitSource" AS ENUM ('MANUAL', 'EVIDENCE');

-- CreateEnum
CREATE TYPE "PersonaEvidenceType" AS ENUM ('OFFICIAL_PROFILE', 'INTERVIEW', 'BIOGRAPHY', 'PUBLIC_STATEMENT', 'OTHER_APPROVED');

-- CreateEnum
CREATE TYPE "PersonaEvidenceStatus" AS ENUM ('PROPOSED', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "CharacterPersona" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "origin" "PersonaOrigin" NOT NULL,
    "summary" TEXT,
    "schemaVersion" TEXT NOT NULL DEFAULT 'persona.v1',
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterPersona_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaTrait" (
    "id" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "sourceKind" "PersonaTraitSource" NOT NULL,
    "evidenceId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonaTrait_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PersonaEvidence" (
    "id" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "traitKey" TEXT NOT NULL,
    "proposedValue" TEXT NOT NULL,
    "sourceType" "PersonaEvidenceType" NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT,
    "publishedAt" TIMESTAMP(3),
    "excerpt" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "status" "PersonaEvidenceStatus" NOT NULL DEFAULT 'PROPOSED',
    "createdById" UUID,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonaEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CharacterPersona_characterId_key" ON "CharacterPersona"("characterId");

-- CreateIndex
CREATE INDEX "PersonaTrait_personaId_idx" ON "PersonaTrait"("personaId");

-- CreateIndex
CREATE INDEX "PersonaTrait_evidenceId_idx" ON "PersonaTrait"("evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "PersonaTrait_personaId_key_key" ON "PersonaTrait"("personaId", "key");

-- CreateIndex
CREATE INDEX "PersonaEvidence_personaId_status_idx" ON "PersonaEvidence"("personaId", "status");

-- CreateIndex
CREATE INDEX "PersonaEvidence_personaId_traitKey_idx" ON "PersonaEvidence"("personaId", "traitKey");

-- AddForeignKey
ALTER TABLE "CharacterPersona" ADD CONSTRAINT "CharacterPersona_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterPersona" ADD CONSTRAINT "CharacterPersona_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaTrait" ADD CONSTRAINT "PersonaTrait_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "CharacterPersona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaTrait" ADD CONSTRAINT "PersonaTrait_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "PersonaEvidence"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaEvidence" ADD CONSTRAINT "PersonaEvidence_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "CharacterPersona"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaEvidence" ADD CONSTRAINT "PersonaEvidence_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PersonaEvidence" ADD CONSTRAINT "PersonaEvidence_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

