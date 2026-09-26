import type { FastifyPluginAsync } from "fastify";
import { ensureUniverse } from "../universe/universe.service.js";
import { getNextRaceForUniverse } from "./next-race.service.js";

export const nextRaceRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/next-race",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const universe = await ensureUniverse(userId);
      const nextRace = await getNextRaceForUniverse(universe.id);
      return reply.send({ nextRace });
    },
  );
};

export default nextRaceRoutes;
