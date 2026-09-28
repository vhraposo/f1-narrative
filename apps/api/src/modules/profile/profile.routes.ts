import { Buffer } from "node:buffer";

import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { env } from "../../config/env.js";
import { createStorageProviderFromEnv } from "../../infrastructure/storage/storage.factory.js";
import {
  StorageError,
  type StorageProvider,
} from "../../infrastructure/storage/storage-provider.js";
import { ALLOWED_IMAGE_MIME_TYPES } from "../media/image-content.js";
import { MediaError } from "../media/media.service.js";
import { updateProfileSchema } from "./profile.schema.js";
import {
  clearProfileAvatar,
  getProfile,
  ProfileError,
  setProfileAvatar,
  updateProfile,
} from "./profile.service.js";

type ProfileRoutesOptions = { storageProvider?: StorageProvider };

function sendProfileError(reply: FastifyReply, error: unknown) {
  if (
    error instanceof ProfileError ||
    error instanceof MediaError ||
    error instanceof StorageError
  ) {
    return reply
      .code(error.statusCode)
      .send({ error: error.message, code: error.code });
  }
  throw error;
}

export const profileRoutes: FastifyPluginAsync<ProfileRoutesOptions> = async (
  fastify,
  options,
) => {
  const storage = options.storageProvider ?? createStorageProviderFromEnv(env);

  for (const mime of ALLOWED_IMAGE_MIME_TYPES) {
    fastify.addContentTypeParser(
      mime,
      { parseAs: "buffer" },
      (_request, body, done) => done(null, body),
    );
  }

  fastify.get(
    "/api/profile",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const profile = await getProfile(request.user!.id);
      return reply.send({ profile });
    },
  );

  fastify.patch(
    "/api/profile",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = updateProfileSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      try {
        const profile = await updateProfile(request.user!.id, parsed.data);
        return reply.send({ profile });
      } catch (error) {
        return sendProfileError(reply, error);
      }
    },
  );

  fastify.post(
    "/api/profile/avatar",
    {
      preHandler: [fastify.authenticate],
      bodyLimit: env.STORAGE_MAX_UPLOAD_BYTES,
    },
    async (request, reply) => {
      const body = Buffer.isBuffer(request.body)
        ? request.body
        : Buffer.alloc(0);
      const contentType = String(request.headers["content-type"] ?? "")
        .split(";")[0]
        .trim()
        .toLowerCase();
      const filename =
        typeof request.headers["x-filename"] === "string"
          ? request.headers["x-filename"]
          : undefined;
      try {
        const profile = await setProfileAvatar(request.user!.id, storage, {
          body,
          contentType,
          filename,
        });
        return reply.send({ profile });
      } catch (error) {
        return sendProfileError(reply, error);
      }
    },
  );

  fastify.delete(
    "/api/profile/avatar",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      await clearProfileAvatar(request.user!.id, storage);
      return reply.code(204).send();
    },
  );
};
