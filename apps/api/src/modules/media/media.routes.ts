import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";

import { env } from "../../config/env.js";
import { createStorageProviderFromEnv } from "../../infrastructure/storage/storage.factory.js";
import type { StorageProvider } from "../../infrastructure/storage/storage-provider.js";
import { MediaError, openOwnedMedia } from "./media.service.js";

type MediaRoutesOptions = { storageProvider?: StorageProvider };

const paramsSchema = z.object({ id: z.string().uuid() });

export const mediaRoutes: FastifyPluginAsync<MediaRoutesOptions> = async (
  fastify,
  options,
) => {
  const storage = options.storageProvider ?? createStorageProviderFromEnv(env);

  fastify.get(
    "/api/media/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);
      if (!parsed.success) {
        return reply.code(404).send({
          error: "Mídia não encontrada",
          code: "MEDIA_NOT_FOUND",
        });
      }
      try {
        const { asset, body } = await openOwnedMedia({
          userId: request.user!.id,
          assetId: parsed.data.id,
          storage,
        });
        return reply
          .header("Content-Type", asset.mimeType)
          .header("Cache-Control", "private, max-age=300")
          .header("Cross-Origin-Resource-Policy", "cross-origin")
          .header("Content-Length", String(body.byteLength))
          .send(body);
      } catch (error) {
        if (error instanceof MediaError) {
          return reply
            .code(error.statusCode)
            .send({ error: error.message, code: error.code });
        }
        throw error;
      }
    },
  );
};
