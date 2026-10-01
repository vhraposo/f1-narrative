-- Migration aditiva: perfil de usuário e fundação de mídia (V3 Fase 5).
-- Nenhuma operação destrutiva; não altera dados existentes.

CREATE TYPE "MediaKind" AS ENUM ('USER_AVATAR');

CREATE TABLE "UserProfile" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "favoriteTeamId" UUID,
    "favoriteDriverId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");
CREATE INDEX "UserProfile_favoriteTeamId_idx" ON "UserProfile"("favoriteTeamId");
CREATE INDEX "UserProfile_favoriteDriverId_idx" ON "UserProfile"("favoriteDriverId");

CREATE TABLE "MediaAsset" (
    "id" UUID NOT NULL,
    "ownerUserId" UUID NOT NULL,
    "kind" "MediaKind" NOT NULL DEFAULT 'USER_AVATAR',
    "provider" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalFilename" TEXT,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaAsset_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaAsset_storageKey_key" ON "MediaAsset"("storageKey");
CREATE INDEX "MediaAsset_ownerUserId_idx" ON "MediaAsset"("ownerUserId");

ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_favoriteTeamId_fkey" FOREIGN KEY ("favoriteTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_favoriteDriverId_fkey" FOREIGN KEY ("favoriteDriverId") REFERENCES "DriverProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
