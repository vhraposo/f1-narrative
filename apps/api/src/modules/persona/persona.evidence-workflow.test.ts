import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  createPersonaEvidence,
  ensurePersona,
  getPersonaView,
  reviewPersonaEvidence,
  type CreatePersonaEvidenceInput,
} from "./persona.service.js";

const PREFIX = "persona-evidence";
const EXTERNAL_SOURCE = "persona-evidence-test";

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdExternalDriverIds: string[] = [];
const createdMemoryIds: string[] = [];
const createdRelationshipIds: string[] = [];
const createdTimelineEventIds: string[] = [];

async function createUser(label: string, role: "USER" | "ADMIN" = "USER") {
  const user = await prisma.user.create({
    data: {
      name: `Evidence ${label}`,
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`,
      password: null,
      emailVerified: true,
      image: null,
      role,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

async function createUniverse(userId: string) {
  const universe = await prisma.universe.create({ data: { userId, status: "READY" } });
  createdUniverseIds.push(universe.id);
  return universe;
}

async function createCharacter(input: {
  label: string;
  userId?: string | null;
  universeId?: string | null;
  controlledBy?: "USER" | "AI";
  dna?: object;
  biography?: string | null;
}) {
  const character = await prisma.character.create({
    data: {
      name: `${PREFIX}-${input.label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nationality: "Teste",
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
      userId: input.userId ?? null,
      universeId: input.universeId ?? null,
      controlledBy: input.controlledBy ?? "AI",
      dna: input.dna ?? {},
      biography: input.biography ?? null,
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function createExternalDriver(label: string) {
  const externalDriver = await prisma.externalDriver.create({
    data: {
      source: EXTERNAL_SOURCE,
      externalId: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: `Externo ${label}`,
      contentHash: `hash-${label}`,
    },
  });
  createdExternalDriverIds.push(externalDriver.id);
  return externalDriver;
}

async function seedPersona(
  characterId: string,
  origin: "ORIGINAL" | "REAL_DRIVER" | "AI_CHARACTER",
  createdById: string | null = null,
) {
  return prisma.characterPersona.create({
    data: { characterId, origin, schemaVersion: "persona.v1", createdById },
  });
}

function validEvidenceInput(
  overrides: Partial<CreatePersonaEvidenceInput> = {},
): CreatePersonaEvidenceInput {
  return {
    traitKey: "humor",
    proposedValue: "Sarcástico",
    sourceType: "INTERVIEW",
    title: "Entrevista",
    url: "https://example.com/fonte",
    publishedAt: new Date("2026-01-15T00:00:00.000Z"),
    excerpt: "Trecho da entrevista.",
    confidence: 0.7,
    ...overrides,
  };
}

async function evidenceIdByKey(characterId: string, traitKey: string): Promise<string> {
  const evidence = await prisma.personaEvidence.findFirstOrThrow({
    where: { persona: { characterId }, traitKey },
    orderBy: { createdAt: "desc" },
  });
  return evidence.id;
}

async function seedProposedEvidence(
  personaId: string,
  data: {
    id?: string;
    traitKey: string;
    proposedValue: string;
    confidence: number;
    publishedAt?: Date | null;
    createdAt?: Date;
  },
): Promise<string> {
  const evidence = await prisma.personaEvidence.create({
    data: {
      ...(data.id ? { id: data.id } : {}),
      personaId,
      traitKey: data.traitKey,
      proposedValue: data.proposedValue,
      sourceType: "INTERVIEW",
      title: "Fonte",
      url: null,
      publishedAt: data.publishedAt ?? null,
      excerpt: "Trecho",
      confidence: data.confidence,
      status: "PROPOSED",
      ...(data.createdAt ? { createdAt: data.createdAt } : {}),
    },
  });
  return evidence.id;
}

let userA: { id: string };
let userB: { id: string };
let admin: { id: string };
let universeA: { id: string };
let universeB: { id: string };

let charA: { id: string };
let validationChar: { id: string };
let charB: { id: string };
let materializedCharA: { id: string };
let globalCatalogChar: { id: string };

let multiChar: { id: string };
let multiPersonaId: string;
let humorWeakId: string;
let humorStrongId: string;
let speechOldId: string;
let speechNewId: string;
let noDateId: string;
let datedId: string;
let createdOldId: string;
let createdNewId: string;
let idAlphaId: string;
let idBetaId: string;
let orderWeakId: string;
let orderStrongId: string;
let orderConfStrongId: string;
let orderConfWeakId: string;

let conflictChar: { id: string };
let rejectionChar: { id: string };
let rejectionManualChar: { id: string };
let rejectionProposedChar: { id: string };
let reapprovalChar: { id: string };
let reapprovalComparatorChar: { id: string };
let reapprovalManualChar: { id: string };
let overrideChar: { id: string };
let reconcileChar: { id: string };
let lineageChar: { id: string };
let orphanChar: { id: string };
let conc1Char: { id: string };
let conc2Char: { id: string };
let conc3Char: { id: string };

let regressionChar: { id: string };
let regressionPartnerChar: { id: string };
let regressionProfileId: string;
let regressionCharacterSnapshot: Record<string, unknown>;
let regressionProfileSnapshot: Record<string, unknown>;
let regressionMemorySnapshot: Record<string, unknown>;
let regressionRelationshipSnapshot: Record<string, unknown>;
let regressionTimelineSnapshot: Record<string, unknown>;

beforeAll(async () => {
  userA = await createUser("user-a");
  userB = await createUser("user-b");
  admin = await createUser("admin", "ADMIN");
  universeA = await createUniverse(userA.id);
  universeB = await createUniverse(userB.id);

  charA = await createCharacter({ label: "char-a", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  validationChar = await createCharacter({ label: "validation", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  charB = await createCharacter({ label: "char-b", userId: userB.id, universeId: universeB.id, controlledBy: "USER" });

  materializedCharA = await createCharacter({ label: "materializado-a", userId: null, universeId: universeA.id, controlledBy: "AI" });
  const materializedExternal = await createExternalDriver("materializado-a");
  await prisma.externalBindingDriver.create({
    data: {
      universeId: universeA.id,
      externalDriverId: materializedExternal.id,
      characterId: materializedCharA.id,
      confidence: "CONFIRMED",
      boundBy: "ADMIN",
    },
  });

  globalCatalogChar = await createCharacter({ label: "catalogo-global", userId: null, universeId: null, controlledBy: "AI" });

  multiChar = await createCharacter({ label: "multi", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  multiPersonaId = (await ensurePersona(userA.id, multiChar.id)).persona.id!;

  humorWeakId = await seedProposedEvidence(multiPersonaId, { traitKey: "humor", proposedValue: "Baixa confiança", confidence: 0.4 });
  humorStrongId = await seedProposedEvidence(multiPersonaId, { traitKey: "humor", proposedValue: "Alta confiança", confidence: 0.9 });

  speechOldId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "speechStyle",
    proposedValue: "Fonte antiga",
    confidence: 0.8,
    publishedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  speechNewId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "speechStyle",
    proposedValue: "Fonte recente",
    confidence: 0.8,
    publishedAt: new Date("2026-02-01T00:00:00.000Z"),
  });

  noDateId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "behavioralTendencies",
    proposedValue: "Sem data",
    confidence: 0.8,
    publishedAt: null,
  });
  datedId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "behavioralTendencies",
    proposedValue: "Com data",
    confidence: 0.8,
    publishedAt: new Date("2020-01-01T00:00:00.000Z"),
  });

  const sameCreatedAt = new Date("2026-03-01T00:00:00.000Z");
  createdOldId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "emotionalExpression",
    proposedValue: "Criada antes",
    confidence: 0.7,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  createdNewId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "emotionalExpression",
    proposedValue: "Criada depois",
    confidence: 0.7,
    createdAt: new Date("2026-05-01T00:00:00.000Z"),
  });

  idAlphaId = await seedProposedEvidence(multiPersonaId, {
    id: "00000000-0000-4000-8000-00000000000a",
    traitKey: "competitiveness",
    proposedValue: "Id alpha",
    confidence: 0.6,
    createdAt: sameCreatedAt,
  });
  idBetaId = await seedProposedEvidence(multiPersonaId, {
    id: "00000000-0000-4000-8000-00000000000b",
    traitKey: "competitiveness",
    proposedValue: "Id beta",
    confidence: 0.6,
    createdAt: sameCreatedAt,
  });

  orderWeakId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "communicationStyle",
    proposedValue: "Criada primeiro",
    confidence: 0.3,
  });
  orderStrongId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "communicationStyle",
    proposedValue: "Criada depois",
    confidence: 0.9,
  });
  orderConfStrongId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "confidence",
    proposedValue: "Forte aprovada primeiro",
    confidence: 0.9,
  });
  orderConfWeakId = await seedProposedEvidence(multiPersonaId, {
    traitKey: "confidence",
    proposedValue: "Fraca aprovada depois",
    confidence: 0.3,
  });

  conflictChar = await createCharacter({ label: "conflito", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

  rejectionChar = await createCharacter({ label: "rejeicao", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  rejectionManualChar = await createCharacter({ label: "rejeicao-manual", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  rejectionProposedChar = await createCharacter({ label: "rejeicao-proposta", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

  reapprovalChar = await createCharacter({ label: "reaprovacao", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  reapprovalComparatorChar = await createCharacter({ label: "reaprovacao-comparator", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  reapprovalManualChar = await createCharacter({ label: "reaprovacao-manual", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

  overrideChar = await createCharacter({ label: "override", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

  reconcileChar = await createCharacter({ label: "reconcile", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  lineageChar = await createCharacter({ label: "linhagem", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  orphanChar = await createCharacter({ label: "orfa", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

  conc1Char = await createCharacter({ label: "conc-1", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  conc2Char = await createCharacter({ label: "conc-2", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  conc3Char = await createCharacter({ label: "conc-3", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

  regressionChar = await createCharacter({
    label: "regression",
    userId: null,
    universeId: universeA.id,
    controlledBy: "AI",
    dna: { personality: "protegida" },
    biography: "Biografia do piloto",
  });
  const regressionExternal = await createExternalDriver("regression");
  await prisma.externalBindingDriver.create({
    data: {
      universeId: universeA.id,
      externalDriverId: regressionExternal.id,
      characterId: regressionChar.id,
      confidence: "CONFIRMED",
      boundBy: "ADMIN",
    },
  });
  const regressionProfile = await prisma.driverProfile.create({
    data: { characterId: regressionChar.id, number: 7 },
  });
  regressionProfileId = regressionProfile.id;

  regressionPartnerChar = await createCharacter({ label: "parceiro", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

  const memory = await prisma.memory.create({
    data: {
      content: "Memória protegida",
      summary: "Resumo",
      importance: "HIGH",
      source: "USER_DEFINED",
    },
  });
  createdMemoryIds.push(memory.id);
  await prisma.memoryCharacter.create({
    data: { memoryId: memory.id, characterId: regressionChar.id },
  });

  const relationship = await prisma.relationship.create({
    data: {
      characterAId: regressionChar.id,
      characterBId: regressionPartnerChar.id,
      dimensions: { trust: 50 },
    },
  });
  createdRelationshipIds.push(relationship.id);

  const timelineEvent = await prisma.timelineEvent.create({
    data: {
      universeId: universeA.id,
      sequence: 991337,
      worldDate: new Date("2026-01-01T00:00:00.000Z"),
      kind: "WORLD_ADVANCED",
      payload: { source: "persona-evidence-test" },
    },
  });
  createdTimelineEventIds.push(timelineEvent.id);

  regressionCharacterSnapshot = (await prisma.character.findUniqueOrThrow({
    where: { id: regressionChar.id },
  })) as unknown as Record<string, unknown>;
  regressionProfileSnapshot = (await prisma.driverProfile.findUniqueOrThrow({
    where: { id: regressionProfileId },
  })) as unknown as Record<string, unknown>;
  regressionMemorySnapshot = (await prisma.memory.findUniqueOrThrow({
    where: { id: memory.id },
  })) as unknown as Record<string, unknown>;
  regressionRelationshipSnapshot = (await prisma.relationship.findUniqueOrThrow({
    where: { id: relationship.id },
  })) as unknown as Record<string, unknown>;
  regressionTimelineSnapshot = (await prisma.timelineEvent.findUniqueOrThrow({
    where: { id: timelineEvent.id },
  })) as unknown as Record<string, unknown>;
});

afterAll(async () => {
  await prisma.memory.deleteMany({ where: { id: { in: createdMemoryIds } } });
  await prisma.relationship.deleteMany({ where: { id: { in: createdRelationshipIds } } });
  await prisma.timelineEvent.deleteMany({ where: { id: { in: createdTimelineEventIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.externalDriver.deleteMany({ where: { id: { in: createdExternalDriverIds } } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("persona.evidence — create", () => {
  it("1) cria evidence PROPOSED", async () => {
    const view = await createPersonaEvidence(userA.id, charA.id, validEvidenceInput());
    const evidence = view.evidences.find((item) => item.traitKey === "humor")!;
    expect(evidence.status).toBe("PROPOSED");
    expect(evidence.proposedValue).toBe("Sarcástico");
    expect(evidence.confidence).toBe(0.7);
  });

  it("2) cria Persona lazy", async () => {
    expect(
      await prisma.characterPersona.count({ where: { characterId: charA.id } }),
    ).toBe(1);
  });

  it("3) createdById correto", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: charA.id }, traitKey: "humor" },
    });
    expect(evidence.createdById).toBe(userA.id);
  });

  it("4) reviewedById null", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: charA.id }, traitKey: "humor" },
    });
    expect(evidence.reviewedById).toBeNull();
  });

  it("5) reviewedAt null", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: charA.id }, traitKey: "humor" },
    });
    expect(evidence.reviewedAt).toBeNull();
  });

  it("6) não cria trait", async () => {
    expect(
      await prisma.personaTrait.count({ where: { persona: { characterId: charA.id } } }),
    ).toBe(0);
  });
});

describe("persona.evidence — validation", () => {
  it("7) traitKey inválido", async () => {
    await expect(
      createPersonaEvidence(userA.id, validationChar.id, validEvidenceInput({ traitKey: "charisma" })),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "traitKey", code: "TRAIT_KEY_UNKNOWN" }],
    });
  });

  it("8) proposedValue vazio", async () => {
    await expect(
      createPersonaEvidence(userA.id, validationChar.id, validEvidenceInput({ proposedValue: "   " })),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "proposedValue", code: "PROPOSED_VALUE_EMPTY" }],
    });
  });

  it("9) proposedValue > 200", async () => {
    await expect(
      createPersonaEvidence(userA.id, validationChar.id, validEvidenceInput({ proposedValue: "x".repeat(201) })),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "proposedValue", code: "PROPOSED_VALUE_TOO_LONG" }],
    });
  });

  it("10) confidence inválida", async () => {
    await expect(
      createPersonaEvidence(userA.id, validationChar.id, validEvidenceInput({ confidence: 1.5 })),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "confidence", code: "CONFIDENCE_OUT_OF_RANGE" }],
    });
  });

  it("11) title > 200", async () => {
    await expect(
      createPersonaEvidence(userA.id, validationChar.id, validEvidenceInput({ title: "x".repeat(201) })),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "title", code: "EVIDENCE_TITLE_TOO_LONG" }],
    });
  });

  it("12) excerpt > 500", async () => {
    await expect(
      createPersonaEvidence(userA.id, validationChar.id, validEvidenceInput({ excerpt: "x".repeat(501) })),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "excerpt", code: "EVIDENCE_EXCERPT_TOO_LONG" }],
    });
  });

  it("13) URL inválida", async () => {
    await expect(
      createPersonaEvidence(userA.id, validationChar.id, validEvidenceInput({ url: "não é url" })),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "url", code: "EVIDENCE_URL_INVALID" }],
    });
  });

  it("14) URL > 2048 e nenhuma escrita parcial", async () => {
    await expect(
      createPersonaEvidence(
        userA.id,
        validationChar.id,
        validEvidenceInput({ url: `https://example.com/${"x".repeat(2048)}` }),
      ),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "url", code: "EVIDENCE_URL_TOO_LONG" }],
    });
    expect(
      await prisma.characterPersona.count({ where: { characterId: validationChar.id } }),
    ).toBe(0);
  });
});

describe("persona.evidence — authorization", () => {
  it("15) owner cria", async () => {
    const view = await createPersonaEvidence(
      userA.id,
      charA.id,
      validEvidenceInput({ traitKey: "speechStyle", proposedValue: "Fala direta" }),
    );
    expect(view.exists).toBe(true);
  });

  it("16) outro usuário não cria", async () => {
    await expect(
      createPersonaEvidence(userB.id, charA.id, validEvidenceInput()),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("17) outro Universe não cria", async () => {
    await expect(
      createPersonaEvidence(userB.id, materializedCharA.id, validEvidenceInput()),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("18) catálogo global não cria", async () => {
    await expect(
      createPersonaEvidence(userA.id, globalCatalogChar.id, validEvidenceInput()),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(
      await prisma.characterPersona.count({ where: { characterId: globalCatalogChar.id } }),
    ).toBe(0);
  });
});

describe("persona.evidence — admin review", () => {
  it("19) USER não aprova", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    await expect(
      reviewPersonaEvidence(userB.id, evidenceId, { status: "APPROVED" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("20) USER não rejeita", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    await expect(
      reviewPersonaEvidence(userB.id, evidenceId, { status: "REJECTED" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("21) ADMIN aprova", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, {
      status: "APPROVED",
    });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      sourceKind: "EVIDENCE",
      value: "Sarcástico",
      confidence: 0.7,
      evidenceId,
    });
  });

  it("22) ADMIN rejeita", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "speechStyle");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, {
      status: "REJECTED",
    });
    expect(view.evidences.find((item) => item.id === evidenceId)!.status).toBe(
      "REJECTED",
    );
    expect(view.traits.find((trait) => trait.key === "speechStyle")).toBeUndefined();
  });

  it("23) reviewedById correto", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
    });
    expect(evidence.reviewedById).toBe(admin.id);
  });

  it("24) reviewedAt preenchido", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
    });
    expect(evidence.reviewedAt).not.toBeNull();
  });
});

describe("persona.evidence — transitions", () => {
  it("25) PROPOSED -> APPROVED", async () => {
    await createPersonaEvidence(userA.id, charA.id, validEvidenceInput({ traitKey: "interests", proposedValue: "Música" }));
    const evidenceId = await evidenceIdByKey(charA.id, "interests");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, {
      status: "APPROVED",
    });
    expect(view.evidences.find((item) => item.id === evidenceId)!.status).toBe(
      "APPROVED",
    );
  });

  it("26) PROPOSED -> REJECTED", async () => {
    await createPersonaEvidence(userA.id, charA.id, validEvidenceInput({ traitKey: "competitiveness", proposedValue: "Agressivo" }));
    const evidenceId = await evidenceIdByKey(charA.id, "competitiveness");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, {
      status: "REJECTED",
    });
    expect(view.evidences.find((item) => item.id === evidenceId)!.status).toBe(
      "REJECTED",
    );
  });

  it("27) APPROVED -> REJECTED", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, {
      status: "REJECTED",
    });
    expect(view.evidences.find((item) => item.id === evidenceId)!.status).toBe(
      "REJECTED",
    );
  });

  it("28) REJECTED -> APPROVED", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, {
      status: "APPROVED",
    });
    expect(view.evidences.find((item) => item.id === evidenceId)!.status).toBe(
      "APPROVED",
    );
  });

  it("29) mesmo status é INVALID_TRANSITION", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    await expect(
      reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" }),
    ).rejects.toMatchObject({ code: "INVALID_TRANSITION", statusCode: 409 });
  });

  it("30) transição inválida (status fora do contrato)", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "humor");
    await expect(
      reviewPersonaEvidence(admin.id, evidenceId, {
        status: "PROPOSED" as never,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });
});

describe("persona.evidence — PROPOSED -> REJECTED", () => {
  it("31) nenhum trait criado", async () => {
    await createPersonaEvidence(userA.id, charA.id, validEvidenceInput({ traitKey: "behavioralTendencies", proposedValue: "Impulsivo" }));
    const evidenceId = await evidenceIdByKey(charA.id, "behavioralTendencies");
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "REJECTED" });
    expect(
      await prisma.personaTrait.count({
        where: { persona: { characterId: charA.id }, key: "behavioralTendencies" },
      }),
    ).toBe(0);
  });

  it("32) evidence permanece armazenada", async () => {
    const evidenceId = await evidenceIdByKey(charA.id, "behavioralTendencies");
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
      include: { persona: true },
    });
    expect(evidence.status).toBe("REJECTED");
    expect(evidence.persona.characterId).toBe(charA.id);
  });
});

describe("persona.evidence — PROPOSED -> APPROVED", () => {
  it("33) sem trait -> cria EVIDENCE", async () => {
    await createPersonaEvidence(userA.id, charA.id, validEvidenceInput({ traitKey: "emotionalExpression", proposedValue: "Contido" }));
    const evidenceId = await evidenceIdByKey(charA.id, "emotionalExpression");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "emotionalExpression")).toMatchObject({
      value: "Contido",
      sourceKind: "EVIDENCE",
      evidenceId,
    });
  });

  it("34) com MANUAL -> MANUAL permanece", async () => {
    const persona = await seedPersona(rejectionManualChar.id, "ORIGINAL", userA.id);
    await prisma.personaTrait.create({
      data: { personaId: persona.id, key: "humor", value: "Manual", confidence: 1, sourceKind: "MANUAL" },
    });
    await createPersonaEvidence(userA.id, rejectionManualChar.id, validEvidenceInput({ proposedValue: "Da fonte" }));
    const evidenceId = await evidenceIdByKey(rejectionManualChar.id, "humor");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    const trait = view.traits.find((item) => item.key === "humor")!;
    expect(trait.sourceKind).toBe("MANUAL");
    expect(trait.value).toBe("Manual");
  });

  it("35) com EVIDENCE -> authority é determinada", async () => {
    const persona = await seedPersona(reconcileChar.id, "ORIGINAL", userA.id);
    const firstId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Primeira",
      confidence: 0.5,
    });
    await reviewPersonaEvidence(admin.id, firstId, { status: "APPROVED" });

    const secondId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Segunda",
      confidence: 0.9,
    });
    const view = await reviewPersonaEvidence(admin.id, secondId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Segunda",
      confidence: 0.9,
      evidenceId: secondId,
    });
  });
});

describe("persona.evidence — MANUAL precedence", () => {
  it("36) approve com MANUAL preserva manual", async () => {
    const view = await getPersonaView(userA.id, rejectionManualChar.id);
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      sourceKind: "MANUAL",
      value: "Manual",
    });
  });

  it("37) evidence permanece APPROVED", async () => {
    const evidenceId = await evidenceIdByKey(rejectionManualChar.id, "humor");
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
    });
    expect(evidence.status).toBe("APPROVED");
  });

  it("38) evidenceId do manual permanece null", async () => {
    const view = await getPersonaView(userA.id, rejectionManualChar.id);
    expect(view.traits.find((trait) => trait.key === "humor")!.evidenceId).toBeNull();
  });
});

describe("persona.evidence — multiple evidences", () => {
  it("39) maior confidence ganha", async () => {
    await reviewPersonaEvidence(admin.id, humorWeakId, { status: "APPROVED" });
    const view = await reviewPersonaEvidence(admin.id, humorStrongId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Alta confiança",
      evidenceId: humorStrongId,
    });
  });

  it("40) publishedAt desempata (mais recente vence)", async () => {
    await reviewPersonaEvidence(admin.id, speechOldId, { status: "APPROVED" });
    const view = await reviewPersonaEvidence(admin.id, speechNewId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "speechStyle")).toMatchObject({
      value: "Fonte recente",
      evidenceId: speechNewId,
    });
  });

  it("41) publishedAt nulo perde para data", async () => {
    await reviewPersonaEvidence(admin.id, noDateId, { status: "APPROVED" });
    const view = await reviewPersonaEvidence(admin.id, datedId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "behavioralTendencies")).toMatchObject({
      value: "Com data",
      evidenceId: datedId,
    });
  });

  it("42) createdAt desempata (mais recente vence)", async () => {
    await reviewPersonaEvidence(admin.id, createdOldId, { status: "APPROVED" });
    const view = await reviewPersonaEvidence(admin.id, createdNewId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "emotionalExpression")).toMatchObject({
      value: "Criada depois",
      evidenceId: createdNewId,
    });
  });

  it("43) id ASC desempata", async () => {
    await reviewPersonaEvidence(admin.id, idBetaId, { status: "APPROVED" });
    const view = await reviewPersonaEvidence(admin.id, idAlphaId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "competitiveness")).toMatchObject({
      value: "Id alpha",
      evidenceId: idAlphaId,
    });
  });

  it("44) ordem de aprovação não determina authority", async () => {
    await reviewPersonaEvidence(admin.id, orderWeakId, { status: "APPROVED" });
    const view = await reviewPersonaEvidence(admin.id, orderStrongId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "communicationStyle")).toMatchObject({
      value: "Criada depois",
      evidenceId: orderStrongId,
    });

    await reviewPersonaEvidence(admin.id, orderConfStrongId, { status: "APPROVED" });
    const view2 = await reviewPersonaEvidence(admin.id, orderConfWeakId, { status: "APPROVED" });
    expect(view2.traits.find((trait) => trait.key === "confidence")).toMatchObject({
      value: "Forte aprovada primeiro",
      evidenceId: orderConfStrongId,
    });
  });
});

describe("persona.evidence — conflict", () => {
  let sarcasticId: string;
  let reservedId: string;

  it("45) valores conflitantes coexistem", async () => {
    await createPersonaEvidence(userA.id, conflictChar.id, validEvidenceInput({ proposedValue: "sarcástico", confidence: 0.9 }));
    await createPersonaEvidence(userA.id, conflictChar.id, validEvidenceInput({ proposedValue: "reservado", confidence: 0.8 }));
    const rows = await prisma.personaEvidence.findMany({
      where: { persona: { characterId: conflictChar.id } },
    });
    sarcasticId = rows.find((row) => row.proposedValue === "sarcástico")!.id;
    reservedId = rows.find((row) => row.proposedValue === "reservado")!.id;
    await reviewPersonaEvidence(admin.id, sarcasticId, { status: "APPROVED" });
    const finalView = await reviewPersonaEvidence(admin.id, reservedId, { status: "APPROVED" });
    const statuses = finalView.evidences
      .filter((item) => item.id === sarcasticId || item.id === reservedId)
      .map((item) => item.status);
    expect(statuses).toEqual(["APPROVED", "APPROVED"]);
  });

  it("46) apenas uma é authoritative", async () => {
    const view = await getPersonaView(userA.id, conflictChar.id);
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "sarcástico",
      evidenceId: sarcasticId,
    });
    expect(view.evidences.find((item) => item.id === sarcasticId)!.role).toBe(
      "AUTHORITATIVE",
    );
    expect(view.evidences.find((item) => item.id === reservedId)!.role).toBe(
      "CONFLICTING",
    );
  });

  it("47) perdedora permanece armazenada", async () => {
    const loser = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: reservedId },
    });
    expect(loser.status).toBe("APPROVED");
    expect(loser.confidence).toBe(0.8);
    expect(loser.proposedValue).toBe("reservado");
  });

  it("48) nenhuma é automaticamente rejeitada", async () => {
    const rejeitadas = await prisma.personaEvidence.count({
      where: { persona: { characterId: conflictChar.id }, status: "REJECTED" },
    });
    expect(rejeitadas).toBe(0);
  });
});

describe("persona.evidence — rejection", () => {
  let firstId: string;
  let secondId: string;

  it("49) rejeição da authority promove a próxima", async () => {
    await createPersonaEvidence(userA.id, rejectionChar.id, validEvidenceInput({ proposedValue: "Primeira", confidence: 0.9 }));
    await createPersonaEvidence(userA.id, rejectionChar.id, validEvidenceInput({ proposedValue: "Segunda", confidence: 0.8 }));
    const rows = await prisma.personaEvidence.findMany({
      where: { persona: { characterId: rejectionChar.id } },
    });
    firstId = rows.find((row) => row.proposedValue === "Primeira")!.id;
    secondId = rows.find((row) => row.proposedValue === "Segunda")!.id;
    await reviewPersonaEvidence(admin.id, firstId, { status: "APPROVED" });
    await reviewPersonaEvidence(admin.id, secondId, { status: "APPROVED" });
    const view = await reviewPersonaEvidence(admin.id, firstId, { status: "REJECTED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Segunda",
      confidence: 0.8,
      evidenceId: secondId,
    });
  });

  it("50) rejeição da última remove trait EVIDENCE", async () => {
    const view = await reviewPersonaEvidence(admin.id, secondId, { status: "REJECTED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toBeUndefined();
    expect(
      await prisma.personaTrait.count({
        where: { persona: { characterId: rejectionChar.id }, key: "humor" },
      }),
    ).toBe(0);
  });

  it("51) rejeição não altera MANUAL", async () => {
    const evidenceId = await evidenceIdByKey(rejectionManualChar.id, "humor");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, { status: "REJECTED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      sourceKind: "MANUAL",
      value: "Manual",
    });
  });

  it("52) PROPOSED rejeitada não altera trait existente", async () => {
    const persona = await seedPersona(rejectionProposedChar.id, "ORIGINAL", userA.id);
    const approvedId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Aprovada",
      confidence: 0.9,
    });
    await reviewPersonaEvidence(admin.id, approvedId, { status: "APPROVED" });
    const proposedId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Proposta rejeitada",
      confidence: 0.1,
    });
    const view = await reviewPersonaEvidence(admin.id, proposedId, { status: "REJECTED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Aprovada",
      evidenceId: approvedId,
    });
  });
});

describe("persona.evidence — reapproval", () => {
  it("53) REJECTED -> APPROVED reentra no conjunto", async () => {
    await createPersonaEvidence(userA.id, reapprovalChar.id, validEvidenceInput({ proposedValue: "Volta", confidence: 0.7 }));
    const evidenceId = await evidenceIdByKey(reapprovalChar.id, "humor");
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "REJECTED" });
    expect(
      await prisma.personaTrait.count({
        where: { persona: { characterId: reapprovalChar.id }, key: "humor" },
      }),
    ).toBe(0);
    const view = await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    expect(view.evidences.find((item) => item.id === evidenceId)!.status).toBe(
      "APPROVED",
    );
    expect(view.traits.find((trait) => trait.key === "humor")!.evidenceId).toBe(
      evidenceId,
    );
  });

  it("54) authority após reapproval continua determinística", async () => {
    const persona = await seedPersona(reapprovalComparatorChar.id, "ORIGINAL", userA.id);
    const strongId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Forte",
      confidence: 0.9,
    });
    const weakId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Fraca",
      confidence: 0.5,
    });
    await reviewPersonaEvidence(admin.id, strongId, { status: "APPROVED" });
    await reviewPersonaEvidence(admin.id, weakId, { status: "APPROVED" });
    await reviewPersonaEvidence(admin.id, strongId, { status: "REJECTED" });
    const afterReject = await getPersonaView(userA.id, reapprovalComparatorChar.id);
    expect(afterReject.traits.find((trait) => trait.key === "humor")!.evidenceId).toBe(
      weakId,
    );
    const view = await reviewPersonaEvidence(admin.id, strongId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Forte",
      evidenceId: strongId,
    });
  });

  it("55) MANUAL continua vencendo após reapproval", async () => {
    const persona = await seedPersona(reapprovalManualChar.id, "ORIGINAL", userA.id);
    await prisma.personaTrait.create({
      data: { personaId: persona.id, key: "humor", value: "Manual vence", confidence: 1, sourceKind: "MANUAL" },
    });
    const evidenceId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Da fonte",
      confidence: 0.9,
    });
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "REJECTED" });
    const view = await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      sourceKind: "MANUAL",
      value: "Manual vence",
      evidenceId: null,
    });
  });
});

describe("persona.evidence — confidence override", () => {
  it("56) aprovação com confidence override", async () => {
    await createPersonaEvidence(userA.id, overrideChar.id, validEvidenceInput({ confidence: 0.5 }));
    const evidenceId = await evidenceIdByKey(overrideChar.id, "humor");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, {
      status: "APPROVED",
      confidence: 0.95,
    });
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
    });
    expect(evidence.confidence).toBe(0.95);
    expect(view.traits.find((trait) => trait.key === "humor")!.confidence).toBe(0.95);
  });

  it("57) sem override preserva confidence", async () => {
    await createPersonaEvidence(userA.id, overrideChar.id, validEvidenceInput({ traitKey: "interests", proposedValue: "Cinema", confidence: 0.4 }));
    const evidenceId = await evidenceIdByKey(overrideChar.id, "interests");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
    });
    expect(evidence.confidence).toBe(0.4);
    expect(view.traits.find((trait) => trait.key === "interests")!.confidence).toBe(0.4);
  });
});

describe("persona.evidence — reconcile", () => {
  it("58) reconcile sem state change é idempotente", async () => {
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: reconcileChar.id },
    });
    const traitBefore = await prisma.personaTrait.findUniqueOrThrow({
      where: { personaId_key_context: { personaId: persona.id, key: "humor", context: "ON_TRACK" } },
    });

    const weakId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Irrelevante",
      confidence: 0.1,
    });
    await reviewPersonaEvidence(admin.id, weakId, { status: "APPROVED" });

    const traitAfter = await prisma.personaTrait.findUniqueOrThrow({
      where: { personaId_key_context: { personaId: persona.id, key: "humor", context: "ON_TRACK" } },
    });
    expect(traitAfter).toEqual(traitBefore);
    expect(
      await prisma.personaTrait.count({ where: { personaId: persona.id, key: "humor" } }),
    ).toBe(1);
  });

  it("59) value igual mas evidenceId diferente atualiza linhagem", async () => {
    const persona = await seedPersona(lineageChar.id, "ORIGINAL", userA.id);
    const weakId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Mesmo valor",
      confidence: 0.5,
    });
    await reviewPersonaEvidence(admin.id, weakId, { status: "APPROVED" });
    const strongId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Mesmo valor",
      confidence: 0.9,
    });
    const view = await reviewPersonaEvidence(admin.id, strongId, { status: "APPROVED" });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Mesmo valor",
      confidence: 0.9,
      evidenceId: strongId,
      sourceKind: "EVIDENCE",
    });
  });

  it("60) evidence órfã não cria trait", async () => {
    const persona = await seedPersona(orphanChar.id, "ORIGINAL", userA.id);
    const evidenceId = await seedProposedEvidence(persona.id, {
      traitKey: "humor",
      proposedValue: "Órfã",
      confidence: 0.6,
    });
    expect(
      await prisma.personaTrait.count({ where: { personaId: persona.id } }),
    ).toBe(0);
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "REJECTED" });
    const stored = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
    });
    expect(stored.status).toBe("REJECTED");
    expect(
      await prisma.personaTrait.count({ where: { personaId: persona.id } }),
    ).toBe(0);
  });
});

describe("persona.evidence — concurrency", () => {
  let lowId: string;
  let highId: string;

  it("61) duas approvals do mesmo trait", async () => {
    const persona = await ensurePersona(userA.id, conc1Char.id);
    const personaId = persona.persona.id!;
    lowId = await seedProposedEvidence(personaId, {
      traitKey: "humor",
      proposedValue: "Baixa",
      confidence: 0.4,
    });
    highId = await seedProposedEvidence(personaId, {
      traitKey: "humor",
      proposedValue: "Alta",
      confidence: 0.9,
    });
    const results = await Promise.allSettled([
      reviewPersonaEvidence(admin.id, lowId, { status: "APPROVED" }),
      reviewPersonaEvidence(admin.id, highId, { status: "APPROVED" }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
  });

  it("62) approval + rejection concorrentes são consistentes", async () => {
    const persona = await ensurePersona(userA.id, conc2Char.id);
    const evidenceId = await seedProposedEvidence(persona.persona.id!, {
      traitKey: "humor",
      proposedValue: "Corrida",
      confidence: 0.7,
    });
    const results = await Promise.allSettled([
      reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" }),
      reviewPersonaEvidence(admin.id, evidenceId, { status: "REJECTED" }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: evidenceId },
    });
    const traitCount = await prisma.personaTrait.count({
      where: { persona: { characterId: conc2Char.id }, key: "humor" },
    });
    if (evidence.status === "APPROVED") {
      expect(traitCount).toBe(1);
    } else {
      expect(traitCount).toBe(0);
    }
  });

  it("63) approvals de evidências diferentes não interferem", async () => {
    const persona = await ensurePersona(userA.id, conc3Char.id);
    const firstId = await seedProposedEvidence(persona.persona.id!, {
      traitKey: "humor",
      proposedValue: "Humoral",
      confidence: 0.6,
    });
    const secondId = await seedProposedEvidence(persona.persona.id!, {
      traitKey: "interests",
      proposedValue: "Interesses",
      confidence: 0.6,
    });
    const results = await Promise.allSettled([
      reviewPersonaEvidence(admin.id, firstId, { status: "APPROVED" }),
      reviewPersonaEvidence(admin.id, secondId, { status: "APPROVED" }),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    expect(
      await prisma.personaTrait.count({
        where: { persona: { characterId: conc3Char.id } },
      }),
    ).toBe(2);
  });

  it("64) exatamente um PersonaTrait final", async () => {
    expect(
      await prisma.personaTrait.count({
        where: { persona: { characterId: conc1Char.id }, key: "humor" },
      }),
    ).toBe(1);
  });

  it("65) authority final determinística", async () => {
    const view = await getPersonaView(userA.id, conc1Char.id);
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Alta",
      evidenceId: highId,
      confidence: 0.9,
    });
  });
});

describe("persona.evidence — isolation", () => {
  it("66) Universe A não acessa evidence de B", async () => {
    await createPersonaEvidence(userB.id, charB.id, validEvidenceInput({ proposedValue: "Do B" }));
    const evidenceId = await evidenceIdByKey(charB.id, "humor");
    await expect(
      createPersonaEvidence(userA.id, charB.id, validEvidenceInput()),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    await expect(
      reviewPersonaEvidence(userA.id, evidenceId, { status: "APPROVED" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
  });

  it("67) ADMIN revisa conforme política administrativa", async () => {
    const evidenceId = await evidenceIdByKey(charB.id, "humor");
    const view = await reviewPersonaEvidence(admin.id, evidenceId, {
      status: "APPROVED",
    });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Do B",
      sourceKind: "EVIDENCE",
    });
  });

  it("68) catálogo global continua sem Persona", async () => {
    await expect(
      reviewPersonaEvidence(admin.id, "00000000-0000-4000-8000-00000000dead", {
        status: "APPROVED",
      }),
    ).rejects.toMatchObject({ code: "EVIDENCE_NOT_FOUND", statusCode: 404 });
    expect(
      await prisma.characterPersona.count({ where: { characterId: globalCatalogChar.id } }),
    ).toBe(0);
  });
});

describe("persona.evidence — regression", () => {
  it("69) Character.dna intacto após workflow", async () => {
    await createPersonaEvidence(userA.id, regressionChar.id, validEvidenceInput());
    const evidenceId = await evidenceIdByKey(regressionChar.id, "humor");
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "APPROVED" });
    await reviewPersonaEvidence(admin.id, evidenceId, { status: "REJECTED" });
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: regressionChar.id },
    });
    expect(character.dna).toEqual({ personality: "protegida" });
  });

  it("70) biography intacta", async () => {
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: regressionChar.id },
    });
    expect(character.biography).toBe("Biografia do piloto");
    expect(character).toEqual(regressionCharacterSnapshot);
  });

  it("71) DriverProfile intacto", async () => {
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: regressionProfileId },
    });
    expect(profile).toEqual(regressionProfileSnapshot);
    expect(profile.number).toBe(7);
  });

  it("72) Memory intacta", async () => {
    const memory = await prisma.memory.findUniqueOrThrow({
      where: { id: regressionMemorySnapshot.id as string },
      include: { participants: true },
    });
    expect(memory as unknown as Record<string, unknown>).toMatchObject(
      regressionMemorySnapshot,
    );
    expect(memory.participants).toHaveLength(1);
    expect(memory.participants[0]!.characterId).toBe(regressionChar.id);
  });

  it("73) Relationship intacta", async () => {
    const relationship = await prisma.relationship.findUniqueOrThrow({
      where: { id: regressionRelationshipSnapshot.id as string },
    });
    expect(relationship as unknown as Record<string, unknown>).toEqual(
      regressionRelationshipSnapshot,
    );
  });

  it("74) Timeline intacta", async () => {
    const timelineEvent = await prisma.timelineEvent.findUniqueOrThrow({
      where: { id: regressionTimelineSnapshot.id as string },
    });
    expect(timelineEvent as unknown as Record<string, unknown>).toEqual(
      regressionTimelineSnapshot,
    );
  });
});
