-- AlterTable
ALTER TABLE "Event" ADD COLUMN "createdById" UUID;

-- CreateIndex
CREATE INDEX "Event_createdById_idx" ON "Event"("createdById");

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
