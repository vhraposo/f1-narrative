CREATE TYPE "EventVisibility" AS ENUM (
  'PUBLIC',
  'RESTRICTED'
);

ALTER TABLE "Event"
  ADD COLUMN "visibility" "EventVisibility" NOT NULL DEFAULT 'PUBLIC';
