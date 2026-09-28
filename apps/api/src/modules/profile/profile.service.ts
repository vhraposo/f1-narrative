import type { UserProfile } from "@prisma/client";

import { prisma } from "../../infrastructure/database/prisma.js";
import type { StorageProvider } from "../../infrastructure/storage/storage-provider.js";
import {
  deleteMediaAsset,
  mediaPublicUrl,
  parseMediaIdFromUrl,
  saveAvatarMedia,
  type AvatarUpload,
} from "../media/media.service.js";
import { ensureUniverse } from "../universe/universe.service.js";
import type { UpdateProfileInput } from "./profile.schema.js";

export class ProfileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "ProfileError";
  }
}

export type ProfileView = {
  userId: string;
  displayName: string;
  email: string;
  image: string | null;
  favoriteTeam: {
    id: string;
    name: string;
    shortName: string | null;
    color: string | null;
  } | null;
  favoriteDriver: {
    id: string;
    number: number | null;
    name: string;
    teamName: string | null;
    imageUrl: string | null;
  } | null;
};

const FAVORITE_TEAM_SELECT = {
  id: true,
  name: true,
  shortName: true,
  color: true,
} as const;

const FAVORITE_DRIVER_SELECT = {
  id: true,
  number: true,
  customHeadshotUrl: true,
  character: { select: { name: true, imageUrl: true } },
  team: { select: { name: true } },
} as const;

async function getOrCreateProfile(userId: string): Promise<UserProfile> {
  return prisma.userProfile.upsert({
    where: { userId },
    update: {},
    create: { userId },
  });
}

async function buildView(userId: string): Promise<ProfileView> {
  await getOrCreateProfile(userId);
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { id: true, name: true, email: true, image: true },
  });
  const profile = await prisma.userProfile.findUniqueOrThrow({
    where: { userId },
    include: {
      favoriteTeam: { select: FAVORITE_TEAM_SELECT },
      favoriteDriver: { select: FAVORITE_DRIVER_SELECT },
    },
  });

  return {
    userId: user.id,
    displayName: user.name,
    email: user.email,
    image: user.image,
    favoriteTeam: profile.favoriteTeam,
    favoriteDriver: profile.favoriteDriver
      ? {
          id: profile.favoriteDriver.id,
          number: profile.favoriteDriver.number,
          name: profile.favoriteDriver.character.name,
          teamName: profile.favoriteDriver.team?.name ?? null,
          imageUrl:
            profile.favoriteDriver.customHeadshotUrl ??
            profile.favoriteDriver.character.imageUrl,
        }
      : null,
  };
}

async function assertTeamInUniverse(
  userId: string,
  teamId: string,
): Promise<string> {
  const universe = await ensureUniverse(userId);
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    select: { id: true, universeId: true },
  });
  if (!team) {
    throw new ProfileError(
      "FAVORITE_NOT_FOUND",
      "Equipe favorita não encontrada",
      404,
    );
  }
  if (team.universeId !== universe.id) {
    throw new ProfileError(
      "FAVORITE_NOT_IN_UNIVERSE",
      "Equipe favorita não pertence ao seu Universe",
      403,
    );
  }
  return team.id;
}

async function assertDriverInUniverse(
  userId: string,
  driverProfileId: string,
): Promise<string> {
  const universe = await ensureUniverse(userId);
  const driver = await prisma.driverProfile.findUnique({
    where: { id: driverProfileId },
    select: { id: true, character: { select: { universeId: true } } },
  });
  if (!driver) {
    throw new ProfileError(
      "FAVORITE_NOT_FOUND",
      "Piloto favorito não encontrado",
      404,
    );
  }
  if (driver.character.universeId !== universe.id) {
    throw new ProfileError(
      "FAVORITE_NOT_IN_UNIVERSE",
      "Piloto favorito não pertence ao seu Universe",
      403,
    );
  }
  return driver.id;
}

export async function getProfile(userId: string): Promise<ProfileView> {
  await getOrCreateProfile(userId);
  return buildView(userId);
}

export async function updateProfile(
  userId: string,
  input: UpdateProfileInput,
): Promise<ProfileView> {
  await getOrCreateProfile(userId);

  const data: { favoriteTeamId?: string | null; favoriteDriverId?: string | null } = {};
  if (input.favoriteTeamId !== undefined) {
    data.favoriteTeamId =
      input.favoriteTeamId === null
        ? null
        : await assertTeamInUniverse(userId, input.favoriteTeamId);
  }
  if (input.favoriteDriverId !== undefined) {
    data.favoriteDriverId =
      input.favoriteDriverId === null
        ? null
        : await assertDriverInUniverse(userId, input.favoriteDriverId);
  }

  await prisma.userProfile.update({ where: { userId }, data });
  return buildView(userId);
}

async function removeAvatarByUrl(
  userId: string,
  imageUrl: string | null,
  storage: StorageProvider,
): Promise<void> {
  if (!imageUrl) return;
  const assetId = parseMediaIdFromUrl(imageUrl);
  if (!assetId) return;
  const asset = await prisma.mediaAsset.findUnique({ where: { id: assetId } });
  if (!asset || asset.ownerUserId !== userId) return;
  await deleteMediaAsset({ asset, storage }).catch(() => undefined);
}

export async function setProfileAvatar(
  userId: string,
  storage: StorageProvider,
  upload: AvatarUpload,
): Promise<ProfileView> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { image: true },
  });

  const asset = await saveAvatarMedia({ userId, storage, upload });
  try {
    await prisma.user.update({
      where: { id: userId },
      data: { image: mediaPublicUrl(asset.id) },
    });
  } catch (error) {
    await deleteMediaAsset({ asset, storage }).catch(() => undefined);
    throw error;
  }

  await removeAvatarByUrl(userId, user.image, storage);
  return buildView(userId);
}

export async function clearProfileAvatar(
  userId: string,
  storage: StorageProvider,
): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { image: true },
  });
  if (user.image) {
    await prisma.user.update({
      where: { id: userId },
      data: { image: null },
    });
  }
  await removeAvatarByUrl(userId, user.image, storage);
}
