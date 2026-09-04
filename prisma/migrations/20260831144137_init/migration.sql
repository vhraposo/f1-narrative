-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "CharacterController" AS ENUM ('USER', 'AI');

-- CreateEnum
CREATE TYPE "SeasonStatus" AS ENUM ('PRE_SEASON', 'ACTIVE', 'FINISHED');

-- CreateEnum
CREATE TYPE "RaceStatus" AS ENUM ('UPCOMING', 'QUALIFYING', 'RACE', 'FINISHED');

-- CreateEnum
CREATE TYPE "RaceSession" AS ENUM ('PRACTICE', 'QUALIFYING', 'RACE');

-- CreateEnum
CREATE TYPE "ConversationType" AS ENUM ('GROUP', 'DM');

-- CreateEnum
CREATE TYPE "MessageSenderType" AS ENUM ('USER_CHARACTER', 'AI_CHARACTER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MemoryImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "CanonSource" AS ENUM ('CANON', 'USER_DEFINED', 'GENERATED_EVENT', 'EXTERNAL_INFORMATION');

-- CreateEnum
CREATE TYPE "EventType" AS ENUM ('RACE', 'RACE_INCIDENT', 'RELATIONSHIP', 'SOCIAL', 'PERSONAL', 'NEWS', 'WORLD');

-- CreateEnum
CREATE TYPE "EventImportance" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "AvailabilityStatus" AS ENUM ('AVAILABLE', 'BUSY', 'TRAINING', 'TRAVELING', 'SLEEPING', 'RACE_WEEKEND', 'OFFLINE');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "password" TEXT,
    "role" "Role" NOT NULL DEFAULT 'USER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Character" (
    "id" UUID NOT NULL,
    "userId" UUID,
    "controlledBy" "CharacterController" NOT NULL DEFAULT 'USER',
    "name" TEXT NOT NULL,
    "nationality" TEXT NOT NULL,
    "gender" TEXT,
    "birthDate" TIMESTAMP(3) NOT NULL,
    "imageUrl" TEXT,
    "dna" JSONB NOT NULL DEFAULT '{}',
    "biography" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Character_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriverProfile" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "teamId" UUID,
    "number" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DriverProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Team" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shortName" TEXT,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Season" (
    "id" UUID NOT NULL,
    "year" INTEGER NOT NULL,
    "name" TEXT,
    "status" "SeasonStatus" NOT NULL DEFAULT 'PRE_SEASON',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Season_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Race" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "circuit" TEXT,
    "country" TEXT,
    "date" TIMESTAMP(3),
    "round" INTEGER,
    "status" "RaceStatus" NOT NULL DEFAULT 'UPCOMING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Race_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RaceResult" (
    "id" UUID NOT NULL,
    "raceId" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "position" INTEGER,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "grid" INTEGER,
    "fastestLap" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RaceResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChampionshipStanding" (
    "id" UUID NOT NULL,
    "seasonId" UUID NOT NULL,
    "driverProfileId" UUID NOT NULL,
    "points" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "position" INTEGER,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "podiums" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChampionshipStanding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" UUID NOT NULL,
    "title" TEXT,
    "type" "ConversationType" NOT NULL DEFAULT 'GROUP',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConversationParticipant" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationParticipant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderType" "MessageSenderType" NOT NULL,
    "characterId" UUID,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Memory" (
    "id" UUID NOT NULL,
    "eventId" UUID,
    "importance" "MemoryImportance" NOT NULL DEFAULT 'LOW',
    "source" "CanonSource" NOT NULL DEFAULT 'USER_DEFINED',
    "content" TEXT NOT NULL,
    "summary" TEXT,
    "context" JSONB,
    "emotionalImpact" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Memory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemoryCharacter" (
    "id" UUID NOT NULL,
    "memoryId" UUID NOT NULL,
    "characterId" UUID NOT NULL,

    CONSTRAINT "MemoryCharacter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Relationship" (
    "id" UUID NOT NULL,
    "characterAId" UUID NOT NULL,
    "characterBId" UUID NOT NULL,
    "dimensions" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Relationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" UUID NOT NULL,
    "type" "EventType" NOT NULL,
    "importance" "EventImportance" NOT NULL DEFAULT 'MEDIUM',
    "source" "CanonSource" NOT NULL DEFAULT 'GENERATED_EVENT',
    "title" TEXT NOT NULL,
    "description" TEXT,
    "worldDate" TIMESTAMP(3),
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventCharacter" (
    "id" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "characterId" UUID NOT NULL,

    CONSTRAINT "EventCharacter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NewsItem" (
    "id" UUID NOT NULL,
    "eventId" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "source" "CanonSource" NOT NULL DEFAULT 'GENERATED_EVENT',
    "worldDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NewsItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExternalSource" (
    "id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "title" TEXT,
    "snippet" TEXT,
    "reliability" INTEGER,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExternalSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldState" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL DEFAULT 'default',
    "currentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "currentSeasonId" UUID,
    "currentRaceId" UUID,
    "currentSession" "RaceSession",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterAvailability" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "status" "AvailabilityStatus" NOT NULL DEFAULT 'AVAILABLE',
    "reason" TEXT,
    "since" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CharacterAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CharacterSchedule" (
    "id" UUID NOT NULL,
    "characterId" UUID NOT NULL,
    "activity" TEXT NOT NULL,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CharacterSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Character_userId_idx" ON "Character"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "DriverProfile_characterId_key" ON "DriverProfile"("characterId");

-- CreateIndex
CREATE INDEX "DriverProfile_teamId_idx" ON "DriverProfile"("teamId");

-- CreateIndex
CREATE UNIQUE INDEX "Team_name_key" ON "Team"("name");

-- CreateIndex
CREATE INDEX "Race_seasonId_idx" ON "Race"("seasonId");

-- CreateIndex
CREATE INDEX "Race_status_idx" ON "Race"("status");

-- CreateIndex
CREATE INDEX "RaceResult_raceId_idx" ON "RaceResult"("raceId");

-- CreateIndex
CREATE INDEX "RaceResult_driverProfileId_idx" ON "RaceResult"("driverProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "RaceResult_raceId_driverProfileId_key" ON "RaceResult"("raceId", "driverProfileId");

-- CreateIndex
CREATE INDEX "ChampionshipStanding_seasonId_idx" ON "ChampionshipStanding"("seasonId");

-- CreateIndex
CREATE INDEX "ChampionshipStanding_driverProfileId_idx" ON "ChampionshipStanding"("driverProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ChampionshipStanding_seasonId_driverProfileId_key" ON "ChampionshipStanding"("seasonId", "driverProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "ConversationParticipant_conversationId_characterId_key" ON "ConversationParticipant"("conversationId", "characterId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Memory_importance_idx" ON "Memory"("importance");

-- CreateIndex
CREATE INDEX "Memory_eventId_idx" ON "Memory"("eventId");

-- CreateIndex
CREATE UNIQUE INDEX "MemoryCharacter_memoryId_characterId_key" ON "MemoryCharacter"("memoryId", "characterId");

-- CreateIndex
CREATE INDEX "Relationship_characterAId_idx" ON "Relationship"("characterAId");

-- CreateIndex
CREATE UNIQUE INDEX "Relationship_characterAId_characterBId_key" ON "Relationship"("characterAId", "characterBId");

-- CreateIndex
CREATE INDEX "Event_type_idx" ON "Event"("type");

-- CreateIndex
CREATE INDEX "Event_worldDate_idx" ON "Event"("worldDate");

-- CreateIndex
CREATE UNIQUE INDEX "EventCharacter_eventId_characterId_key" ON "EventCharacter"("eventId", "characterId");

-- CreateIndex
CREATE INDEX "NewsItem_worldDate_idx" ON "NewsItem"("worldDate");

-- CreateIndex
CREATE INDEX "ExternalSource_fetchedAt_idx" ON "ExternalSource"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorldState_key_key" ON "WorldState"("key");

-- CreateIndex
CREATE INDEX "CharacterAvailability_status_idx" ON "CharacterAvailability"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CharacterAvailability_characterId_key" ON "CharacterAvailability"("characterId");

-- CreateIndex
CREATE INDEX "CharacterSchedule_characterId_startsAt_idx" ON "CharacterSchedule"("characterId", "startsAt");

-- AddForeignKey
ALTER TABLE "Character" ADD CONSTRAINT "Character_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriverProfile" ADD CONSTRAINT "DriverProfile_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Race" ADD CONSTRAINT "Race_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceResult" ADD CONSTRAINT "RaceResult_raceId_fkey" FOREIGN KEY ("raceId") REFERENCES "Race"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RaceResult" ADD CONSTRAINT "RaceResult_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionshipStanding" ADD CONSTRAINT "ChampionshipStanding_seasonId_fkey" FOREIGN KEY ("seasonId") REFERENCES "Season"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChampionshipStanding" ADD CONSTRAINT "ChampionshipStanding_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "DriverProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationParticipant" ADD CONSTRAINT "ConversationParticipant_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Memory" ADD CONSTRAINT "Memory_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCharacter" ADD CONSTRAINT "MemoryCharacter_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "Memory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemoryCharacter" ADD CONSTRAINT "MemoryCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_characterAId_fkey" FOREIGN KEY ("characterAId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Relationship" ADD CONSTRAINT "Relationship_characterBId_fkey" FOREIGN KEY ("characterBId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCharacter" ADD CONSTRAINT "EventCharacter_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventCharacter" ADD CONSTRAINT "EventCharacter_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NewsItem" ADD CONSTRAINT "NewsItem_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterAvailability" ADD CONSTRAINT "CharacterAvailability_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CharacterSchedule" ADD CONSTRAINT "CharacterSchedule_characterId_fkey" FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;
