import { describe, it, expect, afterAll } from "vitest";
import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { prisma } from "./infrastructure/database/prisma.js";

describe("config/env", () => {
  it("carrega variáveis obrigatórias", () => {
    expect(env.API_PORT).toBeGreaterThan(0);
    expect(env.BETTER_AUTH_SECRET.length).toBeGreaterThanOrEqual(16);
    expect(env.CLIENT_ORIGIN).toMatch(/^https?:\/\//);
    expect(env.DATABASE_URL).toContain("postgresql");
  });
});

describe("buildApp", () => {
  it("monta a aplicação Fastify com rotas base", async () => {
    const app = buildApp();
    await app.ready();

    // Rota de saúde registrada
    const routes = app.printRoutes({ commonPrefix: false });
    expect(routes).toContain("/health");
    expect(routes).toContain("/api/auth/");
    expect(routes).toContain("/api/health");

    await app.close();
  });
});

afterAll(async () => {
  await prisma.$disconnect();
});
