import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";

import type { MediaAsset } from "@prisma/client";

import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  joinStorageKey,
  type StorageProvider,
} from "../../infrastructure/storage/storage-provider.js";
import {
  detectImageMime,
  extensionForMime,
  isAllowedImageMime,
  sanitizeOriginalFilename,
} from "./image-content.js";

export class MediaError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = "MediaError";
  }
}

export type AvatarUpload = {
  body: Buffer;
  contentType: string;
  filename?: string;
};

const MEDIA_URL_PATTERN = /\/api\/media\/([0-9a-fA-F-]{36})$/;

export function mediaPublicUrl(assetId: string): string {
  const base = env.BETTER_AUTH_URL.replace(/\/+$/, "");
  return `${base}/api/media/${assetId}`;
}

export function parseMediaIdFromUrl(url: string): string | null {
  const match = url.match(MEDIA_URL_PATTERN);
  return match ? match[1] : null;
}

export async function saveAvatarMedia(input: {
  userId: string;
  storage: StorageProvider;
  upload: AvatarUpload;
}): Promise<MediaAsset> {
  const { userId, storage, upload } = input;

  if (!isAllowedImageMime(upload.contentType)) {
    throw new MediaError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Formato de imagem não suportado (use JPEG, PNG ou WEBP)",
      415,
    );
  }
  if (upload.body.byteLength === 0) {
    throw new MediaError("EMPTY_FILE", "Arquivo de imagem vazio", 400);
  }
  if (upload.body.byteLength > env.STORAGE_MAX_UPLOAD_BYTES) {
    throw new MediaError(
      "FILE_TOO_LARGE",
      "Arquivo excede o tamanho máximo permitido",
      413,
    );
  }

  const detected = detectImageMime(upload.body);
  if (!detected || detected !== upload.contentType) {
    throw new MediaError("INVALID_IMAGE_CONTENT", "Conteúdo de imagem inválido", 400);
  }

  const key = joinStorageKey(
    "user-avatars",
    userId,
    `${randomUUID()}.${extensionForMime(detected)}`,
  );
  await storage.upload({
    key,
    body: upload.body,
    contentType: detected,
  });

  try {
    return await prisma.mediaAsset.create({
      data: {
        ownerUserId: userId,
        provider: storage.name,
        storageKey: key,
        originalFilename: sanitizeOriginalFilename(upload.filename),
        mimeType: detected,
        byteSize: upload.body.byteLength,
      },
    });
  } catch (error) {
    await storage.delete(key).catch(() => undefined);
    throw error;
  }
}

export async function openOwnedMedia(input: {
  userId: string;
  assetId: string;
  storage: StorageProvider;
}): Promise<{ asset: MediaAsset; body: Buffer }> {
  const asset = await prisma.mediaAsset.findUnique({
    where: { id: input.assetId },
  });
  if (!asset || asset.ownerUserId !== input.userId) {
    throw new MediaError("MEDIA_NOT_FOUND", "Mídia não encontrada", 404);
  }
  const object = await input.storage.get(asset.storageKey);
  if (!object) {
    throw new MediaError("MEDIA_NOT_FOUND", "Mídia não encontrada", 404);
  }
  return { asset, body: object.body };
}

export async function deleteMediaAsset(input: {
  asset: MediaAsset;
  storage: StorageProvider;
}): Promise<void> {
  try {
    await input.storage.delete(input.asset.storageKey);
  } finally {
    await prisma.mediaAsset.deleteMany({ where: { id: input.asset.id } });
  }
}
