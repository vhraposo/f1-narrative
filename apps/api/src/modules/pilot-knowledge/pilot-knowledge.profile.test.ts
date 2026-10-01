import type { Prisma } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";

import { prisma } from "../../infrastructure/database/prisma.js";
import { deleteKnowledgeSourcesForDrivers } from "../../test-utils/pilot-knowledge-cleanup.js";
import {
  PilotKnowledgeError,
  resolvePilotKnowledgeAccess,
  withPilotKnowledgeAvailability,
} from "./pilot-knowledge.access.js";
import {
  composeBiographyContext,
  composeBiographyDisplay,
  formatBirthDate,
  getDriverProfileView,
  markDriverProfileStale,
  upsertDriverProfileFromProvider,
} from "./pilot-knowledge.profile.js";
import { recordKnowledgeSource } from "./pilot-knowledge.sources.js";

const PREFIX = "pk-prof";
const createdUserIds: string[] = [];
const createdUniverseIds: string[] = [];
const createdCharacterIds: string[] = [];
const createdDriverIds: string[] = [];
const createdSourceIds: string[] = [];

afterAll(async () => {
  await deleteKnowledgeSourcesForDrivers(prisma, createdDriverIds);
  if (createdDriverIds.length > 0) {
    await prisma.externalDriver.deleteMany({ where: { id: { in: createdDriverIds } } });
  }
  if (createdSourceIds.length > 0) {
    await prisma.externalKnowledgeSource.deleteMany({ where: { id: { in: createdSourceIds } } });
  }
  if (createdCharacterIds.length > 0) {
    await prisma.character.deleteMany({ where: { id: { in: createdCharacterIds } } });
  }
  if (createdUniverseIds.length > 0) {
    await prisma.universe.deleteMany({ where: { id: { in: createdUniverseIds } } });
  }
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

async function createOwner(label: string) {
  const user = await prisma.user.create({
    data: {
      email: `${PREFIX}-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@f1nw.test`,
      name: `Owner ${label}`,
    },
  });
  createdUserIds.push(user.id);
  const universe = await prisma.universe.create({ data: { userId: user.id } });
  createdUniverseIds.push(universe.id);
  return { user, universe };
}

async function createDriverFixture(
  label: string,
  options?: { universeId?: string; sourceRecord?: Prisma.InputJsonValue },
) {
  const owner = options?.universeId ? null : await createOwner(label);
  const universeId = options?.universeId ?? (owner as Awaited<ReturnType<typeof createOwner>>).universe.id;
  const driver = await prisma.externalDriver.create({
    data: {
      source: "f1db",
      externalId: `${PREFIX}-${label}`,
      name: `Piloto ${label}`,
      fullName: `Piloto Completo ${label}`,
      nationality: "NED",
      number: 33,
      contentHash: `hash-${label}`,
      ...(options?.sourceRecord !== undefined ? { sourceRecord: options.sourceRecord } : {}),
    },
  });
  createdDriverIds.push(driver.id);
  const character = await prisma.character.create({
    data: {
      universeId,
      controlledBy: "AI",
      name: `Piloto ${label}`,
      nationality: "NED",
      birthDate: new Date("1997-09-30T00:00:00.000Z"),
      driverProfile: { create: { number: 33 } },
    },
  });
  createdCharacterIds.push(character.id);
  await prisma.externalBindingDriver.create({
    data: { universeId, externalDriverId: driver.id, characterId: character.id },
  });
  return { driver, character, owner };
}

describe("biography composer", () => {
  it("1) compõe display e context a partir de fatos estruturados", () => {
    const facts = {
      publicName: "Max Exemplo",
      dateOfBirth: new Date("1997-09-30T00:00:00.000Z"),
      placeOfBirth: "Hasselt, Bélgica",
      nationality: "Países Baixos",
      representedCountry: "Países Baixos",
      debutYear: 2015,
      teams: ["Equipe A", "Equipe B"],
      championships: [2021, 2022],
      interests: ["sim racing", "música"],
    };
    const display = composeBiographyDisplay(facts);
    const context = composeBiographyContext(facts);

    expect(display).toContain("Max Exemplo nasceu em Hasselt, Bélgica em 30 de setembro de 1997.");
    expect(display).toContain("De nacionalidade neerlandesa.");
    expect(display).toContain("Tem registros na Fórmula 1 desde 2015.");
    expect(display).toContain("Equipe A e Equipe B");
    expect(display).toContain("campeonato mundial em 2021 e 2022");
    expect(display).toContain("sim racing e música");
    expect(context).toContain("Max Exemplo");
    expect(context).toContain("nacionalidade neerlandesa");
    expect(context).toContain("registros na F1 desde 2015");
    expect(context).toContain("campeão em 2021, 2022");
  });

  it("2) omite fatos ausentes sem inventar", () => {
    expect(composeBiographyDisplay({})).toBeNull();
    expect(composeBiographyContext({})).toBeNull();
    expect(composeBiographyDisplay({ nationality: "ITA" })).toBeNull();
    const namedNationality = composeBiographyDisplay({ publicName: "Piloto", nationality: "ITA" });
    expect(namedNationality).toContain("nacionalidade");
    expect(namedNationality).not.toContain("nasceu");
  });

  it("3) não copia texto de fonte e aplica caps", () => {
    const longSource = Array.from({ length: 200 }, (_, i) => `frase copiada ${i}`).join(" ");
    const display = composeBiographyDisplay({
      publicName: "Piloto",
      interests: [longSource],
    });
    expect(display).not.toBeNull();
    expect((display as string).length).toBeLessThanOrEqual(1201);
    expect(display).toContain("…");
  });

  it("4) formata data de nascimento de forma determinística", () => {
    expect(formatBirthDate(new Date("2000-01-01T00:00:00.000Z"))).toBe("1 de janeiro de 2000");
  });
});

describe("driver profile upsert and view", () => {
  it("5) upsert cria perfil com identidade, biografia e FRESH", async () => {
    const { driver } = await createDriverFixture("upsert");
    const source = await recordKnowledgeSource({
      provider: "F1DB",
      sourceKind: "STRUCTURED_RELEASE",
      url: `https://f1db.example/${PREFIX}-upsert`,
      license: "CC_BY_4_0",
    });
    createdSourceIds.push(source.id);
    const now = new Date("2026-09-30T12:00:00.000Z");
    const profile = await upsertDriverProfileFromProvider(
      driver.id,
      {
        publicName: "Piloto Upsert",
        dateOfBirth: new Date("1997-09-30T00:00:00.000Z"),
        placeOfBirth: "Hasselt",
        nationality: "Países Baixos",
        driverNumber: 33,
        wikidataQid: "Q12345",
        f1dbDriverId: "piloto-upsert",
        sourceId: source.id,
        biographyFacts: {
          publicName: "Piloto Upsert",
          dateOfBirth: new Date("1997-09-30T00:00:00.000Z"),
          placeOfBirth: "Hasselt",
          nationality: "Países Baixos",
        },
      },
      now,
    );

    expect(profile.publicName).toBe("Piloto Upsert");
    expect(profile.wikidataQid).toBe("Q12345");
    expect(profile.refreshStatus).toBe("FRESH");
    expect(profile.lastVerifiedAt?.toISOString()).toBe(now.toISOString());
    expect(profile.biographySourceId).toBe(source.id);
    expect(profile.biographyDisplay).toContain("nasceu");
  });

  it("6) upsert atualiza campos existentes e marca stale sem apagar identidade", async () => {
    const { driver } = await createDriverFixture("update");
    await upsertDriverProfileFromProvider(driver.id, { publicName: "Antes", driverCode: "ANT" });
    await upsertDriverProfileFromProvider(driver.id, { publicName: "Depois", currentTeamName: "Equipe Nova" });
    let profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: driver.id },
    });
    expect(profile.publicName).toBe("Depois");
    expect(profile.currentTeamName).toBe("Equipe Nova");

    await markDriverProfileStale(driver.id);
    profile = await prisma.externalDriverProfile.findUniqueOrThrow({
      where: { externalDriverId: driver.id },
    });
    expect(profile.refreshStatus).toBe("STALE");
    expect(profile.publicName).toBe("Depois");
  });

  it("7) upsert de piloto externo inexistente falha com DRIVER_NOT_FOUND", async () => {
    await expect(
      upsertDriverProfileFromProvider("00000000-0000-0000-0000-000000000000", {
        publicName: "Fantasma",
      }),
    ).rejects.toMatchObject({ code: "DRIVER_NOT_FOUND" });
  });

  it("8) view sem binding reporta NO_EXTERNAL_BINDING", async () => {
    const owner = await createOwner("nobind");
    const character = await prisma.character.create({
      data: {
        universeId: owner.universe.id,
        controlledBy: "AI",
        name: "Sem Binding",
        nationality: "BRA",
        birthDate: new Date("2000-01-01T00:00:00.000Z"),
        driverProfile: { create: {} },
      },
    });
    createdCharacterIds.push(character.id);

    const view = await getDriverProfileView(character.id);
    expect(view.available).toBe(false);
    if (view.available) throw new Error("unreachable");
    expect(view.reason).toBe("NO_EXTERNAL_BINDING");
  });

  it("9) view sem perfil externo expõe identidade do mirror", async () => {
    const { character, driver } = await createDriverFixture("mirror");
    const view = await getDriverProfileView(character.id);
    expect(view.available).toBe(false);
    if (view.available) throw new Error("unreachable");
    expect(view.reason).toBe("NO_EXTERNAL_PROFILE");
    expect(view.externalIdentity?.externalDriverId).toBe(driver.id);
    expect(view.externalIdentity?.name).toBe(driver.name);
  });

  it("10) view disponível mescla perfil e driver com origem EXTERNAL", async () => {
    const { character, driver } = await createDriverFixture("available");
    await upsertDriverProfileFromProvider(driver.id, {
      publicName: "Piloto Disponível",
      representedCountry: "Países Baixos",
      currentTeamName: "Equipe X",
      biographyFacts: { publicName: "Piloto Disponível", nationality: "Países Baixos" },
    });

    const view = await getDriverProfileView(character.id);
    expect(view.available).toBe(true);
    if (!view.available) throw new Error("unreachable");
    expect(view.identity.publicName).toBe("Piloto Disponível");
    expect(view.identity.nationality).toBe("Neerlandês");
    expect(view.identity.driverNumber).toBe(33);
    expect(view.biography.origin).toBe("EXTERNAL");
    expect(view.refresh.status).toBe("FRESH");
    expect(view.hasPersona).toBe(false);
  });

  it("11) biografia do Universe tem precedência e refresh STALE é calculado", async () => {
    const { character, driver } = await createDriverFixture("override");
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await upsertDriverProfileFromProvider(
      driver.id,
      {
        publicName: "Piloto Override",
        biographyFacts: { publicName: "Piloto Override" },
      },
      old,
    );
    await prisma.character.update({
      where: { id: character.id },
      data: { biography: "Biografia personalizada do Universe." },
    });

    const view = await getDriverProfileView(character.id);
    expect(view.available).toBe(true);
    if (!view.available) throw new Error("unreachable");
    expect(view.biography.origin).toBe("UNIVERSE");
    expect(view.biography.display).toBe("Biografia personalizada do Universe.");
    expect(view.refresh.status).toBe("STALE");
  });

  it("12) personagem inexistente retorna CHARACTER_NOT_FOUND", async () => {
    const view = await getDriverProfileView("00000000-0000-0000-0000-000000000000");
    expect(view.available).toBe(false);
    if (view.available) throw new Error("unreachable");
    expect(view.reason).toBe("CHARACTER_NOT_FOUND");
  });

  it("15) view completa nascimento e código a partir do sourceRecord do espelho", async () => {
    const { character, driver } = await createDriverFixture("source-record", {
      sourceRecord: { code: "SRC", dateOfBirth: "1993-07-01" },
    });
    await upsertDriverProfileFromProvider(driver.id, {
      publicName: "Piloto Source",
      nationality: "NED",
    });

    const view = await getDriverProfileView(character.id);
    expect(view.available).toBe(true);
    if (!view.available) throw new Error("unreachable");
    expect(view.identity.driverCode).toBe("SRC");
    expect(view.identity.dateOfBirth?.toISOString()).toBe("1993-07-01T00:00:00.000Z");
  });
});

describe("pilot knowledge access", () => {
  it("13) ownership por character e por universe; terceiros recebem NOT_FOUND", async () => {
    const owner = await createOwner("access");
    const other = await createOwner("access-other");
    const { character, driver } = await createDriverFixture("access", {
      universeId: owner.universe.id,
    });
    void driver;

    const own = await resolvePilotKnowledgeAccess(owner.user.id, character.id);
    expect(own.kind).toBe("OWNER_UNIVERSE");

    const stranger = await resolvePilotKnowledgeAccess(other.user.id, character.id);
    expect(stranger.kind).toBe("NOT_FOUND");

    const globalCharacter = await prisma.character.create({
      data: {
        controlledBy: "AI",
        name: "Global AI",
        nationality: "ITA",
        birthDate: new Date("1990-01-01T00:00:00.000Z"),
      },
    });
    createdCharacterIds.push(globalCharacter.id);
    const global = await resolvePilotKnowledgeAccess(owner.user.id, globalCharacter.id);
    expect(global.kind).toBe("GLOBAL_AI_CATALOG");
  });

  it("14) erro de tabela ausente vira 503 PROVIDERS_UNAVAILABLE", async () => {
    const missing = Object.assign(new Error("table missing"), { code: "P2021" });
    await expect(withPilotKnowledgeAvailability(async () => Promise.reject(missing))).rejects.toMatchObject({
      code: "PROVIDERS_UNAVAILABLE",
      statusCode: 503,
    });

    const result = await withPilotKnowledgeAvailability(async () => 42);
    expect(result).toBe(42);

    const other = new Error("boom");
    await expect(withPilotKnowledgeAvailability(async () => Promise.reject(other))).rejects.toBe(other);
    expect(new PilotKnowledgeError("NOT_FOUND", "x", 404).statusCode).toBe(404);
  });
});

