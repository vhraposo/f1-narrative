import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import { deleteUniverseDataForUsers } from "../../test-utils/universe-cleanup.js";
import type {
  DriverIdentityQuery,
  ExternalDriverKnowledgeProvider,
  ProviderCareerData,
  ProviderIdentityCandidate,
  ProviderProfileResult,
  ProviderRelationship,
  ProviderSourceReference,
} from "./providers/provider.types.js";

const PREFIX = "pk-routes";

let app: FastifyInstance;

const createdUserIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdDriverIds: string[] = [];

type TestUser = { cookie: string; userId: string };

function remoteAddress(): string {
  return `10.0.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
}

async function createUser(label: string, role: "USER" | "ADMIN" = "USER"): Promise<TestUser> {
  const email = `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`;
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name: `PK ${label}`, email, password: "senha-segura-123" },
    remoteAddress: remoteAddress(),
  });
  expect(res.statusCode).toBe(200);
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  if (role === "ADMIN") {
    await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
  }
  createdUserIds.push(user.id);
  const cookie = (res.cookies ?? []).map((entry) => `${entry.name}=${entry.value}`).join("; ");
  return { cookie, userId: user.id };
}

async function createPilotFixture(user: TestUser, label: string, options?: { readonly withDriverProfile?: boolean }) {
  const universe = await prisma.universe.upsert({
    where: { userId: user.userId },
    update: { status: "READY" },
    create: { userId: user.userId, status: "READY" },
  });
  const driver = await prisma.externalDriver.create({
    data: {
      source: "f1db",
      externalId: `${PREFIX}-${label}-${randomUUID().slice(0, 8)}`,
      name: `PK ${label}`,
      nationality: "NED",
      number: 33,
      contentHash: `hash-${label}`,
    },
  });
  createdDriverIds.push(driver.id);
  const character = await prisma.character.create({
    data: {
      universeId: universe.id,
      controlledBy: "AI",
      name: `PK ${label}`,
      nationality: "NED",
      birthDate: new Date("1997-09-30T00:00:00.000Z"),
      driverProfile: options?.withDriverProfile === false ? undefined : { create: { number: 33 } },
    },
  });
  createdCharacterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId: universe.id, externalDriverId: driver.id, characterId: character.id },
  });
  return { universe, driver, character };
}

function stubProvider(): ExternalDriverKnowledgeProvider {
  return {
    source: "F1DB",
    async resolveDriverIdentity(query: DriverIdentityQuery): Promise<ProviderIdentityCandidate[]> {
      return [
        {
          externalId: query.externalId ?? `${PREFIX}-unknown`,
          name: query.name,
          fullName: `Full ${query.name}`,
          nationality: "NED",
          number: 33,
          dateOfBirth: new Date("1997-09-30T00:00:00.000Z"),
          f1dbDriverId: query.externalId ?? null,
        },
      ];
    },
    async fetchStructuredProfile(candidate: ProviderIdentityCandidate): Promise<ProviderProfileResult> {
      const dateOfBirth = new Date("1997-09-30T00:00:00.000Z");
      return {
        profile: {
          fullName: `Full ${candidate.name}`,
          publicName: candidate.name,
          dateOfBirth,
          placeOfBirth: "Hasselt",
          nationality: "Países Baixos",
          representedCountry: "Países Baixos",
          driverNumber: 33,
          driverCode: "PKR",
          currentTeamName: "Equipe Provider",
          officialLinks: null,
          biographyFacts: {
            publicName: candidate.name,
            dateOfBirth,
            placeOfBirth: "Hasselt",
            nationality: "Países Baixos",
          },
        },
        source: {
          provider: "F1DB",
          sourceKind: "STRUCTURED_RELEASE",
          url: `https://f1db.example/${candidate.externalId}`,
          title: "F1DB release fixture",
          license: "CC_BY_4_0",
          attributionRequirement: "Obrigatória",
          attributionText: "F1DB — CC BY 4.0",
          sourceVersion: "fixture.1",
        },
      };
    },
    async fetchRelationships(candidate: ProviderIdentityCandidate): Promise<ProviderRelationship[]> {
      void candidate;
      return [
        {
          kind: "SPOUSE",
          targetType: "PUBLIC_PERSON",
          displayName: "Pessoa Provider",
          state: "ACTIVE",
          validFrom: new Date("2020-01-01T00:00:00.000Z"),
          targetWikidataQid: "Q900",
        },
      ];
    },
    async fetchCareerData(candidate: ProviderIdentityCandidate): Promise<ProviderCareerData> {
      void candidate;
      return { seasons: [], championships: [] };
    },
    async fetchSourceReferences(candidate: ProviderIdentityCandidate): Promise<ProviderSourceReference[]> {
      void candidate;
      return [];
    },
  };
}

let providerApp: FastifyInstance;

beforeAll(async () => {
  app = buildApp();
  providerApp = buildApp(undefined, undefined, undefined, undefined, undefined, undefined, {
    providers: [stubProvider()],
  });
  await app.ready();
  await providerApp.ready();
});

afterAll(async () => {
  await prisma.externalSyncRun.deleteMany({ where: { triggeredById: { in: createdUserIds } } });
  await deleteKnowledgeSourcesForDrivers(prisma, createdDriverIds);
  if (createdDriverIds.length > 0) {
    await prisma.externalResult.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalStanding.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalDriverSeason.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalDriverEvent.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalDriverRelationship.deleteMany({ where: { externalDriverId: { in: createdDriverIds } } });
    await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  }
  await deleteUniverseDataForUsers(prisma, createdUserIds);
  await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  await prisma.universe.deleteMany({ where: { userId: { in: createdUserIds } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await app.close();
  await providerApp.close();
  await prisma.$disconnect();
});

describe("pilot knowledge routes", () => {
  it("1) exige autenticação e ownership (leak-safe 404)", async () => {
    const owner = await createUser("owner-1");
    const intruder = await createUser("intruder-1");
    const { character } = await createPilotFixture(owner, "own1");

    const anonymous = await app.inject({
      method: "GET",
      url: `/api/pilot-knowledge/drivers/${character.id}`,
      remoteAddress: remoteAddress(),
    });
    expect(anonymous.statusCode).toBe(401);

    const other = await app.inject({
      method: "GET",
      url: `/api/pilot-knowledge/drivers/${character.id}`,
      headers: { cookie: intruder.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(other.statusCode).toBe(404);

    const invalid = await app.inject({
      method: "GET",
      url: "/api/pilot-knowledge/drivers/not-a-uuid",
      headers: { cookie: owner.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("2) GET agrega perfil, persona, histórico, relacionamentos e sources com licença", async () => {
    const owner = await createUser("owner-2", "ADMIN");
    const { character, driver } = await createPilotFixture(owner, "own2");

    const refresh = await providerApp.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/refresh`,
      headers: { cookie: owner.cookie },
      payload: { scope: "ALL" },
      remoteAddress: remoteAddress(),
    });
    expect(refresh.statusCode).toBe(200);
    const refreshBody = refresh.json() as { refresh: { scopes: Array<{ scope: string; status: string }> } };
    expect(refreshBody.refresh.scopes.map((scope) => scope.scope).sort()).toEqual([
      "DRIVER_EVENTS",
      "DRIVER_PROFILE",
      "DRIVER_RELATIONSHIPS",
    ]);
    expect(refreshBody.refresh.scopes.every((scope) => scope.status === "SUCCESS")).toBe(true);

    await providerApp.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/refresh`,
      headers: { cookie: owner.cookie },
      payload: { scope: "DRIVER_PROFILE" },
      remoteAddress: remoteAddress(),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/pilot-knowledge/drivers/${character.id}`,
      headers: { cookie: owner.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      pilot: {
        available: boolean;
        profile: { identity: { publicName: string; driverNumber: number | null } };
        relationships: { entries: Array<{ kind: string; externalCurrent: { displayName: string } | null }> };
        sources: Array<{ provider: string; license: string; attributionText: string | null }>;
      };
    };
    expect(body.pilot.available).toBe(true);
    expect(body.pilot.profile.identity.publicName).toBe("PK own2");
    expect(body.pilot.profile.identity.driverNumber).toBe(33);
    const spouse = body.pilot.relationships.entries.find((entry) => entry.kind === "SPOUSE");
    expect(spouse?.externalCurrent?.displayName).toBe("Pessoa Provider");
    expect(body.pilot.sources.some((source) => source.provider === "F1DB" && source.license === "CC_BY_4_0")).toBe(true);
    expect(body.pilot.sources.some((source) => source.attributionText?.includes("CC BY 4.0"))).toBe(true);
    void driver;
  });

  it("3) refresh não toca o Universe nem o External Mirror", async () => {
    const owner = await createUser("owner-3", "ADMIN");
    const { character, driver } = await createPilotFixture(owner, "own3");
    const before = await prisma.externalDriver.findUniqueOrThrow({ where: { id: driver.id } });

    const refresh = await providerApp.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/refresh`,
      headers: { cookie: owner.cookie },
      payload: { scope: "DRIVER_PROFILE" },
      remoteAddress: remoteAddress(),
    });
    expect(refresh.statusCode).toBe(200);

    const after = await prisma.externalDriver.findUniqueOrThrow({ where: { id: driver.id } });
    expect(after.source).toBe(before.source);
    expect(after.name).toBe(before.name);
    expect(after.contentHash).toBe(before.contentHash);
    const universeCharacter = await prisma.character.findUniqueOrThrow({ where: { id: character.id } });
    expect(universeCharacter.biography).toBeNull();
    const personaCount = await prisma.characterPersona.count({ where: { characterId: character.id } });
    expect(personaCount).toBe(0);
    const runs = await prisma.externalSyncRun.findMany({
      where: { triggeredById: owner.userId, scope: "DRIVER_PROFILE" },
    });
    expect(runs[0]?.status).toBe("SUCCESS");
  });

  it("4) refresh sem providers configurados responde 503", async () => {
    const admin = await createUser("admin-4", "ADMIN");
    const { character } = await createPilotFixture(admin, "own4");
    const response = await app.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/refresh`,
      headers: { cookie: admin.cookie },
      payload: { scope: "ALL" },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(503);
    expect((response.json() as { code: string }).code).toBe("PROVIDERS_UNAVAILABLE");
  });

  it("5) refresh exige ADMIN e valida escopo", async () => {
    const owner = await createUser("owner-5");
    const { character } = await createPilotFixture(owner, "own5");
    const forbidden = await providerApp.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/refresh`,
      headers: { cookie: owner.cookie },
      payload: { scope: "ALL" },
      remoteAddress: remoteAddress(),
    });
    expect(forbidden.statusCode).toBe(403);

    const admin = await createUser("admin-5", "ADMIN");
    const adminFixture = await createPilotFixture(admin, "own5b");
    const invalid = await providerApp.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${adminFixture.character.id}/refresh`,
      headers: { cookie: admin.cookie },
      payload: { scope: "NOPE" },
      remoteAddress: remoteAddress(),
    });
    expect(invalid.statusCode).toBe(400);
  });

  it("6) status é ADMIN-only e reporta contagens", async () => {
    const admin = await createUser("admin-6", "ADMIN");
    const owner = await createUser("owner-6");
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/pilot-knowledge/status",
      headers: { cookie: owner.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(forbidden.statusCode).toBe(403);

    const response = await app.inject({
      method: "GET",
      url: "/api/pilot-knowledge/status",
      headers: { cookie: admin.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      status: { profiles: { total: number }; personas: { total: number }; lastRuns: unknown[] };
    };
    expect(typeof body.status.profiles.total).toBe("number");
    expect(typeof body.status.personas.total).toBe("number");
    expect(Array.isArray(body.status.lastRuns)).toBe(true);
  });

  it("7) CRUD de override de relacionamento com ownership", async () => {
    const owner = await createUser("owner-7");
    const intruder = await createUser("intruder-7");
    const { character } = await createPilotFixture(owner, "own7");

    const created = await app.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/relationships`,
      headers: { cookie: owner.cookie },
      payload: {
        kind: "ROMANTIC_PARTNER",
        targetType: "PUBLIC_PERSON",
        displayName: "Pessoa do Universe",
        state: "ACTIVE",
        validFrom: "2025-01-01T00:00:00.000Z",
      },
      remoteAddress: remoteAddress(),
    });
    expect(created.statusCode).toBe(201);
    const relationshipId = (created.json() as { relationship: { id: string } }).relationship.id;

    const forbiddenPatch = await app.inject({
      method: "PATCH",
      url: `/api/pilot-knowledge/relationships/${relationshipId}`,
      headers: { cookie: intruder.cookie },
      payload: { displayName: "Hack" },
      remoteAddress: remoteAddress(),
    });
    expect(forbiddenPatch.statusCode).toBe(404);

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/pilot-knowledge/relationships/${relationshipId}`,
      headers: { cookie: owner.cookie },
      payload: { displayName: "Pessoa Atualizada" },
      remoteAddress: remoteAddress(),
    });
    expect(patched.statusCode).toBe(200);

    const invalid = await app.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/relationships`,
      headers: { cookie: owner.cookie },
      payload: { kind: "SPOUSE", targetType: "PUBLIC_PERSON", displayName: "" },
      remoteAddress: remoteAddress(),
    });
    expect(invalid.statusCode).toBe(400);

    const deleted = await app.inject({
      method: "DELETE",
      url: `/api/pilot-knowledge/relationships/${relationshipId}`,
      headers: { cookie: owner.cookie },
      remoteAddress: remoteAddress(),
    });
    expect(deleted.statusCode).toBe(204);
  });

  it("8) refresh de piloto sem binding externo responde 404", async () => {
    const admin = await createUser("admin-8", "ADMIN");
    const universe = await prisma.universe.upsert({
      where: { userId: admin.userId },
      update: { status: "READY" },
      create: { userId: admin.userId, status: "READY" },
    });
    const character = await prisma.character.create({
      data: {
        universeId: universe.id,
        controlledBy: "AI",
        name: "Sem Binding PK",
        nationality: "BRA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
        driverProfile: { create: {} },
      },
    });
    createdCharacterIds.push(character.id);

    const response = await providerApp.inject({
      method: "POST",
      url: `/api/pilot-knowledge/drivers/${character.id}/refresh`,
      headers: { cookie: admin.cookie },
      payload: { scope: "ALL" },
      remoteAddress: remoteAddress(),
    });
    expect(response.statusCode).toBe(404);
  });
});
