-- CreateTable
CREATE TABLE "DriverAttribute" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "speed" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "consistency" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "racecraft" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "aggression" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverAttribute_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DriverAttribute_seasonId_idx" ON "DriverAttribute"("seasonId");

-- CreateIndex
CREATE INDEX "DriverAttribute_driverProfileId_idx" ON "DriverAttribute"("driverProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverAttribute_seasonId_driverProfileId_key" ON "DriverAttribute"("seasonId", "driverProfileId");

-- AddForeignKey
ALTER TABLE "DriverAttribute" ADD CONSTRAINT "DriverAttribute_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverAttribute" ADD CONSTRAINT "DriverAttribute_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
