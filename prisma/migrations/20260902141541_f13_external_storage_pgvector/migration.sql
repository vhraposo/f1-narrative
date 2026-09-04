-- Fase 13 STEP 2 — pgvector gate.
-- Provisiona a extensão vector de forma reproduzível (DEV e TEST). Executada
-- ANTES de qualquer CREATE/ALTER que venha a depender do tipo vector no futuro.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "ExternalSourceType" AS ENUM ('ARTICLE', 'WEBSITE', 'DOCUMENT', 'DATABASE', 'API', 'SEARCH_RESULT');

-- CreateEnum
CREATE TYPE "ExternalSourceVisibility" AS ENUM ('PRIVATE', 'SHARED', 'PUBLIC');

-- CreateEnum
CREATE TYPE "ExternalDocumentStatus" AS ENUM ('NEW', 'READY', 'STALE', 'FAILED');

-- AlterTable
ALTER TABLE "ExternalSource" ADD COLUMN     "ownerId" UUID,
ADD COLUMN     "sourceType" "ExternalSourceType",
ADD COLUMN     "visibility" "ExternalSourceVisibility" NOT NULL DEFAULT 'PRIVATE';

-- CreateTable
CREATE TABLE "ExternalDocument" (
    "id" UUID NOT NULL,
    "sourceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "status" "ExternalDocumentStatus" NOT NULL DEFAULT 'NEW',
    "publishedAt" TIMESTAMP(3),
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalChunk" (
    "id" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "text" TEXT NOT NULL,
    "orderOriginal" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embeddingProvider" TEXT,
    "embeddingModel" TEXT,
    "embeddingVersion" TEXT,
    "embeddingDimensions" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExternalChunk_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExternalDocument_sourceId_idx" ON "ExternalDocument"("sourceId");

-- CreateIndex
CREATE INDEX "ExternalDocument_status_idx" ON "ExternalDocument"("status");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalDocument_sourceId_contentHash_key" ON "ExternalDocument"("sourceId", "contentHash");

-- CreateIndex
CREATE INDEX "ExternalChunk_documentId_idx" ON "ExternalChunk"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExternalChunk_documentId_orderOriginal_key" ON "ExternalChunk"("documentId", "orderOriginal");

-- CreateIndex
CREATE INDEX "ExternalSource_ownerId_idx" ON "ExternalSource"("ownerId");

-- CreateIndex
CREATE INDEX "ExternalSource_sourceType_idx" ON "ExternalSource"("sourceType");

-- AddForeignKey
ALTER TABLE "ExternalSource" ADD CONSTRAINT "ExternalSource_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalDocument" ADD CONSTRAINT "ExternalDocument_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ExternalSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExternalChunk" ADD CONSTRAINT "ExternalChunk_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ExternalDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;
