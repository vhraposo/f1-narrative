import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deletePersonaTrait, getPersonaView, updatePersonaManually } from "./persona.service.js";

const PREFIX = "persona-context";

let userId: string;
let universeId: string;
let characterId: string;

beforeAll(async () => {
  const user = await prisma.user.create({
    data: {
      name: "Persona Context",
      email: `${PREFIX}-${Date.now()}@f1nw.test`,
      password: null,
      emailVerified: true,
      role: "USER",
    },
  });
  userId = user.id;
  const universe = await prisma.universe.create({ data: { userId, status: "READY" } });
  universeId = universe.id;
  const character = await prisma.character.create({
    data: {
      name: `${PREFIX} character`,
      nationality: "Teste",
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
      universeId,
      controlledBy: "AI",
    },
  });
  characterId = character.id;
});

afterAll(async () => {
  await prisma.personaTrait.deleteMany({ where: { persona: { characterId } } });
  await prisma.characterPersona.deleteMany({ where: { characterId } });
  await prisma.character.deleteMany({ where: { id: characterId } });
  await prisma.universe.deleteMany({ where: { id: universeId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("persona traits por contexto", () => {
  it("1) persiste mesmo trait em EM PISTA e FORA DAS PISTAS sem colidir", async () => {
    const view = await updatePersonaManually(userId, characterId, {
      traits: [
        { key: "humor", value: "Sarcástico nas coletivas", context: "ON_TRACK" },
        { key: "humor", value: "Reservado fora das pistas", context: "OFF_TRACK" },
      ],
    });

    expect(view.traits).toHaveLength(2);
    const onTrack = view.traits.find((trait) => trait.context === "ON_TRACK");
    const offTrack = view.traits.find((trait) => trait.context === "OFF_TRACK");
    expect(onTrack?.value).toBe("Sarcástico nas coletivas");
    expect(offTrack?.value).toBe("Reservado fora das pistas");
  });

  it("2) atualizar um contexto não altera o outro", async () => {
    const view = await updatePersonaManually(userId, characterId, {
      traits: [{ key: "humor", value: "Mais contido nas coletivas", context: "ON_TRACK" }],
    });
    const onTrack = view.traits.find(
      (trait) => trait.context === "ON_TRACK" && trait.key === "humor",
    );
    const offTrack = view.traits.find(
      (trait) => trait.context === "OFF_TRACK" && trait.key === "humor",
    );
    expect(onTrack?.value).toBe("Mais contido nas coletivas");
    expect(offTrack?.value).toBe("Reservado fora das pistas");
  });

  it("3) remover FORA DAS PISTAS preserva EM PISTA", async () => {
    const view = await deletePersonaTrait(userId, characterId, "humor", "OFF_TRACK");
    expect(
      view.traits.filter((trait) => trait.key === "humor").map((trait) => trait.context),
    ).toEqual(["ON_TRACK"]);
  });

  it("4) remover sem contexto opera em EM PISTA (compatível)", async () => {
    const view = await deletePersonaTrait(userId, characterId, "humor");
    expect(view.traits.filter((trait) => trait.key === "humor")).toHaveLength(0);
  });

  it("5) leitura expõe o contexto em cada trait", async () => {
    await updatePersonaManually(userId, characterId, {
      traits: [{ key: "interests", value: "Música fora das pistas", context: "OFF_TRACK" }],
    });
    const view = await getPersonaView(userId, characterId);
    const trait = view.traits.find((item) => item.key === "interests");
    expect(trait?.context).toBe("OFF_TRACK");
  });
});
