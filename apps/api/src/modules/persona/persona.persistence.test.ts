import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";

const PREFIX = "persona-persistence";

const createdCharacterIds: string[] = [];
const createdUserIds: string[] = [];

async function createCharacter(label: string) {
  const character = await prisma.character.create({
    data: {
      name: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nationality: "Teste",
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function createPersona(characterId: string) {
  return prisma.characterPersona.create({
    data: {
      characterId,
      origin: "ORIGINAL",
      schemaVersion: "persona.v1",
    },
  });
}

async function createTrait(
  personaId: string,
  key: string,
  value: string,
  sourceKind: "MANUAL" | "EVIDENCE" = "MANUAL",
  evidenceId: string | null = null,
) {
  return prisma.personaTrait.create({
    data: { personaId, key, value, confidence: 1, sourceKind, evidenceId },
  });
}

async function createEvidence(personaId: string) {
  return prisma.personaEvidence.create({
    data: {
      personaId,
      traitKey: "humor",
      proposedValue: "Humor seco",
      sourceType: "INTERVIEW",
      title: "Entrevista de teste",
      url: "https://example.com/entrevista",
      publishedAt: new Date("2026-01-10T00:00:00.000Z"),
      excerpt: "Trecho de teste para persistência.",
      confidence: 0.8,
    },
  });
}

async function createReviewer() {
  const reviewer = await prisma.user.create({
    data: {
      name: "Revisor Persona",
      email: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`,
      password: null,
      emailVerified: true,
      image: null,
      role: "ADMIN",
    },
  });
  createdUserIds.push(reviewer.id);
  return reviewer;
}

afterAll(async () => {
  await prisma.character.deleteMany({
    where: { id: { in: createdCharacterIds } },
  });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("Persona persistence foundation", () => {
  it("Character pode existir sem CharacterPersona", async () => {
    const character = await createCharacter("sem-persona");
    const loaded = await prisma.character.findUniqueOrThrow({
      where: { id: character.id },
      include: { persona: true },
    });
    expect(loaded.persona).toBeNull();
  });

  it("CharacterPersona é 1:1 com Character (unique em characterId)", async () => {
    const character = await createCharacter("um-para-um");
    const persona = await createPersona(character.id);
    expect(persona.characterId).toBe(character.id);
    expect(persona.origin).toBe("ORIGINAL");
    expect(persona.schemaVersion).toBe("persona.v1");
    await expect(createPersona(character.id)).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("PersonaTrait é único por (personaId, key)", async () => {
    const character = await createCharacter("trait-unico");
    const persona = await createPersona(character.id);
    await createTrait(persona.id, "humor", "Humor seco");
    await expect(
      createTrait(persona.id, "humor", "Outro valor"),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("PersonaEvidence pertence a CharacterPersona e nasce PROPOSED", async () => {
    const character = await createCharacter("evidence");
    const persona = await createPersona(character.id);
    const evidence = await createEvidence(persona.id);

    expect(evidence.status).toBe("PROPOSED");
    expect(evidence.reviewedById).toBeNull();
    expect(evidence.reviewedAt).toBeNull();

    const loaded = await prisma.characterPersona.findUniqueOrThrow({
      where: { id: persona.id },
      include: { evidences: true },
    });
    expect(loaded.evidences.map((item) => item.id)).toContain(evidence.id);
  });

  it("PersonaTrait.evidenceId aceita null e vínculo com evidência", async () => {
    const character = await createCharacter("evidence-id");
    const persona = await createPersona(character.id);

    const withoutEvidence = await createTrait(persona.id, "interests", "Aviação");
    expect(withoutEvidence.evidenceId).toBeNull();

    const evidence = await createEvidence(persona.id);
    const linked = await createTrait(
      persona.id,
      "humor",
      "Humor seco",
      "EVIDENCE",
      evidence.id,
    );
    expect(linked.evidenceId).toBe(evidence.id);
    expect(linked.sourceKind).toBe("EVIDENCE");
  });

  it("remover PersonaEvidence não invalida PersonaTrait (SET NULL)", async () => {
    const character = await createCharacter("set-null");
    const persona = await createPersona(character.id);
    const evidence = await createEvidence(persona.id);
    const trait = await createTrait(
      persona.id,
      "humor",
      "Humor seco",
      "EVIDENCE",
      evidence.id,
    );

    await prisma.personaEvidence.delete({ where: { id: evidence.id } });

    const reloaded = await prisma.personaTrait.findUniqueOrThrow({
      where: { id: trait.id },
    });
    expect(reloaded.evidenceId).toBeNull();
    expect(reloaded.value).toBe("Humor seco");
  });

  it("deletar Character remove CharacterPersona (CASCADE)", async () => {
    const character = await createCharacter("cascade-character");
    const persona = await createPersona(character.id);

    await prisma.character.delete({ where: { id: character.id } });

    const loaded = await prisma.characterPersona.findUnique({
      where: { id: persona.id },
    });
    expect(loaded).toBeNull();
  });

  it("deletar CharacterPersona remove PersonaTrait e PersonaEvidence (CASCADE)", async () => {
    const character = await createCharacter("cascade-persona");
    const persona = await createPersona(character.id);
    const evidence = await createEvidence(persona.id);
    const trait = await createTrait(
      persona.id,
      "humor",
      "Humor seco",
      "EVIDENCE",
      evidence.id,
    );

    await prisma.characterPersona.delete({ where: { id: persona.id } });

    expect(
      await prisma.personaTrait.findUnique({ where: { id: trait.id } }),
    ).toBeNull();
    expect(
      await prisma.personaEvidence.findUnique({ where: { id: evidence.id } }),
    ).toBeNull();
  });

  it("reviewedById/reviewedAt são opcionais e preenchíveis", async () => {
    const reviewer = await createReviewer();
    const character = await createCharacter("review");
    const persona = await createPersona(character.id);
    const evidence = await createEvidence(persona.id);

    const reviewedAt = new Date("2026-09-29T12:00:00.000Z");
    const updated = await prisma.personaEvidence.update({
      where: { id: evidence.id },
      data: { status: "APPROVED", reviewedById: reviewer.id, reviewedAt },
    });

    expect(updated.status).toBe("APPROVED");
    expect(updated.reviewedById).toBe(reviewer.id);
    expect(updated.reviewedAt?.toISOString()).toBe(reviewedAt.toISOString());
  });

  it("deletar User revisor mantém evidência com reviewedById nulo (SET NULL)", async () => {
    const reviewer = await createReviewer();
    const character = await createCharacter("reviewer-set-null");
    const persona = await createPersona(character.id);
    const evidence = await createEvidence(persona.id);

    await prisma.personaEvidence.update({
      where: { id: evidence.id },
      data: { status: "APPROVED", reviewedById: reviewer.id },
    });
    await prisma.user.delete({ where: { id: reviewer.id } });

    const reloaded = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidence.id },
    });
    expect(reloaded.reviewedById).toBeNull();
    expect(reloaded.status).toBe("APPROVED");
  });
});
