-- CreateTable
CREATE TABLE "TeamPerformance" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "teamId" UUID NOT NULL,
    "carSpeed" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "reliability" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "operations" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TeamPerformance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TeamPerformance_seasonId_idx" ON "TeamPerformance"("seasonId");

-- CreateIndex
CREATE INDEX "TeamPerformance_teamId_idx" ON "TeamPerformance"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamPerformance_seasonId_teamId_key" ON "TeamPerformance"("seasonId", "teamId");

-- AddForeignKey
ALTER TABLE "TeamPerformance" ADD CONSTRAINT "TeamPerformance_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TeamPerformance" ADD CONSTRAINT "TeamPerformance_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
