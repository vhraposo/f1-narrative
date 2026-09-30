import { afterAll, describe, expect, it, vi } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import {
  PersonaServiceError,
  getPersonaView,
  isPersonaSchemaUnavailable,
  withPersonaAvailability,
} from "./persona.service.js";

const PREFIX = "persona-availability";
const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];

afterAll(async () => {
  if (createdCharacterIds.length > 0) {
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe("persona availability (ambiente sem migration)", () => {
  it("1) P2021/P2022 viram PersonaServiceError UNAVAILABLE 503", async () => {
    const missing = Object.assign(new Error("table missing"), { code: "P2021" });
    await expect(withPersonaAvailability(async () => Promise.reject(missing))).rejects.toMatchObject({
      code: "UNAVAILABLE",
      statusCode: 503,
    });

    const missingColumn = Object.assign(new Error("column missing"), { code: "P2022" });
    expect(isPersonaSchemaUnavailable(missingColumn)).toBe(true);
    expect(isPersonaSchemaUnavailable(new Error("other"))).toBe(false);

    const value = await withPersonaAvailability(async () => 7);
    expect(value).toBe(7);
    expect(new PersonaServiceError("UNAVAILABLE", "x", 503).statusCode).toBe(503);
  });

  it("2) getPersonaView responde 503 sanitizado quando a tabela não existe", async () => {
    const user = await prisma.user.create({
      data: {
        email: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
        name: "Owner Availability",
      },
    });
    createdUserIds.push(user.id);
    const character = await prisma.character.create({
      data: {
        userId: user.id,
        controlledBy: "USER",
        name: "Piloto Availability",
        nationality: "BRA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
      },
    });
    createdCharacterIds.push(character.id);

    const spy = vi
      .spyOn(prisma.characterPersona, "findUnique")
      .mockRejectedValueOnce(Object.assign(new Error("missing"), { code: "P2021" }));

    await expect(getPersonaView(user.id, character.id)).rejects.toMatchObject({
      code: "UNAVAILABLE",
      statusCode: 503,
      message: "Persona indisponível neste ambiente (migração pendente).",
    });
    spy.mockRestore();

    const view = await getPersonaView(user.id, character.id);
    expect(view.exists).toBe(false);
  });
});
