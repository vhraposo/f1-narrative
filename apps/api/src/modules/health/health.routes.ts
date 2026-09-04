import type { FastifyPluginAsync } from "fastify";

export const healthRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version ?? "0.0.0",
    };
  });

  fastify.get("/api/health", async () => {
    return {
      status: "ok",
      service: "f1nw-api",
      timestamp: new Date().toISOString(),
    };
  });
};

export default healthRoutes;
