import type { FastifyPluginAsync } from "fastify";
import { fromNodeHeaders } from "better-auth/node";
import { auth } from "../../infrastructure/auth/auth.js";

export const authRoutes: FastifyPluginAsync = async (fastify) => {
  // Catch-all do Better-Auth: gerencia login, cadastro, sessão, logout, etc.
  fastify.all("/api/auth/*", async (request, reply) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const headers = fromNodeHeaders(request.headers);

      const body =
        request.body && typeof request.body === "object"
          ? JSON.stringify(request.body)
          : undefined;

      const req = new Request(url.toString(), {
        method: request.method,
        headers,
        ...(body ? { body } : {}),
      });

      const response = await auth.handler(req);

      reply.code(response.status);
      response.headers.forEach((value, key) => {
        if (value !== undefined) reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    } catch (error) {
      fastify.log.error({ err: error }, "Erro no handler de autenticação");
      return reply.code(500).send({
        error: "Erro interno de autenticação",
        code: "AUTH_FAILURE",
      });
    }
  });

  // Rota auxiliar: dados da sessão do usuário autenticado.
  fastify.get("/api/auth/me", async (request, reply) => {
    if (!request.user) {
      return reply.code(401).send({
        error: "Não autenticado",
        code: "UNAUTHENTICATED",
      });
    }
    return reply.send({ user: request.user });
  });
};

export default authRoutes;
