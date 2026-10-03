CREATE TYPE "ConversationVisibility" AS ENUM (
  'PRIVATE',
  'UNIVERSE'
);

ALTER TABLE "Conversation"
  ADD COLUMN "visibility" "ConversationVisibility" NOT NULL DEFAULT 'PRIVATE';
