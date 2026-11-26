CREATE TYPE "CharacterGoalKind" AS ENUM (
  'WIN_RACE',
  'WIN_CHAMPIONSHIP',
  'OUTPERFORM_TEAMMATE',
  'RECOVER_AFTER_SETBACK',
  'PROTECT_RELATIONSHIP',
  'CONFRONT_RIVAL',
  'SUPPORT_FRIEND',
  'MAINTAIN_POSITION',
  'BUILD_REPUTATION',
  'RESTORE_CONFIDENCE',
  'USER_DEFINED_GOAL'
);

CREATE TYPE "CharacterGoalStatus" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'EXPIRED',
  'CANCELLED'
);

CREATE TYPE "CharacterGoalSource" AS ENUM (
  'SYSTEM',
  'MANUAL',
  'DERIVED'
);

CREATE TABLE "CharacterGoal" (
  "id" UUID NOT NULL,
  "universeId" UUID NOT NULL,
  "characterId" UUID NOT NULL,
  "kind" "CharacterGoalKind" NOT NULL,
  "priority" INTEGER NOT NULL DEFAULT 50,
  "status" "CharacterGoalStatus" NOT NULL DEFAULT 'ACTIVE',
  "source" "CharacterGoalSource" NOT NULL DEFAULT 'SYSTEM',
  "ruleCode" TEXT,
  "fingerprint" TEXT,
  "targetCharacterId" UUID,
  "targetRaceId" UUID,
  "seasonId" UUID,
  "validFrom" TIMESTAMP(3),
  "validTo" TIMESTAMP(3),
  "progress" JSONB,
  "metadata" JSONB,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "CharacterGoal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CharacterGoal_universeId_fingerprint_key"
  ON "CharacterGoal"("universeId", "fingerprint");
CREATE INDEX "CharacterGoal_universeId_characterId_status_idx"
  ON "CharacterGoal"("universeId", "characterId", "status");
CREATE INDEX "CharacterGoal_characterId_status_idx"
  ON "CharacterGoal"("characterId", "status");
CREATE INDEX "CharacterGoal_universeId_kind_status_idx"
  ON "CharacterGoal"("universeId", "kind", "status");
CREATE INDEX "CharacterGoal_validTo_idx"
  ON "CharacterGoal"("validTo");

ALTER TABLE "CharacterGoal"
  ADD CONSTRAINT "CharacterGoal_universeId_fkey"
  FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CharacterGoal"
  ADD CONSTRAINT "CharacterGoal_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
