import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { env } from "../../config/env.js";
import { prisma } from "../database/prisma.js";

export const auth = betterAuth({
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
    minPasswordLength: 8,
  },
  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 dias
    updateAge: 60 * 60 * 24, // renova a cada 24h
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // cache de 5 min
    },
  },
  advanced: {
    cookiePrefix: "f1nw",
    database: {
      // Gera UUIDs compatíveis com as colunas @db.Uuid do schema do domínio.
      generateId: "uuid",
    },
    defaultCookieAttributes: {
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    },
  },
  trustedOrigins: [env.CLIENT_ORIGIN, env.BETTER_AUTH_URL],
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
});
