import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import type { Session, User } from "better-auth";
import { auth } from "./auth.js";

declare module "fastify" {
  interface FastifyRequest {
    session: Session | null;
    user: User | null;
  }
  interface FastifyInstance {
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
  }
}

const authPlugin = fp(
  async (fastify) => {
    fastify.decorateRequest("session", null);
    fastify.decorateRequest("user", null);

    fastify.addHook("preHandler", async (request: FastifyRequest) => {
      const sessionData = await auth.api.getSession({
        headers: request.headers as Record<string, string>,
      });
      request.session = sessionData?.session ?? null;
      request.user = sessionData?.user ?? null;
    });

    fastify.decorate(
      "authenticate",
      async (request: FastifyRequest, reply: FastifyReply) => {
        if (!request.session) {
          return reply.code(401).send({
            error: "Não autenticado",
            code: "UNAUTHENTICATED",
          });
        }
      },
    );
  },
  { name: "f1nw-auth" },
);

export default authPlugin;
