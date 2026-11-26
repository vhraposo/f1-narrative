CREATE TYPE "ConversationStatus" AS ENUM (
  'ACTIVE',
  'PAUSED',
  'COMPLETED',
  'CANCELLED'
);

ALTER TABLE "Conversation"
  ADD COLUMN "status" "ConversationStatus" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "Conversation_status_idx" ON "Conversation"("status");
