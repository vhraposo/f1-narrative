-- Migration aditiva: auditoria de decisões de AI Behavior (V3 Fase 9).
-- Nenhuma operação destrutiva; não altera dados existentes.

CREATE TYPE "AiDecisionStatus" AS ENUM ('NO_ACTION', 'DECIDED', 'EXECUTING', 'EXECUTED', 'REJECTED', 'FAILED');
CREATE TYPE "AiActionType" AS ENUM ('NO_ACTION', 'SEND_MESSAGE', 'CREATE_EVENT');

CREATE TABLE "AiDecision" (
    "id" UUID NOT NULL,
    "universeId" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "status" "AiDecisionStatus" NOT NULL,
    "actionType" "AiActionType" NOT NULL DEFAULT 'NO_ACTION',
    "conversationId" UUID,
    "reason" TEXT,
    "contextVersion" TEXT NOT NULL,
    "policyCode" TEXT,
    "executedMessageId" UUID,
    "executedEventId" UUID,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AiDecision_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AiDecision_universeId_characterId_createdAt_idx" ON "AiDecision"("universeId", "characterId", "createdAt");
CREATE INDEX "AiDecision_characterId_status_actionType_createdAt_idx" ON "AiDecision"("characterId", "status", "actionType", "createdAt");

ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_universeId_fkey" FOREIGN KEY ("universeId") REFERENCES "Universe"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AiDecision" ADD CONSTRAINT "AiDecision_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
