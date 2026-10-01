import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  deletePersonaTrait,
  ensurePersona,
  getPersonaView,
  updatePersonaManually,
} from "./persona.service.js";

const PREFIX = "persona-manual";
const EXTERNAL_SOURCE = "persona-manual-test";

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdExternalDriverIds: string[] = [];
const createdSeasonIds: string[] = [];

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `Manual ${label}`,
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`,
      password: null,
      emailVerified: true,
      image: null,
      role: "USER",
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

async function seedPersona(characterId: string, origin: "ORIGINAL" | "REAL_DRIVER" | "AI_CHARACTER", createdById: string | null = null) {
  return prisma.characterPersona.create({
    data: { characterId, origin, schemaVersion: "persona.v1", createdById },
  });
}

function seedEvidenceInput(
  personaId: string,
  overrides: Partial<{
    traitKey: string;
    proposedValue: string;
    confidence: number;
    status: "PROPOSED" | "APPROVED" | "REJECTED";
  }> = {},
) {
  return {
    personaId,
    traitKey: overrides.traitKey ?? "humor",
    proposedValue: overrides.proposedValue ?? "Proposto",
    sourceType: "INTERVIEW" as const,
    title: "Fonte",
    url: null,
    publishedAt: null,
    excerpt: "Trecho",
    confidence: overrides.confidence ?? 0.9,
    status: overrides.status ?? ("APPROVED" as const),
  };
}

let userA: { id: string };
let userB: { id: string };
let universeA: { id: string };
let universeB: { id: string };

let summaryChar: { id: string };
let summaryNoPersonaChar: { id: string };
let atomicSuccessChar: { id: string };
let atomicFailChar: { id: string };
let createTraitChar: { id: string };
let updateTraitChar: { id: string };
let convertChar: { id: string };
let overEvidenceChar: { id: string };
let deleteChar: { id: string };
let deleteNoPersonaChar: { id: string };
let deleteNoTraitChar: { id: string };
let materializedCharA: { id: string };
let globalCatalogChar: { id: string };
let originalCharB: { id: string };
let sharedPilotCharA: { id: string };
let sharedPilotCharB: { id: string };
let concSameTraitChar: { id: string };
let concDiffTraitChar: { id: string };
let concPatchDeleteChar: { id: string };
let concEnsurePatchChar: { id: string };
let regressionChar: { id: string };
let regressionProfileId: string;
let regressionEntryId: string;
let regressionEvidenceId: string;

let convertMainEvidenceId: string;
let convertSupportEvidenceId: string;
let convertEvidenceSnapshots: Array<Record<string, unknown>>;
let overEvidenceSnapshot: Record<string, unknown>;
let deleteEvidenceSnapshots: Array<Record<string, unknown>>;
let regressionCharacterSnapshot: Record<string, unknown>;
let regressionEntrySnapshot: Record<string, unknown>;
let regressionEvidenceSnapshot: Record<string, unknown>;
let globalCharSnapshot: Record<string, unknown>;

beforeAll(async () => {
  userA = await createUser("user-a");
  userB = await createUser("user-b");
  universeA = await createUniverse(userA.id);
  universeB = await createUniverse(userB.id);

  summaryChar = await createCharacter({ label: "summary", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  summaryNoPersonaChar = await createCharacter({ label: "summary-sem-persona", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  atomicSuccessChar = await createCharacter({ label: "atomic-ok", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  atomicFailChar = await createCharacter({ label: "atomic-fail", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  createTraitChar = await createCharacter({ label: "create-trait", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

  updateTraitChar = await createCharacter({ label: "update-trait", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  const updatePersona = await seedPersona(updateTraitChar.id, "ORIGINAL", userA.id);
  const updateEvidence = await prisma.personaEvidence.create({
    data: seedEvidenceInput(updatePersona.id, { confidence: 0.4 }),
  });
  await prisma.personaTrait.create({
    data: {
      personaId: updatePersona.id,
      key: "humor",
      value: "Original",
      confidence: 0.4,
      sourceKind: "MANUAL",
      evidenceId: updateEvidence.id,
    },
  });
  await prisma.personaTrait.create({
    data: {
      personaId: updatePersona.id,
      key: "interests",
      value: "Astronomia",
      confidence: 1,
      sourceKind: "MANUAL",
    },
  });

  convertChar = await createCharacter({ label: "convert", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  const convertPersona = await seedPersona(convertChar.id, "ORIGINAL", userA.id);
  const convertMain = await prisma.personaEvidence.create({
    data: seedEvidenceInput(convertPersona.id, { confidence: 0.9 }),
  });
  const convertSupport = await prisma.personaEvidence.create({
    data: seedEvidenceInput(convertPersona.id, { confidence: 0.5 }),
  });
  convertMainEvidenceId = convertMain.id;
  convertSupportEvidenceId = convertSupport.id;
  await prisma.personaTrait.create({
    data: {
      personaId: convertPersona.id,
      key: "humor",
      value: "Proposto",
      confidence: 0.9,
      sourceKind: "EVIDENCE",
      evidenceId: convertMain.id,
    },
  });
  convertEvidenceSnapshots = (await prisma.personaEvidence.findMany({
    where: { personaId: convertPersona.id },
    orderBy: { id: "asc" },
  })) as unknown as Array<Record<string, unknown>>;

  overEvidenceChar = await createCharacter({ label: "over-evidence", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  const overEvidencePersona = await seedPersona(overEvidenceChar.id, "ORIGINAL", userA.id);
  const overEvidence = await prisma.personaEvidence.create({
    data: seedEvidenceInput(overEvidencePersona.id, { confidence: 0.8 }),
  });
  overEvidenceSnapshot = (await prisma.personaEvidence.findUniqueOrThrow({
    where: { id: overEvidence.id },
  })) as unknown as Record<string, unknown>;

  deleteChar = await createCharacter({ label: "delete", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  const deletePersona = await seedPersona(deleteChar.id, "ORIGINAL", userA.id);
  const deleteEvidenceA = await prisma.personaEvidence.create({
    data: seedEvidenceInput(deletePersona.id, { traitKey: "interests", proposedValue: "Astronomia", confidence: 0.6 }),
  });
  await prisma.personaEvidence.create({
    data: seedEvidenceInput(deletePersona.id, { traitKey: "humor", proposedValue: "Seco", confidence: 0.5 }),
  });
  await prisma.personaTrait.create({
    data: { personaId: deletePersona.id, key: "humor", value: "Manual", confidence: 1, sourceKind: "MANUAL" },
  });
  await prisma.personaTrait.create({
    data: {
      personaId: deletePersona.id,
      key: "interests",
      value: "Astronomia",
      confidence: 0.6,
      sourceKind: "EVIDENCE",
      evidenceId: deleteEvidenceA.id,
    },
  });
  deleteEvidenceSnapshots = (await prisma.personaEvidence.findMany({
    where: { personaId: deletePersona.id },
    orderBy: { id: "asc" },
  })) as unknown as Array<Record<string, unknown>>;

  deleteNoPersonaChar = await createCharacter({ label: "delete-sem-persona", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  deleteNoTraitChar = await createCharacter({ label: "delete-sem-trait", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  await seedPersona(deleteNoTraitChar.id, "ORIGINAL", userA.id);

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
  globalCharSnapshot = (await prisma.character.findUniqueOrThrow({
    where: { id: globalCatalogChar.id },
  })) as unknown as Record<string, unknown>;

  originalCharB = await createCharacter({ label: "original-b", userId: userB.id, universeId: universeB.id, controlledBy: "USER" });

  const sharedExternal = await createExternalDriver("compartilhado");
  sharedPilotCharA = await createCharacter({ label: "compartilhado-a", userId: null, universeId: universeA.id, controlledBy: "AI" });
  sharedPilotCharB = await createCharacter({ label: "compartilhado-b", userId: null, universeId: universeB.id, controlledBy: "AI" });
  await prisma.externalBindingDriver.create({
    data: { universeId: universeA.id, externalDriverId: sharedExternal.id, characterId: sharedPilotCharA.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });
  await prisma.externalBindingDriver.create({
    data: { universeId: universeB.id, externalDriverId: sharedExternal.id, characterId: sharedPilotCharB.id, confidence: "CONFIRMED", boundBy: "ADMIN" },
  });

  concSameTraitChar = await createCharacter({ label: "conc-same", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  concDiffTraitChar = await createCharacter({ label: "conc-diff", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  concPatchDeleteChar = await createCharacter({ label: "conc-patch-delete", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });
  concEnsurePatchChar = await createCharacter({ label: "conc-ensure-patch", userId: userA.id, universeId: universeA.id, controlledBy: "USER" });

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
    data: { characterId: regressionChar.id, number: 9 },
  });
  regressionProfileId = regressionProfile.id;
  const regressionSeason = await prisma.season.create({
    data: { universeId: universeA.id, year: 2044, name: "2044", status: "ACTIVE" },
  });
  createdSeasonIds.push(regressionSeason.id);
  const regressionEntry = await prisma.seasonDriverEntry.create({
    data: {
      seasonId: regressionSeason.id,
      driverProfileId: regressionProfile.id,
      teamId: null,
      role: "RACE_SEAT",
      seat: 1,
      number: 9,
      status: "ACTIVE",
    },
  });
  regressionEntryId = regressionEntry.id;
  regressionEntrySnapshot = (await prisma.seasonDriverEntry.findUniqueOrThrow({
    where: { id: regressionEntry.id },
  })) as unknown as Record<string, unknown>;

  const regressionPersona = await seedPersona(regressionChar.id, "REAL_DRIVER", null);
  const regressionEvidence = await prisma.personaEvidence.create({
    data: seedEvidenceInput(regressionPersona.id, { confidence: 0.7 }),
  });
  regressionEvidenceId = regressionEvidence.id;
  regressionEvidenceSnapshot = (await prisma.personaEvidence.findUniqueOrThrow({
    where: { id: regressionEvidence.id },
  })) as unknown as Record<string, unknown>;
  await prisma.personaTrait.create({
    data: {
      personaId: regressionPersona.id,
      key: "humor",
      value: "Proposto",
      confidence: 0.7,
      sourceKind: "EVIDENCE",
      evidenceId: regressionEvidence.id,
    },
  });
  await prisma.personaTrait.create({
    data: { personaId: regressionPersona.id, key: "interests", value: "História", confidence: 1, sourceKind: "MANUAL" },
  });
  regressionCharacterSnapshot = (await prisma.character.findUniqueOrThrow({
    where: { id: regressionChar.id },
  })) as unknown as Record<string, unknown>;
});

afterAll(async () => {
  await prisma.seasonDriverEntry.deleteMany({ where: { seasonId: { in: createdSeasonIds } } });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.season.deleteMany({ where: { id: { in: createdSeasonIds } } });
  await prisma.externalDriver.deleteMany({ where: { id: { in: createdExternalDriverIds } } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("persona.manual — summary", () => {
  it("1) criar summary em Persona inexistente", async () => {
    const view = await updatePersonaManually(userA.id, summaryChar.id, {
      summary: "Calmo sob pressão",
    });
    expect(view.exists).toBe(true);
    expect(view.summary).toBe("Calmo sob pressão");
    expect(
      await prisma.characterPersona.count({ where: { characterId: summaryChar.id } }),
    ).toBe(1);
  });

  it("2) atualizar summary existente", async () => {
    const view = await updatePersonaManually(userA.id, summaryChar.id, {
      summary: "Agressivo",
    });
    expect(view.summary).toBe("Agressivo");
    expect(
      await prisma.characterPersona.count({ where: { characterId: summaryChar.id } }),
    ).toBe(1);
  });

  it("3) limpar summary com null", async () => {
    const view = await updatePersonaManually(userA.id, summaryChar.id, {
      summary: null,
    });
    expect(view.exists).toBe(true);
    expect(view.summary).toBeNull();
    expect(
      await prisma.characterPersona.count({ where: { characterId: summaryChar.id } }),
    ).toBe(1);
  });

  it("4) PATCH somente null em Persona inexistente não cria Persona", async () => {
    const view = await updatePersonaManually(userA.id, summaryNoPersonaChar.id, {
      summary: null,
    });
    expect(view.exists).toBe(false);
    expect(view.id).toBeNull();
    expect(view.origin).toBe("ORIGINAL");
    expect(
      await prisma.characterPersona.count({
        where: { characterId: summaryNoPersonaChar.id },
      }),
    ).toBe(0);
  });

  it("5) summary + traits aplicados juntos", async () => {
    const view = await updatePersonaManually(userA.id, atomicSuccessChar.id, {
      summary: "Completo",
      traits: [{ key: "humor", value: "Seco" }],
    });
    expect(view.summary).toBe("Completo");
    expect(view.traits.map((trait) => trait.key)).toEqual(["humor"]);
    expect(view.traits[0]!.value).toBe("Seco");
  });
});

describe("persona.manual — criar trait", () => {
  it("6) criar trait inexistente", async () => {
    const view = await updatePersonaManually(userA.id, createTraitChar.id, {
      traits: [{ key: "humor", value: "Sarcástico" }],
    });
    expect(view.traits).toHaveLength(1);
    expect(view.traits[0]).toMatchObject({ key: "humor", value: "Sarcástico" });
  });

  it("7) sourceKind = MANUAL", async () => {
    const view = await getPersonaView(userA.id, createTraitChar.id);
    expect(view.traits[0]!.sourceKind).toBe("MANUAL");
  });

  it("8) confidence = 1", async () => {
    const view = await getPersonaView(userA.id, createTraitChar.id);
    expect(view.traits[0]!.confidence).toBe(1);
  });

  it("9) evidenceId = null", async () => {
    const view = await getPersonaView(userA.id, createTraitChar.id);
    expect(view.traits[0]!.evidenceId).toBeNull();
  });

  it("10) trait inválido rejeitado sem escrita parcial", async () => {
    const before = await prisma.personaTrait.count({
      where: { persona: { characterId: createTraitChar.id } },
    });
    await expect(
      updatePersonaManually(userA.id, createTraitChar.id, {
        traits: [{ key: "charisma", value: "Carismático" }],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400,
      issues: [{ field: "traitKey", code: "TRAIT_KEY_UNKNOWN" }],
    });
    const after = await prisma.personaTrait.count({
      where: { persona: { characterId: createTraitChar.id } },
    });
    expect(after).toBe(before);
  });

  it("11) value vazio rejeitado", async () => {
    await expect(
      updatePersonaManually(userA.id, createTraitChar.id, {
        traits: [{ key: "speechStyle", value: "   " }],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "value", code: "TRAIT_VALUE_EMPTY" }],
    });
    expect(
      await prisma.personaTrait.count({
        where: { persona: { characterId: createTraitChar.id } },
      }),
    ).toBe(1);
  });

  it("12) value > 200 rejeitado", async () => {
    await expect(
      updatePersonaManually(userA.id, createTraitChar.id, {
        traits: [{ key: "speechStyle", value: "x".repeat(201) }],
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "value", code: "TRAIT_VALUE_TOO_LONG" }],
    });
    expect(
      await prisma.personaTrait.count({
        where: { persona: { characterId: createTraitChar.id } },
      }),
    ).toBe(1);
  });

  it("12b) summary > 2000 rejeitado sem criar Persona", async () => {
    await expect(
      updatePersonaManually(userA.id, summaryNoPersonaChar.id, {
        summary: "x".repeat(2001),
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      issues: [{ field: "summary", code: "SUMMARY_TOO_LONG" }],
    });
    expect(
      await prisma.characterPersona.count({
        where: { characterId: summaryNoPersonaChar.id },
      }),
    ).toBe(0);
  });
});

describe("persona.manual — atualizar trait MANUAL", () => {
  it("13) atualizar trait MANUAL", async () => {
    const view = await updatePersonaManually(userA.id, updateTraitChar.id, {
      traits: [{ key: "humor", value: "Atualizado" }],
    });
    const humor = view.traits.find((trait) => trait.key === "humor")!;
    expect(humor.value).toBe("Atualizado");
  });

  it("14) manter confidence = 1 (normaliza valor legado)", async () => {
    const view = await getPersonaView(userA.id, updateTraitChar.id);
    expect(view.traits.find((trait) => trait.key === "humor")!.confidence).toBe(1);
  });

  it("15) manter evidenceId null (limpa vínculo legado)", async () => {
    const view = await getPersonaView(userA.id, updateTraitChar.id);
    expect(view.traits.find((trait) => trait.key === "humor")!.evidenceId).toBeNull();
  });

  it("16) traits não enviados permanecem intactos", async () => {
    const view = await getPersonaView(userA.id, updateTraitChar.id);
    expect(view.traits.find((trait) => trait.key === "interests")).toMatchObject({
      value: "Astronomia",
      confidence: 1,
      sourceKind: "MANUAL",
    });
  });
});

describe("persona.manual — EVIDENCE -> MANUAL", () => {
  it("17) converter EVIDENCE em MANUAL", async () => {
    const view = await updatePersonaManually(userA.id, convertChar.id, {
      traits: [{ key: "humor", value: "Manual vence" }],
    });
    const humor = view.traits.find((trait) => trait.key === "humor")!;
    expect(humor.sourceKind).toBe("MANUAL");
    expect(humor.value).toBe("Manual vence");
  });

  it("18) limpar evidenceId", async () => {
    const view = await getPersonaView(userA.id, convertChar.id);
    expect(view.traits.find((trait) => trait.key === "humor")!.evidenceId).toBeNull();
  });

  it("19) preservar evidence", async () => {
    const evidence = await prisma.personaEvidence.findUnique({
      where: { id: convertMainEvidenceId },
    });
    expect(evidence).not.toBeNull();
    expect(await prisma.personaEvidence.count({ where: { persona: { characterId: convertChar.id } } })).toBe(2);
  });

  it("20) preservar status APPROVED da evidence", async () => {
    const main = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: convertMainEvidenceId },
    });
    const support = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: convertSupportEvidenceId },
    });
    expect(main.status).toBe("APPROVED");
    expect(support.status).toBe("APPROVED");
  });

  it("21) não chama reconcile (nada além da conversão)", async () => {
    const traits = await prisma.personaTrait.findMany({
      where: { persona: { characterId: convertChar.id } },
    });
    expect(traits).toHaveLength(1);
    const evidenceRows = await prisma.personaEvidence.findMany({
      where: { persona: { characterId: convertChar.id } },
      orderBy: { id: "asc" },
    });
    expect(evidenceRows as unknown as Array<Record<string, unknown>>).toEqual(
      convertEvidenceSnapshots,
    );
  });

  it("22) evidence concorrente permanece intacta (supporting)", async () => {
    const view = await getPersonaView(userA.id, convertChar.id);
    const roles = new Map(view.evidences.map((evidence) => [evidence.id, evidence.role]));
    expect(roles.get(convertMainEvidenceId)).toBe("AUTHORITATIVE");
    expect(roles.get(convertSupportEvidenceId)).toBe("SUPPORTING");
  });
});

describe("persona.manual — criar MANUAL sobre evidence existente", () => {
  it("23) criar MANUAL sobre key com evidence APPROVED", async () => {
    const view = await updatePersonaManually(userA.id, overEvidenceChar.id, {
      traits: [{ key: "humor", value: "Autorado" }],
    });
    expect(view.traits.find((trait) => trait.key === "humor")).toMatchObject({
      value: "Autorado",
      sourceKind: "MANUAL",
    });
  });

  it("24) evidence continua intacta", async () => {
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: overEvidenceSnapshot.id as string },
    });
    expect(evidence as unknown as Record<string, unknown>).toEqual(overEvidenceSnapshot);
  });

  it("25) manual vence (evidence não é promovida)", async () => {
    const view = await getPersonaView(userA.id, overEvidenceChar.id);
    const trait = view.traits.find((item) => item.key === "humor")!;
    expect(trait.sourceKind).toBe("MANUAL");
    expect(trait.confidence).toBe(1);
    expect(trait.evidenceId).toBeNull();
    expect(view.evidences[0]!.status).toBe("APPROVED");
  });
});

describe("persona.manual — delete trait", () => {
  it("26) remover trait MANUAL", async () => {
    const view = await deletePersonaTrait(userA.id, deleteChar.id, "humor");
    expect(view.traits.map((trait) => trait.key)).not.toContain("humor");
  });

  it("27) remover trait EVIDENCE", async () => {
    const view = await deletePersonaTrait(userA.id, deleteChar.id, "interests");
    expect(view.traits).toHaveLength(0);
  });

  it("28) evidence permanece intacta", async () => {
    const evidenceRows = await prisma.personaEvidence.findMany({
      where: { persona: { characterId: deleteChar.id } },
      orderBy: { id: "asc" },
    });
    expect(evidenceRows as unknown as Array<Record<string, unknown>>).toEqual(
      deleteEvidenceSnapshots,
    );
  });

  it("29) trait não reaparece após DELETE (sem reconcile)", async () => {
    await getPersonaView(userA.id, deleteChar.id);
    const view = await getPersonaView(userA.id, deleteChar.id);
    expect(view.traits).toHaveLength(0);
    expect(view.evidences).toHaveLength(2);
    expect(view.evidences.every((evidence) => evidence.status === "APPROVED")).toBe(true);
  });

  it("30) DELETE não cria Persona", async () => {
    await expect(
      deletePersonaTrait(userA.id, deleteNoPersonaChar.id, "humor"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(
      await prisma.characterPersona.count({
        where: { characterId: deleteNoPersonaChar.id },
      }),
    ).toBe(0);
  });

  it("31) Persona inexistente produz erro determinístico", async () => {
    const error = await deletePersonaTrait(userA.id, deleteNoPersonaChar.id, "humor").catch(
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    expect(
      await prisma.characterPersona.count({
        where: { characterId: deleteNoPersonaChar.id },
      }),
    ).toBe(0);
  });

  it("32) trait inexistente produz erro determinístico", async () => {
    await expect(
      deletePersonaTrait(userA.id, deleteNoTraitChar.id, "humor"),
    ).rejects.toMatchObject({ code: "TRAIT_NOT_FOUND", statusCode: 404 });
    expect(
      await prisma.characterPersona.count({
        where: { characterId: deleteNoTraitChar.id },
      }),
    ).toBe(1);
  });
});

describe("persona.manual — ownership", () => {
  it("33) owner original pode editar", async () => {
    const view = await updatePersonaManually(userA.id, summaryChar.id, {
      summary: "Ownership ok",
    });
    expect(view.summary).toBe("Ownership ok");
  });

  it("34) outro usuário não pode editar nem remover", async () => {
    await expect(
      updatePersonaManually(userB.id, summaryChar.id, { summary: "Invasão" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    await expect(
      deletePersonaTrait(userB.id, summaryChar.id, "humor"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: summaryChar.id },
    });
    expect(persona.summary).toBe("Ownership ok");
  });

  it("35) owner do Universe pode editar materializado", async () => {
    const view = await updatePersonaManually(userA.id, materializedCharA.id, {
      traits: [{ key: "competitiveness", value: "Intenso" }],
    });
    expect(view.origin).toBe("REAL_DRIVER");
    expect(view.traits.find((trait) => trait.key === "competitiveness")!.value).toBe(
      "Intenso",
    );
  });

  it("36) outro Universe não pode editar materializado", async () => {
    await expect(
      updatePersonaManually(userB.id, materializedCharA.id, {
        traits: [{ key: "humor", value: "Invasão" }],
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("37) catálogo AI global não pode editar", async () => {
    await expect(
      updatePersonaManually(userA.id, globalCatalogChar.id, {
        traits: [{ key: "humor", value: "Global" }],
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });
    expect(
      await prisma.characterPersona.count({
        where: { characterId: globalCatalogChar.id },
      }),
    ).toBe(0);
  });
});

describe("persona.manual — isolation", () => {
  it("38) User A não altera Persona de B", async () => {
    await ensurePersona(userB.id, originalCharB.id);
    await expect(
      updatePersonaManually(userA.id, originalCharB.id, { summary: "Invasão" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: originalCharB.id },
    });
    expect(persona.summary).toBeNull();
  });

  it("39) mesmo piloto em dois Universes permanece independente", async () => {
    const viewA = await updatePersonaManually(userA.id, sharedPilotCharA.id, {
      summary: "Reservado no A",
    });
    const viewB = await updatePersonaManually(userB.id, sharedPilotCharB.id, {
      summary: "Titular no B",
    });
    expect(viewA.origin).toBe("REAL_DRIVER");
    expect(viewB.origin).toBe("REAL_DRIVER");
    expect(viewA.id).not.toBe(viewB.id);
    expect(viewA.summary).toBe("Reservado no A");
    expect(viewB.summary).toBe("Titular no B");
  });
});

describe("persona.manual — atomicidade", () => {
  it("40) erro em segundo trait não deixa primeiro salvo", async () => {
    await expect(
      updatePersonaManually(userA.id, atomicFailChar.id, {
        traits: [
          { key: "humor", value: "Válido" },
          { key: "charisma", value: "Inválido" },
        ],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    expect(
      await prisma.characterPersona.count({ where: { characterId: atomicFailChar.id } }),
    ).toBe(0);
    expect(
      await prisma.personaTrait.count({
        where: { persona: { characterId: atomicFailChar.id } },
      }),
    ).toBe(0);
  });

  it("41) summary + traits falham juntos quando necessário", async () => {
    await expect(
      updatePersonaManually(userA.id, summaryChar.id, {
        summary: "Não deve persistir",
        traits: [{ key: "charisma", value: "Inválido" }],
      }),
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: summaryChar.id },
      include: { traits: true },
    });
    expect(persona.summary).toBe("Ownership ok");
    expect(persona.traits).toHaveLength(0);
  });
});

describe("persona.manual — concorrência", () => {
  it("42) dois PATCH do mesmo trait deixam exatamente um trait", async () => {
    const [first, second] = await Promise.all([
      updatePersonaManually(userA.id, concSameTraitChar.id, {
        traits: [{ key: "humor", value: "Versão A" }],
      }),
      updatePersonaManually(userA.id, concSameTraitChar.id, {
        traits: [{ key: "humor", value: "Versão B" }],
      }),
    ]);
    expect(first.exists).toBe(true);
    expect(second.exists).toBe(true);
    const traits = await prisma.personaTrait.findMany({
      where: { persona: { characterId: concSameTraitChar.id } },
    });
    expect(traits).toHaveLength(1);
    expect(["Versão A", "Versão B"]).toContain(traits[0]!.value);
  });

  it("43) PATCH concorrente de traits diferentes não cria duplicação", async () => {
    const [first, second] = await Promise.all([
      updatePersonaManually(userA.id, concDiffTraitChar.id, {
        traits: [{ key: "humor", value: "Seco" }],
      }),
      updatePersonaManually(userA.id, concDiffTraitChar.id, {
        traits: [{ key: "interests", value: "Astronomia" }],
      }),
    ]);
    expect(first.exists).toBe(true);
    expect(second.exists).toBe(true);
    const traits = await prisma.personaTrait.findMany({
      where: { persona: { characterId: concDiffTraitChar.id } },
      orderBy: { key: "asc" },
    });
    expect(traits.map((trait) => trait.key)).toEqual(["humor", "interests"]);
    expect(
      await prisma.characterPersona.count({
        where: { characterId: concDiffTraitChar.id },
      }),
    ).toBe(1);
  });

  it("44) PATCH + DELETE do mesmo trait mantém a constraint", async () => {
    await updatePersonaManually(userA.id, concPatchDeleteChar.id, {
      traits: [{ key: "humor", value: "Original" }],
    });
    const results = await Promise.allSettled([
      updatePersonaManually(userA.id, concPatchDeleteChar.id, {
        traits: [{ key: "humor", value: "Novo" }],
      }),
      deletePersonaTrait(userA.id, concPatchDeleteChar.id, "humor"),
    ]);
    expect(results.every((result) => result.status === "fulfilled")).toBe(true);
    const traits = await prisma.personaTrait.findMany({
      where: { persona: { characterId: concPatchDeleteChar.id }, key: "humor" },
    });
    expect(traits.length).toBeLessThanOrEqual(1);
  });

  it("45) ensure + PATCH não duplica Persona", async () => {
    const [ensured, patched] = await Promise.all([
      ensurePersona(userA.id, concEnsurePatchChar.id),
      updatePersonaManually(userA.id, concEnsurePatchChar.id, {
        traits: [{ key: "humor", value: "Seco" }],
      }),
    ]);
    expect(ensured.persona.id).toBe(patched.id);
    expect(
      await prisma.characterPersona.count({
        where: { characterId: concEnsurePatchChar.id },
      }),
    ).toBe(1);
    expect(patched.traits.find((trait) => trait.key === "humor")!.value).toBe("Seco");
  });
});

describe("persona.manual — regression", () => {
  it("46) Character.dna intacto após conversão e remoção", async () => {
    await updatePersonaManually(userA.id, regressionChar.id, {
      traits: [{ key: "humor", value: "Manual" }],
    });
    await deletePersonaTrait(userA.id, regressionChar.id, "interests");
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: regressionChar.id },
    });
    expect(character.dna).toEqual({ personality: "protegida" });
  });

  it("47) biography intacta", async () => {
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: regressionChar.id },
    });
    expect(character.biography).toBe("Biografia do piloto");
    expect(character).toEqual(regressionCharacterSnapshot);
  });

  it("48) DriverProfile intacto", async () => {
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { id: regressionProfileId },
    });
    expect(profile.number).toBe(9);
    expect(profile.characterId).toBe(regressionChar.id);
  });

  it("49) SeasonDriverEntry intacto", async () => {
    const entry = await prisma.seasonDriverEntry.findUniqueOrThrow({
      where: { id: regressionEntryId },
    });
    expect(entry).toEqual(regressionEntrySnapshot);
  });

  it("50) evidências intactas", async () => {
    const evidence = await prisma.personaEvidence.findUniqueOrThrow({
      where: { id: regressionEvidenceId },
    });
    expect(evidence).toEqual(regressionEvidenceSnapshot);
    expect(evidence.status).toBe("APPROVED");
  });

  it("51) ai-catalog intacto", async () => {
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: globalCatalogChar.id },
    });
    expect(character).toEqual(globalCharSnapshot);
    expect(
      await prisma.characterPersona.count({
        where: { characterId: globalCatalogChar.id },
      }),
    ).toBe(0);
  });
});
