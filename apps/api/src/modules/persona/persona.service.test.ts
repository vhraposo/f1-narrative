import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  ensurePersona,
  getPersonaView,
  resolvePersonaAccess,
  resolvePersonaOrigin,
} from "./persona.service.js";

const PREFIX = "persona-service";
const EXTERNAL_SOURCE = "persona-service-test";

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdExternalDriverIds: string[] = [];

async function createUser(label: string) {
  const user = await prisma.user.create({
    data: {
      name: `Persona ${label}`,
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
  const universe = await prisma.universe.create({
    data: { userId, status: "READY" },
  });
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

async function bindDriver(
  universeId: string,
  characterId: string,
  externalDriverId: string,
) {
  return prisma.externalBindingDriver.create({
    data: {
      universeId,
      externalDriverId,
      characterId,
      confidence: "CONFIRMED",
      boundBy: "ADMIN",
    },
  });
}

let userA: { id: string };
let userB: { id: string };
let universeA: { id: string };
let universeB: { id: string };
let originalCharA: { id: string };
let originalCharB: { id: string };
let materializedCharA: { id: string };
let aiCharacterA: { id: string };
let globalCatalogChar: { id: string };
let getCharWithoutPersona: { id: string };
let ensureChar: { id: string };
let viewChar: { id: string };
let concurrencyChar: { id: string };
let sharedPilotCharA: { id: string };
let sharedPilotCharB: { id: string };
let materializedBindingId: string;

beforeAll(async () => {
  userA = await createUser("user-a");
  userB = await createUser("user-b");
  universeA = await createUniverse(userA.id);
  universeB = await createUniverse(userB.id);

  originalCharA = await createCharacter({
    label: "original-a",
    userId: userA.id,
    universeId: universeA.id,
    controlledBy: "USER",
  });
  originalCharB = await createCharacter({
    label: "original-b",
    userId: userB.id,
    universeId: universeB.id,
    controlledBy: "USER",
  });

  materializedCharA = await createCharacter({
    label: "materializado-a",
    userId: null,
    universeId: universeA.id,
    controlledBy: "AI",
    dna: { personality: "protegida" },
    biography: "Biografia original",
  });
  const materializedExternal = await createExternalDriver("real-a");
  const materializedBinding = await bindDriver(
    universeA.id,
    materializedCharA.id,
    materializedExternal.id,
  );
  materializedBindingId = materializedBinding.id;
  await prisma.driverProfile.create({
    data: { characterId: materializedCharA.id, number: 44 },
  });

  aiCharacterA = await createCharacter({
    label: "ai-interno-a",
    userId: null,
    universeId: universeA.id,
    controlledBy: "AI",
  });

  globalCatalogChar = await createCharacter({
    label: "catalogo-global",
    userId: null,
    universeId: null,
    controlledBy: "AI",
  });

  getCharWithoutPersona = await createCharacter({
    label: "get-sem-persona",
    userId: userA.id,
    universeId: universeA.id,
    controlledBy: "USER",
  });

  ensureChar = await createCharacter({
    label: "ensure",
    userId: userA.id,
    universeId: universeA.id,
    controlledBy: "USER",
  });

  viewChar = await createCharacter({
    label: "view",
    userId: userA.id,
    universeId: universeA.id,
    controlledBy: "USER",
  });

  concurrencyChar = await createCharacter({
    label: "concorrencia",
    userId: userA.id,
    universeId: universeA.id,
    controlledBy: "USER",
  });

  const sharedExternal = await createExternalDriver("compartilhado");
  sharedPilotCharA = await createCharacter({
    label: "piloto-compartilhado-a",
    userId: null,
    universeId: universeA.id,
    controlledBy: "AI",
  });
  sharedPilotCharB = await createCharacter({
    label: "piloto-compartilhado-b",
    userId: null,
    universeId: universeB.id,
    controlledBy: "AI",
  });
  await bindDriver(universeA.id, sharedPilotCharA.id, sharedExternal.id);
  await bindDriver(universeB.id, sharedPilotCharB.id, sharedExternal.id);
});

afterAll(async () => {
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.externalDriver.deleteMany({
    where: { id: { in: createdExternalDriverIds } },
  });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
});

describe("persona.service — access", () => {
  it("1) owner de Character original tem acesso", async () => {
    const access = await resolvePersonaAccess(userA.id, originalCharA.id);
    expect(access.kind).toBe("OWNER_CHARACTER");
    if (access.kind === "OWNER_CHARACTER") {
      expect(access.character.id).toBe(originalCharA.id);
      expect(access.character.userId).toBe(userA.id);
    }
    const view = await getPersonaView(userA.id, originalCharA.id);
    expect(view.characterId).toBe(originalCharA.id);
  });

  it("2) outro user não tem acesso (404 leak-safe)", async () => {
    expect((await resolvePersonaAccess(userB.id, originalCharA.id)).kind).toBe(
      "NOT_FOUND",
    );
    await expect(getPersonaView(userB.id, originalCharA.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });

  it("3) dono do Universe tem acesso ao Character materializado", async () => {
    const access = await resolvePersonaAccess(userA.id, materializedCharA.id);
    expect(access.kind).toBe("OWNER_UNIVERSE");
  });

  it("4) outro Universe não tem acesso ao materializado", async () => {
    expect(
      (await resolvePersonaAccess(userB.id, materializedCharA.id)).kind,
    ).toBe("NOT_FOUND");
    await expect(ensurePersona(userB.id, materializedCharA.id)).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
    await expect(
      getPersonaView(userB.id, materializedCharA.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("5) catálogo global é read-only", async () => {
    expect((await resolvePersonaAccess(userA.id, globalCatalogChar.id)).kind).toBe(
      "GLOBAL_AI_CATALOG",
    );
    expect(
      (
        await resolvePersonaAccess(userA.id, globalCatalogChar.id, "WRITE")
      ).kind,
    ).toBe("FORBIDDEN");
    await expect(
      ensurePersona(userA.id, globalCatalogChar.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN", statusCode: 403 });

    const view = await getPersonaView(userA.id, globalCatalogChar.id);
    expect(view.exists).toBe(false);
    expect(view.origin).toBeNull();
    expect(await prisma.characterPersona.count({ where: { characterId: globalCatalogChar.id } })).toBe(0);
  });

  it("6) Character inexistente retorna NOT_FOUND", async () => {
    expect((await resolvePersonaAccess(userA.id, randomUUID())).kind).toBe(
      "NOT_FOUND",
    );
    await expect(getPersonaView(userA.id, randomUUID())).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404,
    });
  });
});

describe("persona.service — origin", () => {
  it("7) original -> ORIGINAL", async () => {
    const result = await ensurePersona(userA.id, originalCharA.id);
    expect(result.persona.origin).toBe("ORIGINAL");
  });

  it("8) piloto real materializado -> REAL_DRIVER", async () => {
    const result = await ensurePersona(userA.id, materializedCharA.id);
    expect(result.persona.origin).toBe("REAL_DRIVER");
  });

  it("9) AI interno do Universe -> AI_CHARACTER", async () => {
    const result = await ensurePersona(userA.id, aiCharacterA.id);
    expect(result.persona.origin).toBe("AI_CHARACTER");
  });

  it("10) catálogo global não cria persona", async () => {
    await expect(
      ensurePersona(userA.id, globalCatalogChar.id),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      await prisma.characterPersona.count({
        where: { characterId: globalCatalogChar.id },
      }),
    ).toBe(0);
  });

  it("10b) resolvePersonaOrigin puro: ownership vence binding; global = null", () => {
    expect(
      resolvePersonaOrigin({
        userId: userA.id,
        universeId: universeA.id,
        hasExternalBinding: true,
      }),
    ).toBe("ORIGINAL");
    expect(
      resolvePersonaOrigin({
        userId: null,
        universeId: universeA.id,
        hasExternalBinding: true,
      }),
    ).toBe("REAL_DRIVER");
    expect(
      resolvePersonaOrigin({
        userId: null,
        universeId: universeA.id,
        hasExternalBinding: false,
      }),
    ).toBe("AI_CHARACTER");
    expect(
      resolvePersonaOrigin({
        userId: null,
        universeId: null,
        hasExternalBinding: false,
      }),
    ).toBeNull();
  });
});

describe("persona.service — lazy provisioning", () => {
  it("11) GET sem Persona não cria linha", async () => {
    const before = await prisma.characterPersona.count({
      where: { characterId: getCharWithoutPersona.id },
    });
    const view = await getPersonaView(userA.id, getCharWithoutPersona.id);
    expect(view.exists).toBe(false);
    const after = await prisma.characterPersona.count({
      where: { characterId: getCharWithoutPersona.id },
    });
    expect(before).toBe(0);
    expect(after).toBe(0);
  });

  it("12) ensure cria exatamente uma Persona com defaults corretos", async () => {
    const result = await ensurePersona(userA.id, ensureChar.id);
    expect(result.created).toBe(true);
    expect(result.persona.exists).toBe(true);
    expect(result.persona.origin).toBe("ORIGINAL");
    expect(result.persona.schemaVersion).toBe("persona.v1");
    expect(result.persona.summary).toBeNull();
    expect(result.persona.traits).toEqual([]);
    expect(result.persona.evidences).toEqual([]);

    const rows = await prisma.characterPersona.findMany({
      where: { characterId: ensureChar.id },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.createdById).toBe(userA.id);
    expect(rows[0]!.origin).toBe("ORIGINAL");
  });

  it("13) ensure repetido é idempotente", async () => {
    const first = await ensurePersona(userA.id, ensureChar.id);
    const second = await ensurePersona(userA.id, ensureChar.id);
    expect(second.created).toBe(false);
    expect(second.persona.id).toBe(first.persona.id);
    expect(
      await prisma.characterPersona.count({ where: { characterId: ensureChar.id } }),
    ).toBe(1);
  });

  it("14) GET após ensure retorna exists=true", async () => {
    const ensured = await ensurePersona(userA.id, ensureChar.id);
    const view = await getPersonaView(userA.id, ensureChar.id);
    expect(view.exists).toBe(true);
    expect(view.id).toBe(ensured.persona.id);
    expect(view.characterId).toBe(ensureChar.id);
  });
});

describe("persona.service — view", () => {
  it("15) traits retornados corretamente (sorting por priority)", async () => {
    const ensured = await ensurePersona(userA.id, viewChar.id);
    const personaId = ensured.persona.id!;

    await prisma.personaTrait.create({
      data: {
        personaId,
        key: "interests",
        value: "Aviação histórica",
        confidence: 0.3,
        sourceKind: "MANUAL",
      },
    });
    const evidence = await prisma.personaEvidence.create({
      data: {
        personaId,
        traitKey: "humor",
        proposedValue: "Humor seco",
        sourceType: "INTERVIEW",
        title: "Entrevista",
        url: null,
        publishedAt: new Date("2026-01-10T00:00:00.000Z"),
        excerpt: "Trecho",
        confidence: 0.9,
        status: "APPROVED",
      },
    });
    await prisma.personaTrait.create({
      data: {
        personaId,
        key: "humor",
        value: "Humor seco",
        confidence: 0.9,
        sourceKind: "EVIDENCE",
        evidenceId: evidence.id,
      },
    });
    await prisma.personaTrait.create({
      data: {
        personaId,
        key: "communicationStyle",
        value: "Direto",
        confidence: 1,
        sourceKind: "MANUAL",
      },
    });

    const view = await getPersonaView(userA.id, viewChar.id);
    expect(view.exists).toBe(true);
    expect(view.traits.map((trait) => trait.key)).toEqual([
      "communicationStyle",
      "humor",
      "interests",
    ]);
    const humor = view.traits.find((trait) => trait.key === "humor")!;
    expect(humor).toMatchObject({
      value: "Humor seco",
      confidence: 0.9,
      sourceKind: "EVIDENCE",
      evidenceId: evidence.id,
    });
    expect(view.traits.find((trait) => trait.key === "interests")).toMatchObject({
      value: "Aviação histórica",
      confidence: 0.3,
      sourceKind: "MANUAL",
      evidenceId: null,
    });
  });

  it("16) evidences retornadas com status e papel (authoritative/supporting/conflicting/pending)", async () => {
    const persona = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: viewChar.id },
    });

    const supporting = await prisma.personaEvidence.create({
      data: {
        personaId: persona.id,
        traitKey: "humor",
        proposedValue: "Humor seco",
        sourceType: "BIOGRAPHY",
        title: "Biografia",
        excerpt: "Trecho",
        confidence: 0.6,
        status: "APPROVED",
      },
    });
    const conflicting = await prisma.personaEvidence.create({
      data: {
        personaId: persona.id,
        traitKey: "humor",
        proposedValue: "Humor físico",
        sourceType: "PUBLIC_STATEMENT",
        title: "Declaração",
        excerpt: "Trecho",
        confidence: 0.8,
        status: "APPROVED",
      },
    });
    const pending = await prisma.personaEvidence.create({
      data: {
        personaId: persona.id,
        traitKey: "humor",
        proposedValue: "Humor seco",
        sourceType: "OTHER_APPROVED",
        title: "Pendente",
        excerpt: "Trecho",
        confidence: 1,
        status: "PROPOSED",
      },
    });

    const view = await getPersonaView(userA.id, viewChar.id);
    const byId = new Map(view.evidences.map((evidence) => [evidence.id, evidence]));
    expect(byId.get(supporting.id)?.role).toBe("SUPPORTING");
    expect(byId.get(conflicting.id)?.role).toBe("CONFLICTING");
    expect(byId.get(pending.id)?.role).toBeNull();
    expect(byId.get(pending.id)?.status).toBe("PROPOSED");

    const humorEvidences = view.evidences.filter(
      (evidence) => evidence.traitKey === "humor",
    );
    expect(humorEvidences[0]!.role).toBe("AUTHORITATIVE");
    expect(humorEvidences.map((evidence) => evidence.role)).toEqual([
      "AUTHORITATIVE",
      "SUPPORTING",
      "CONFLICTING",
      null,
    ]);
  });

  it("17) traits ordenados pelas rules independentemente da ordem de inserção", async () => {
    const viewA = await getPersonaView(userA.id, viewChar.id);
    const before = await prisma.personaTrait.findMany({
      where: { persona: { characterId: viewChar.id } },
      orderBy: { createdAt: "asc" },
    });
    expect(before.map((trait) => trait.key)).toEqual([
      "interests",
      "humor",
      "communicationStyle",
    ]);
    expect(viewA.traits.map((trait) => trait.key)).toEqual([
      "communicationStyle",
      "humor",
      "interests",
    ]);
  });

  it("18) view não altera banco (nenhum repair/reconcile/promoção)", async () => {
    const personaBefore = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: viewChar.id },
      include: { traits: true, evidences: true },
    });
    await getPersonaView(userA.id, viewChar.id);
    const personaAfter = await prisma.characterPersona.findUniqueOrThrow({
      where: { characterId: viewChar.id },
      include: { traits: true, evidences: true },
    });
    expect(personaAfter.updatedAt).toEqual(personaBefore.updatedAt);
    expect(personaAfter.traits).toEqual(personaBefore.traits);
    expect(personaAfter.evidences).toEqual(personaBefore.evidences);
  });

  it("19) persona vazia não é persistida por GET (shape completo)", async () => {
    const view = await getPersonaView(userA.id, getCharWithoutPersona.id);
    expect(view).toEqual({
      exists: false,
      id: null,
      characterId: getCharWithoutPersona.id,
      origin: "ORIGINAL",
      summary: null,
      schemaVersion: "persona.v1",
      traits: [],
      evidences: [],
    });
    expect(
      await prisma.characterPersona.count({
        where: { characterId: getCharWithoutPersona.id },
      }),
    ).toBe(0);
  });
});

describe("persona.service — isolation", () => {
  it("20) User A não lê Persona de B", async () => {
    await ensurePersona(userB.id, originalCharB.id);
    expect(
      await prisma.characterPersona.count({
        where: { characterId: originalCharB.id },
      }),
    ).toBe(1);
    await expect(
      getPersonaView(userA.id, originalCharB.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("21) User B não lê Persona de A", async () => {
    await expect(
      getPersonaView(userB.id, originalCharA.id),
    ).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("22) mesmo piloto real em dois Universes possui Personas independentes", async () => {
    const personaA = (await ensurePersona(userA.id, sharedPilotCharA.id)).persona;
    const personaB = (await ensurePersona(userB.id, sharedPilotCharB.id)).persona;
    expect(personaA.origin).toBe("REAL_DRIVER");
    expect(personaB.origin).toBe("REAL_DRIVER");
    expect(personaA.id).not.toBe(personaB.id);

    await prisma.characterPersona.update({
      where: { id: personaA.id! },
      data: { summary: "Reservado no Universe A" },
    });
    const reloadedB = await getPersonaView(userB.id, sharedPilotCharB.id);
    expect(reloadedB.summary).toBeNull();
    expect(reloadedB.id).toBe(personaB.id);
  });
});

describe("persona.service — concurrency", () => {
  it("23) duas criações concorrentes produzem uma Persona", async () => {
    const [first, second] = await Promise.all([
      ensurePersona(userA.id, concurrencyChar.id),
      ensurePersona(userA.id, concurrencyChar.id),
    ]);
    expect(first.persona.id).toBe(second.persona.id);
    expect([first.created, second.created].filter(Boolean)).toHaveLength(1);
  });

  it("24) não existem duas Personas para o mesmo Character", async () => {
    const rows = await prisma.characterPersona.findMany({
      where: { characterId: concurrencyChar.id },
    });
    expect(rows).toHaveLength(1);
  });

  it("25) ambas as chamadas resultam em estado válido", async () => {
    const view = await getPersonaView(userA.id, concurrencyChar.id);
    expect(view.exists).toBe(true);
    expect(view.characterId).toBe(concurrencyChar.id);
    expect(view.origin).toBe("ORIGINAL");
    expect(view.schemaVersion).toBe("persona.v1");
  });
});

describe("persona.service — regression (não altera Character/DriverProfile/binding)", () => {
  it("26) Character existente sem Persona continua consistente", async () => {
    const before = await prisma.character.findUniqueOrThrow({
      where: { id: getCharWithoutPersona.id },
    });
    await getPersonaView(userA.id, getCharWithoutPersona.id);
    const after = await prisma.character.findUniqueOrThrow({
      where: { id: getCharWithoutPersona.id },
    });
    expect(after).toEqual(before);
  });

  it("27) Character.dna não é alterado", async () => {
    await prisma.characterPersona.deleteMany({
      where: { characterId: materializedCharA.id },
    });
    await ensurePersona(userA.id, materializedCharA.id);
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: materializedCharA.id },
    });
    expect(character.dna).toEqual({ personality: "protegida" });
  });

  it("28) biography não é alterada", async () => {
    const character = await prisma.character.findUniqueOrThrow({
      where: { id: materializedCharA.id },
    });
    expect(character.biography).toBe("Biografia original");
  });

  it("29) DriverProfile não é alterado", async () => {
    const profile = await prisma.driverProfile.findUniqueOrThrow({
      where: { characterId: materializedCharA.id },
    });
    expect(profile.number).toBe(44);
  });

  it("30) external binding não é alterado", async () => {
    const binding = await prisma.externalBindingDriver.findUniqueOrThrow({
      where: { id: materializedBindingId },
    });
    expect(binding.characterId).toBe(materializedCharA.id);
    expect(binding.confidence).toBe("CONFIRMED");
    expect(binding.boundBy).toBe("ADMIN");
  });
});
