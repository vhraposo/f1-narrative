import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

const COOKIE_SESSION = "f1nw.session_token";
const ORIGIN = "http://localhost:3000";

let app: FastifyInstance;

async function signUp(email: string): Promise<{ cookie: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    headers: { origin: ORIGIN },
    payload: { name: "RegAuth", email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const cookie = (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return { cookie };
}

beforeAll(async () => {
  app = buildApp();
  await app.ready();
});

afterAll(async () => {
  await prisma.$disconnect();
  await app.close();
});

describe("contrato Better Auth (/api/auth/*)", () => {
  it("GET /api/auth/get-session responde 200 sem sessão", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it("sign-up/email cria usuário e devolve cookie de sessão", async () => {
    const email = `auth-reg-${Date.now()}@f1nw.test`;
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-up/email",
      headers: { origin: ORIGIN },
      payload: { name: "RegAuth", email, password: "senha-segura-123" },
    });
    expect(res.statusCode).toBe(200);
    const names = res.cookies.map((c) => c.name);
    expect(names).toContain(COOKIE_SESSION);
  });

  it("get-session retorna o usuário com o cookie da sessão", async () => {
    const email = `auth-sess-${Date.now()}@f1nw.test`;
    const { cookie } = await signUp(email);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie, origin: ORIGIN },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.session.token).toBeTruthy();
    expect(body.user.email).toBe(email);
  });

  it("sign-in/email autentica usuário existente", async () => {
    const email = `auth-login-${Date.now()}@f1nw.test`;
    await signUp(email);
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/sign-in/email",
      headers: { origin: ORIGIN },
      payload: { email, password: "senha-segura-123" },
    });
    expect(res.statusCode).toBe(200);
    expect(res.cookies.map((c) => c.name)).toContain(COOKIE_SESSION);
  });

  it("sign-out revoga a sessão no servidor", async () => {
    const email = `auth-out-${Date.now()}@f1nw.test`;
    const { cookie } = await signUp(email);
    const before = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { sessions: true },
    });
    expect(before.sessions.length).toBeGreaterThan(0);

    const out = await app.inject({
      method: "POST",
      url: "/api/auth/sign-out",
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      payload: {},
    });
    expect(out.statusCode).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({
      where: { email },
      include: { sessions: true },
    });
    expect(after.sessions.length).toBe(0);

    const res = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toBeNull();
  });

  it("CORS local responde com credentials para http://localhost:3000", async () => {
    const res = await app.inject({
      method: "OPTIONS",
      url: "/api/auth/get-session",
      headers: {
        origin: ORIGIN,
        "access-control-request-method": "GET",
      },
    });
    expect(res.statusCode).toBe(204);
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });

  it("GET com origin bate CORS no response real", async () => {
    const email = `auth-cors-${Date.now()}@f1nw.test`;
    const { cookie } = await signUp(email);
    const res = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie, origin: ORIGIN },
    });
    expect(res.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(res.headers["access-control-allow-credentials"]).toBe("true");
  });
});