-- AlterTable
ALTER TABLE "ExternalSeason" ADD COLUMN     "contentHash" TEXT NOT NULL,
ADD COLUMN     "sourceRecord" JSONB;

-- AlterTable
ALTER TABLE "ExternalRace" ADD COLUMN     "contentHash" TEXT NOT NULL,
ADD COLUMN     "sourceRecord" JSONB;
