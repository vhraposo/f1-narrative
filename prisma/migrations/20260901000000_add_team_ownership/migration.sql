-- DropIndex
DROP INDEX "Team_name_key";

-- AlterTable
ALTER TABLE "Team" ADD COLUMN     "userId" UUID NOT NULL;

-- CreateIndex
CREATE INDEX "Team_userId_idx" ON "Team"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_userId_name_key" ON "Team"("userId", "name");

-- AddForeignKey
ALTER TABLE "Team" ADD CONSTRAINT "Team_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

