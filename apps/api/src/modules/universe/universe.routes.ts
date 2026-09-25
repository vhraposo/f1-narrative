import type { FastifyPluginAsync } from "fastify";
import { getUniverseForUser, provisionUniverse } from "./universe.service.js";

export const universeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/universe",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const universe = await getUniverseForUser(userId);
      return reply.send({
        universe: universe
          ? {
              id: universe.id,
              status: universe.status,
              lastError: universe.lastError,
            }
          : null,
      });
    },
  );

  fastify.post(
    "/api/universe/provision",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const { universe, report } = await provisionUniverse(userId);
      return reply.send({
        universe: {
          id: universe.id,
          status: universe.status,
          lastError: universe.lastError,
        },
        report,
      });
    },
  );
};

export default universeRoutes;
