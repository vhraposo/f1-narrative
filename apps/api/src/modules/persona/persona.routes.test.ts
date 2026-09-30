import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";

const PREFIX = "persona-routes";
const EXTERNAL_SOURCE = "persona-routes-test";

let app: FastifyInstance;

const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdExternalDriverIds: string[] = [];

type TestUser = { cookie: string; userId: string };

async function createUser(label: string, role: "USER" | "ADMIN" = "USER"): Promise<TestUser> {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: `Persona ${label}`, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  if (role === "ADMIN") {
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  }
  createdUserIds.push(user.id);
  const cookie = (res.cookies ?? []).map((c) => `${c.name}=${c.value}`).join("; ");
  return { cookie, userId: user.id };
}

async function createUniverse(userId: string) {
  const universe = await prisma.universe.upsert({
    where: { userId },
    update: { status: "READY" },
    create: { userId, status: "READY" },
  });
  createdUniverseIds.push(universe.id);
  return universe;
}

async function createRawCharacter(input: {
  label: string;
  userId?: string | null;
  universeId?: string | null;
  controlledBy?: "USER" | "AI";
}) {
  const character = await prisma.character.create({
    data: {
      name: `${PREFIX}-${input.label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      nationality: "Teste",
      birthDate: new Date("1995-01-01T00:00:00.000Z"),
      userId: input.userId ?? null,
      universeId: input.universeId ?? null,
      controlledBy: input.controlledBy ?? "AI",
    },
  });
  createdCharacterIds.push(character.id);
  return character;
}

async function seedPersona(characterId: string, origin: "ORIGINAL" | "REAL_DRIVER" | "AI_CHARACTER", createdById: string | null = null) {
  return prisma.characterPersona.create({
    data: { characterId, origin, schemaVersion: "persona.v1", createdById },
  });
}

async function seedApprovedEvidence(
  personaId: string,
  overrides: Partial<{ traitKey: string; proposedValue: string; confidence: number }> = {},
) {
  return prisma.personaEvidence.create({
    data: {
      personaId,
      traitKey: overrides.traitKey ?? "humor",
      proposedValue: overrides.proposedValue ?? "Proposto",
      sourceType: "INTERVIEW",
      title: "Fonte",
      url: null,
      publishedAt: null,
      excerpt: "Trecho",
      confidence: overrides.confidence ?? 0.8,
      status: "APPROVED",
    },
  });
}

async function getPersona(cookie: string, characterId: string) {
  return app.inject({
    method: "GET",
    url: `/api/characters/${characterId}/persona`,
    headers: { cookie },
  });
}

async function patchPersona(
  cookie: string,
  characterId: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "PATCH",
    url: `/api/characters/${characterId}/persona`,
    headers: { cookie },
    payload,
  });
}

async function deleteTrait(cookie: string, characterId: string, traitKey: string) {
  return app.inject({
    method: "DELETE",
    url: `/api/characters/${characterId}/persona/traits/${traitKey}`,
    headers: { cookie },
  });
}

function evidenceBody(overrides: Record<string, unknown> = {}) {
  return {
    traitKey: "humor",
    proposedValue: "Sarcástico",
    sourceType: "INTERVIEW",
    title: "Entrevista",
    url: "https://example.com/fonte",
    publishedAt: "2026-01-15T00:00:00.000Z",
    excerpt: "Trecho da entrevista.",
    confidence: 0.7,
    ...overrides,
  };
}

async function postEvidence(
  cookie: string,
  characterId: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "POST",
    url: `/api/characters/${characterId}/persona/evidence`,
    headers: { cookie },
    payload,
  });
}

async function reviewEvidence(
  cookie: string,
  evidenceId: string,
  payload: Record<string, unknown>,
) {
  return app.inject({
    method: "PATCH",
    url: `/api/persona-evidence/${evidenceId}`,
    headers: { cookie },
    payload,
  });
}

let userA: TestUser;
let userB: TestUser;
let admin: TestUser;
let universeA: { id: string };
let universeB: { id: string };

let freshChar: { id: string };
let existingChar: { id: string };
let lazyChar: { id: string };
let validationChar: { id: string };
let convertChar: { id: string };
let deleteChar: { id: string };
let deleteNoPersonaChar: { id: string };
let evidenceChar: { id: string };
let reviewChar: { id: string };
let manualWinChar: { id: string };
let isolationCharA: { id: string };
let isolationCharB: { id: string };
let charB: { id: string };
let materializedChar: { id: string };
let globalChar: { id: string };

beforeAll(async () => {
  app = buildApp();
  await app.ready();

  userA = await createUser("user-a");
  userB = await createUser("user-b");
  admin = await createUser("admin", "ADMIN");
  universeA = await createUniverse(userA.userId);
  universeB = await createUniverse(userB.userId);

  freshChar = await createRawCharacter({ label: "fresh", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  existingChar = await createRawCharacter({ label: "existing", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  lazyChar = await createRawCharacter({ label: "lazy", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  validationChar = await createRawCharacter({ label: "validation", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  convertChar = await createRawCharacter({ label: "convert", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  deleteChar = await createRawCharacter({ label: "delete", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  deleteNoPersonaChar = await createRawCharacter({ label: "delete-sem-persona", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  evidenceChar = await createRawCharacter({ label: "evidence", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  reviewChar = await createRawCharacter({ label: "review", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  manualWinChar = await createRawCharacter({ label: "manual-win", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  isolationCharA = await createRawCharacter({ label: "isolation-a", userId: userA.userId, universeId: universeA.id, controlledBy: "USER" });
  isolationCharB = await createRawCharacter({ label: "isolation-b", userId: userB.userId, universeId: universeB.id, controlledBy: "USER" });

  charB = await createRawCharacter({ label: "char-b", userId: userB.userId, universeId: universeB.id, controlledBy: "USER" });

  materializedChar = await createRawCharacter({ label: "materializado", userId: null, universeId: universeA.id, controlledBy: "AI" });
  const externalDriver = await prisma.externalDriver.create({
    data: {
      source: EXTERNAL_SOURCE,
      externalId: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Externo",
      contentHash: "hash",
    },
  });
  createdExternalDriverIds.push(externalDriver.id);
  await prisma.externalBindingDriver.create({
    data: {
      universeId: universeA.id,
      externalDriverId: externalDriver.id,
      characterId: materializedChar.id,
      confidence: "CONFIRMED",
      boundBy: "ADMIN",
    },
  });

  globalChar = await createRawCharacter({ label: "catalogo-global", userId: null, universeId: null, controlledBy: "AI" });
});

afterAll(async () => {
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.externalDriver.deleteMany({ where: { id: { in: createdExternalDriverIds } } });
  await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await prisma.$disconnect();
  await app.close();
});

describe("persona.routes — auth", () => {
  it("1) GET sem auth -> 401", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/characters/${randomUUID()}/persona`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("2) PATCH sem auth -> 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/characters/${randomUUID()}/persona`,
      payload: { summary: "x" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("3) DELETE sem auth -> 401", async () => {
    const res = await app.inject({
      method: "DELETE",
      url: `/api/characters/${randomUUID()}/persona/traits/humor`,
    });
    expect(res.statusCode).toBe(401);
  });

  it("4) POST evidence sem auth -> 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/characters/${randomUUID()}/persona/evidence`,
      payload: evidenceBody(),
    });
    expect(res.statusCode).toBe(401);
  });

  it("5) review sem auth -> 401", async () => {
    const res = await app.inject({
      method: "PATCH",
      url: `/api/persona-evidence/${randomUUID()}`,
      payload: { status: "APPROVED" },
    });
    expect(res.statusCode).toBe(401);
  });
});

describe("persona.routes — GET", () => {
  it("6) persona inexistente -> 200 exists=false", async () => {
    const res = await getPersona(userA.cookie, freshChar.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().persona).toMatchObject({
      exists: false,
      id: null,
      characterId: freshChar.id,
      origin: "ORIGINAL",
      summary: null,
      schemaVersion: "persona.v1",
      traits: [],
      evidences: [],
    });
  });

  it("7) persona existente -> 200", async () => {
    await patchPersona(userA.cookie, existingChar.id, { summary: "Existente" });
    const res = await getPersona(userA.cookie, existingChar.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().persona.exists).toBe(true);
    expect(res.json().persona.summary).toBe("Existente");
  });

  it("8) terceiro -> 404", async () => {
    const res = await getPersona(userA.cookie, charB.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("9) outro Universe -> 404", async () => {
    const res = await getPersona(userB.cookie, materializedChar.id);
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("10) AI catalog -> 200 view vazia", async () => {
    const res = await getPersona(userA.cookie, globalChar.id);
    expect(res.statusCode).toBe(200);
    expect(res.json().persona).toMatchObject({
      exists: false,
      origin: null,
      traits: [],
      evidences: [],
    });
  });

  it("11) GET não cria Persona", async () => {
    await getPersona(userA.cookie, freshChar.id);
    expect(
      await prisma.characterPersona.count({ where: { characterId: freshChar.id } }),
    ).toBe(0);
  });
});

describe("persona.routes — PATCH", () => {
  it("12) cria Persona lazy", async () => {
    const res = await patchPersona(userA.cookie, lazyChar.id, { summary: "Lazy" });
    expect(res.statusCode).toBe(200);
    expect(res.json().persona.exists).toBe(true);
    expect(
      await prisma.characterPersona.count({ where: { characterId: lazyChar.id } }),
    ).toBe(1);
  });

  it("13) cria trait manual", async () => {
    const res = await patchPersona(userA.cookie, lazyChar.id, {
      traits: [{ key: "humor", value: "Seco" }],
    });
    expect(res.statusCode).toBe(200);
    const trait = res.json().persona.traits.find((item: { key: string }) => item.key === "humor");
    expect(trait).toMatchObject({
      value: "Seco",
      sourceKind: "MANUAL",
      confidence: 1,
      evidenceId: null,
    });
  });

  it("14) atualiza trait", async () => {
    const res = await patchPersona(userA.cookie, lazyChar.id, {
      traits: [{ key: "humor", value: "Ácido" }],
    });
    const trait = res.json().persona.traits.find((item: { key: string }) => item.key === "humor");
    expect(trait.value).toBe("Ácido");
  });

  it("15) atualiza summary", async () => {
    const res = await patchPersona(userA.cookie, lazyChar.id, { summary: "Novo summary" });
    expect(res.json().persona.summary).toBe("Novo summary");
  });

  it("16) summary null limpa", async () => {
    const res = await patchPersona(userA.cookie, lazyChar.id, { summary: null });
    expect(res.json().persona.summary).toBeNull();
  });

  it("17) traits omitidos permanecem", async () => {
    await patchPersona(userA.cookie, lazyChar.id, {
      traits: [{ key: "interests", value: "Astronomia" }],
    });
    const res = await getPersona(userA.cookie, lazyChar.id);
    const keys = res.json().persona.traits.map((item: { key: string }) => item.key);
    expect(keys).toContain("humor");
    expect(keys).toContain("interests");
  });

  it("18) duplicate keys -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      traits: [
        { key: "humor", value: "A" },
        { key: "humor", value: "B" },
      ],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("19) sourceKind enviado -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      traits: [{ key: "humor", value: "A", sourceKind: "MANUAL" }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("20) confidence enviado -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      traits: [{ key: "humor", value: "A", confidence: 1 }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("21) evidenceId enviado -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      traits: [{ key: "humor", value: "A", evidenceId: randomUUID() }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("22) origin enviado -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      origin: "REAL_DRIVER",
    });
    expect(res.statusCode).toBe(400);
  });

  it("23) unknown field -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      summary: "ok",
      schemaVersion: "persona.v2",
    });
    expect(res.statusCode).toBe(400);
  });

  it("24) key inválido -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      traits: [{ key: "charisma", value: "A" }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("25) value > 200 -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      traits: [{ key: "humor", value: "x".repeat(201) }],
    });
    expect(res.statusCode).toBe(400);
  });

  it("26) summary > 2000 -> 400", async () => {
    const res = await patchPersona(userA.cookie, validationChar.id, {
      summary: "x".repeat(2001),
    });
    expect(res.statusCode).toBe(400);
  });

  it("27) EVIDENCE vira MANUAL", async () => {
    const persona = await seedPersona(convertChar.id, "ORIGINAL", userA.userId);
    const evidence = await seedApprovedEvidence(persona.id, {
      proposedValue: "Da fonte",
      confidence: 0.9,
    });
    await prisma.personaTrait.create({
      data: {
        personaId: persona.id,
        key: "humor",
        value: "Da fonte",
        confidence: 0.9,
        sourceKind: "EVIDENCE",
        evidenceId: evidence.id,
      },
    });
    const res = await patchPersona(userA.cookie, convertChar.id, {
      traits: [{ key: "humor", value: "Manual" }],
    });
    expect(res.statusCode).toBe(200);
    expect(
      res.json().persona.traits.find((item: { key: string }) => item.key === "humor"),
    ).toMatchObject({
      value: "Manual",
      sourceKind: "MANUAL",
      confidence: 1,
      evidenceId: null,
    });
  });

  it("28) evidence permanece intacta", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: convertChar.id } },
    });
    expect(evidence.status).toBe("APPROVED");
    expect(evidence.proposedValue).toBe("Da fonte");
  });

  it("29) terceiro -> 404", async () => {
    const res = await patchPersona(userA.cookie, charB.id, { summary: "Invasão" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
  });

  it("30) catálogo global -> 403", async () => {
    const res = await patchPersona(userA.cookie, globalChar.id, {
      traits: [{ key: "humor", value: "Global" }],
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});

describe("persona.routes — DELETE", () => {
  it("31) remove trait", async () => {
    const persona = await seedPersona(deleteChar.id, "ORIGINAL", userA.userId);
    await prisma.personaTrait.create({
      data: { personaId: persona.id, key: "humor", value: "Manual", confidence: 1, sourceKind: "MANUAL" },
    });
    const evidence = await seedApprovedEvidence(persona.id, {
      traitKey: "interests",
      proposedValue: "Astronomia",
    });
    await prisma.personaTrait.create({
      data: {
        personaId: persona.id,
        key: "interests",
        value: "Astronomia",
        confidence: 0.8,
        sourceKind: "EVIDENCE",
        evidenceId: evidence.id,
      },
    });
    const res = await deleteTrait(userA.cookie, deleteChar.id, "humor");
    expect(res.statusCode).toBe(200);
    expect(
      res.json().persona.traits.map((item: { key: string }) => item.key),
    ).not.toContain("humor");
  });

  it("32) evidence permanece", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: deleteChar.id } },
    });
    expect(evidence.status).toBe("APPROVED");
  });

  it("33) inexistente -> erro esperado", async () => {
    const res = await deleteTrait(userA.cookie, deleteChar.id, "speechStyle");
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("TRAIT_NOT_FOUND");
  });

  it("34) não cria Persona", async () => {
    const res = await deleteTrait(userA.cookie, deleteNoPersonaChar.id, "humor");
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("NOT_FOUND");
    expect(
      await prisma.characterPersona.count({
        where: { characterId: deleteNoPersonaChar.id },
      }),
    ).toBe(0);
  });

  it("35) terceiro -> 404", async () => {
    const res = await deleteTrait(userA.cookie, charB.id, "humor");
    expect(res.statusCode).toBe(404);
  });

  it("36) catálogo global -> 403", async () => {
    const res = await deleteTrait(userA.cookie, globalChar.id, "humor");
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});

describe("persona.routes — create evidence", () => {
  it("37) cria PROPOSED", async () => {
    const res = await postEvidence(userA.cookie, evidenceChar.id, evidenceBody());
    expect(res.statusCode).toBe(201);
    const evidence = res.json().persona.evidences.find(
      (item: { traitKey: string }) => item.traitKey === "humor",
    );
    expect(evidence).toMatchObject({
      status: "PROPOSED",
      proposedValue: "Sarcástico",
      confidence: 0.7,
    });
  });

  it("38) createdById correto", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: evidenceChar.id }, traitKey: "humor" },
    });
    expect(evidence.createdById).toBe(userA.userId);
    expect(evidence.reviewedById).toBeNull();
    expect(evidence.reviewedAt).toBeNull();
  });

  it("39) status não pode ser enviado", async () => {
    const res = await postEvidence(userA.cookie, validationChar.id, {
      ...evidenceBody(),
      status: "APPROVED",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("VALIDATION_ERROR");
  });

  it("40) reviewed fields não podem ser enviados", async () => {
    const res = await postEvidence(userA.cookie, validationChar.id, {
      ...evidenceBody(),
      reviewedById: randomUUID(),
      reviewedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(res.statusCode).toBe(400);
  });

  it("41) trait/evidence values inválidos -> 400", async () => {
    const res = await postEvidence(userA.cookie, validationChar.id, {
      ...evidenceBody(),
      traitKey: "charisma",
    });
    expect(res.statusCode).toBe(400);
    expect(
      await prisma.characterPersona.count({ where: { characterId: validationChar.id } }),
    ).toBe(0);
  });

  it("42) terceiro -> 404", async () => {
    const res = await postEvidence(userA.cookie, charB.id, evidenceBody());
    expect(res.statusCode).toBe(404);
  });

  it("43) catálogo global -> 403", async () => {
    const res = await postEvidence(userA.cookie, globalChar.id, evidenceBody());
    expect(res.statusCode).toBe(403);
  });

  it("44) response contém evidence id", async () => {
    const res = await postEvidence(userA.cookie, evidenceChar.id, evidenceBody({ traitKey: "interests", proposedValue: "Música" }));
    expect(res.statusCode).toBe(201);
    const evidence = res.json().persona.evidences.find(
      (item: { traitKey: string }) => item.traitKey === "interests",
    );
    expect(typeof evidence.id).toBe("string");
    expect(evidence.id.length).toBeGreaterThan(0);
  });
});

describe("persona.routes — review", () => {
  it("45) USER -> 403", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: evidenceChar.id }, traitKey: "humor" },
    });
    const res = await reviewEvidence(userB.cookie, evidence.id, { status: "APPROVED" });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("46) ADMIN APPROVED", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: evidenceChar.id }, traitKey: "humor" },
    });
    const res = await reviewEvidence(admin.cookie, evidence.id, { status: "APPROVED" });
    expect(res.statusCode).toBe(200);
    expect(
      res.json().persona.traits.find((item: { key: string }) => item.key === "humor"),
    ).toMatchObject({ sourceKind: "EVIDENCE", evidenceId: evidence.id });
  });

  it("47) ADMIN REJECTED", async () => {
    const created = await postEvidence(userA.cookie, reviewChar.id, evidenceBody({ traitKey: "speechStyle", proposedValue: "Direto" }));
    const evidenceId = created.json().persona.evidences.find(
      (item: { traitKey: string }) => item.traitKey === "speechStyle",
    ).id;
    const res = await reviewEvidence(admin.cookie, evidenceId, { status: "REJECTED" });
    expect(res.statusCode).toBe(200);
    expect(
      res.json().persona.evidences.find((item: { id: string }) => item.id === evidenceId).status,
    ).toBe("REJECTED");
  });

  it("48) confidence override", async () => {
    const created = await postEvidence(userA.cookie, reviewChar.id, evidenceBody({ traitKey: "interests", proposedValue: "Cinema", confidence: 0.5 }));
    const evidenceId = created.json().persona.evidences.find(
      (item: { traitKey: string }) => item.traitKey === "interests",
    ).id;
    const res = await reviewEvidence(admin.cookie, evidenceId, {
      status: "APPROVED",
      confidence: 0.95,
    });
    expect(res.statusCode).toBe(200);
    const stored = await prisma.personaEvidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(stored.confidence).toBe(0.95);
    expect(
      res.json().persona.traits.find((item: { key: string }) => item.key === "interests").confidence,
    ).toBe(0.95);
  });

  it("49) sem confidence preserva", async () => {
    const created = await postEvidence(userA.cookie, reviewChar.id, evidenceBody({ traitKey: "confidence", proposedValue: "Seguro", confidence: 0.4 }));
    const evidenceId = created.json().persona.evidences.find(
      (item: { traitKey: string }) => item.traitKey === "confidence",
    ).id;
    const res = await reviewEvidence(admin.cookie, evidenceId, { status: "APPROVED" });
    expect(res.statusCode).toBe(200);
    const stored = await prisma.personaEvidence.findUniqueOrThrow({ where: { id: evidenceId } });
    expect(stored.confidence).toBe(0.4);
  });

  it("50) invalid transition -> 409", async () => {
    const evidence = await prisma.personaEvidence.findFirstOrThrow({
      where: { persona: { characterId: evidenceChar.id }, traitKey: "humor" },
    });
    const res = await reviewEvidence(admin.cookie, evidence.id, { status: "APPROVED" });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("INVALID_TRANSITION");
  });

  it("51) evidence desaparecida -> 404", async () => {
    const res = await reviewEvidence(admin.cookie, randomUUID(), { status: "APPROVED" });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("EVIDENCE_NOT_FOUND");
  });

  it("52) response reflete reconcile", async () => {
    const res = await getPersona(userA.cookie, evidenceChar.id);
    const trait = res.json().persona.traits.find((item: { key: string }) => item.key === "humor");
    expect(trait).toMatchObject({ sourceKind: "EVIDENCE", value: "Sarcástico", confidence: 0.7 });
  });

  it("53) MANUAL continua vencendo", async () => {
    await patchPersona(userA.cookie, manualWinChar.id, {
      traits: [{ key: "humor", value: "Manual" }],
    });
    const created = await postEvidence(userA.cookie, manualWinChar.id, evidenceBody({ proposedValue: "Da fonte" }));
    const evidenceId = created.json().persona.evidences.find(
      (item: { traitKey: string }) => item.traitKey === "humor",
    ).id;
    const res = await reviewEvidence(admin.cookie, evidenceId, { status: "APPROVED" });
    expect(res.statusCode).toBe(200);
    expect(
      res.json().persona.traits.find((item: { key: string }) => item.key === "humor"),
    ).toMatchObject({ sourceKind: "MANUAL", value: "Manual", evidenceId: null });
  });
});

describe("persona.routes — isolation", () => {
  it("54) A não lê B", async () => {
    const res = await getPersona(userA.cookie, charB.id);
    expect(res.statusCode).toBe(404);
  });

  it("55) A não altera B", async () => {
    const res = await patchPersona(userA.cookie, charB.id, {
      traits: [{ key: "humor", value: "Invasão" }],
    });
    expect(res.statusCode).toBe(404);
    expect(
      await prisma.characterPersona.count({ where: { characterId: charB.id } }),
    ).toBe(0);
  });

  it("56) mesmo trait em Universes diferentes permanece isolado", async () => {
    await patchPersona(userA.cookie, isolationCharA.id, {
      traits: [{ key: "humor", value: "Valor A" }],
    });
    await patchPersona(userB.cookie, isolationCharB.id, {
      traits: [{ key: "humor", value: "Valor B" }],
    });
    const viewA = await getPersona(userA.cookie, isolationCharA.id);
    const viewB = await getPersona(userB.cookie, isolationCharB.id);
    expect(
      viewA.json().persona.traits.find((item: { key: string }) => item.key === "humor").value,
    ).toBe("Valor A");
    expect(
      viewB.json().persona.traits.find((item: { key: string }) => item.key === "humor").value,
    ).toBe("Valor B");
  });
});

describe("persona.routes — error contract", () => {
  it("57) Prisma/raw errors não vazam", async () => {
    const res = await postEvidence(userA.cookie, validationChar.id, {
      ...evidenceBody(),
      confidence: 2,
    });
    expect(res.statusCode).toBe(400);
    const body = res.body;
    expect(body).not.toContain("Prisma");
    expect(body).not.toContain("meta");
    expect(body).not.toContain("stack");
  });

  it("58) stack trace não vaza", async () => {
    const res = await getPersona(userA.cookie, charB.id);
    expect(res.statusCode).toBe(404);
    expect(res.json()).not.toHaveProperty("stack");
    expect(res.body).not.toContain("at ");
  });

  it("59) SQL não vaza", async () => {
    const res = await reviewEvidence(admin.cookie, randomUUID(), { status: "APPROVED" });
    expect(res.statusCode).toBe(404);
    expect(res.body.toUpperCase()).not.toContain("SELECT");
    expect(res.body).not.toContain("CharacterPersona");
  });

  it("60) smoke: characters continua respondendo", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/characters",
      headers: { cookie: userA.cookie },
    });
    expect(res.statusCode).toBe(200);
  });
});
