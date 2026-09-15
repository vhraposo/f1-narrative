-- CreateTable
CREATE TABLE "UniverseEditorDecision" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "signature" TEXT NOT NULL,
    "seats" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UniverseEditorDecision_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UniverseEditorDecision_userId_seasonId_teamId_signature_key" ON "UniverseEditorDecision"("userId", "seasonId", "teamId", "signature");

-- CreateIndex
CREATE INDEX "UniverseEditorDecision_userId_seasonId_teamId_idx" ON "UniverseEditorDecision"("userId", "seasonId", "teamId");

-- AddForeignKey
ALTER TABLE "UniverseEditorDecision" ADD CONSTRAINT "UniverseEditorDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseEditorDecision" ADD CONSTRAINT "UniverseEditorDecision_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UniverseEditorDecision" ADD CONSTRAINT "UniverseEditorDecision_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;