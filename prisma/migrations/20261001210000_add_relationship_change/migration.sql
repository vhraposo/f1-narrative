CREATE TABLE "RelationshipChange" (
  "id" UUID NOT NULL,
  "relationshipId" UUID NOT NULL,
  "characterAId" UUID NOT NULL,
  "characterBId" UUID NOT NULL,
  "dimension" TEXT NOT NULL,
  "previousValue" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL,
  "resultingValue" INTEGER NOT NULL,
  "ruleCode" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT,
  "worldDate" TIMESTAMP(3),
  "fingerprint" TEXT NOT NULL,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "RelationshipChange_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RelationshipChange_fingerprint_key"
  ON "RelationshipChange"("fingerprint");
CREATE INDEX "RelationshipChange_relationshipId_createdAt_idx"
  ON "RelationshipChange"("relationshipId", "createdAt");
CREATE INDEX "RelationshipChange_characterAId_characterBId_createdAt_idx"
  ON "RelationshipChange"("characterAId", "characterBId", "createdAt");
CREATE INDEX "RelationshipChange_sourceType_sourceId_idx"
  ON "RelationshipChange"("sourceType", "sourceId");

ALTER TABLE "RelationshipChange"
  ADD CONSTRAINT "RelationshipChange_relationshipId_fkey"
  FOREIGN KEY ("relationshipId") REFERENCES "Relationship"("id") ON DELETE CASCADE ON UPDATE CASCADE;
