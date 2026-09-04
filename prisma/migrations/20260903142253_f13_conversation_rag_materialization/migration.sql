-- CreateEnum
CREATE TYPE "ConversationRagFrameStatus" AS ENUM ('READY', 'FAILED');

-- CreateEnum
CREATE TYPE "ConversationRagSnapshotStatus" AS ENUM ('NEW', 'MATERIALIZING', 'READY', 'STALE', 'FAILED');

-- CreateTable
CREATE TABLE "ConversationRagFrame" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "queryText" TEXT NOT NULL,
    "queryHash" TEXT NOT NULL,
    "scopeSourceIds" JSONB,
    "topK" INTEGER NOT NULL,
    "threshold" DOUBLE PRECISION NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "ruleApplied" TEXT NOT NULL,
    "frameKey" TEXT NOT NULL,
    "status" "ConversationRagFrameStatus" NOT NULL DEFAULT 'READY',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationRagFrame_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationRagSnapshot" (
    "id" UUID NOT NULL,
    "frameId" UUID NOT NULL,
    "snapshotKey" TEXT NOT NULL,
    "status" "ConversationRagSnapshotStatus" NOT NULL DEFAULT 'NEW',
    "retrievedAt" TIMESTAMP(3) NOT NULL,
    "freshnessAnchor" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConversationRagSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationRagSnapshotItem" (
    "id" UUID NOT NULL,
    "snapshotId" UUID NOT NULL,
    "chunkId" UUID NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "order" INTEGER NOT NULL,
    "citation" TEXT NOT NULL,

    CONSTRAINT "ConversationRagSnapshotItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationRagFrame_conversationId_createdAt_idx" ON "ConversationRagFrame"("conversationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRagFrame_conversationId_frameKey_key" ON "ConversationRagFrame"("conversationId", "frameKey");

-- CreateIndex
CREATE INDEX "ConversationRagSnapshot_frameId_status_idx" ON "ConversationRagSnapshot"("frameId", "status");

-- CreateIndex
CREATE INDEX "ConversationRagSnapshot_status_retrievedAt_idx" ON "ConversationRagSnapshot"("status", "retrievedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRagSnapshot_frameId_snapshotKey_key" ON "ConversationRagSnapshot"("frameId", "snapshotKey");

-- CreateIndex
CREATE INDEX "ConversationRagSnapshotItem_chunkId_idx" ON "ConversationRagSnapshotItem"("chunkId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationRagSnapshotItem_snapshotId_chunkId_key" ON "ConversationRagSnapshotItem"("snapshotId", "chunkId");

-- AddForeignKey
ALTER TABLE "ConversationRagFrame" ADD CONSTRAINT "ConversationRagFrame_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRagSnapshot" ADD CONSTRAINT "ConversationRagSnapshot_frameId_fkey" FOREIGN KEY ("frameId") REFERENCES "ConversationRagFrame"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRagSnapshotItem" ADD CONSTRAINT "ConversationRagSnapshotItem_snapshotId_fkey" FOREIGN KEY ("snapshotId") REFERENCES "ConversationRagSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationRagSnapshotItem" ADD CONSTRAINT "ConversationRagSnapshotItem_chunkId_fkey" FOREIGN KEY ("chunkId") REFERENCES "ExternalChunk"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
