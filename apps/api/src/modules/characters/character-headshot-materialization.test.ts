import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { CharacterHeadshotMaterializationService } from "./character-headshot-materialization.js";

const PREFIX = "headshot-mat";

const createdCharacters: string[] = [];

async function createUser(): Promise<{ id: string }> {
  return prisma.user.create({
    data: {
      name: "Materialização",
      email: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@f1nw.test`,
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
}

async function createCharacter(
  userId: string,
  name: string,
  imageUrl: string | null,
): Promise<{ id: string }> {
  const character = await prisma.character.create({
    data: {
      userId,
      name,
      nationality: "Brasileira",
      birthDate: new Date("1990-01-01"),
      imageUrl,
    },
    select: { id: true },
  });
  createdCharacters.push(character.id);
  return character;
}

async function createExternalDriver(headshotUrl: string | null): Promise<{ id: string }> {
  return prisma.externalDriver.create({
    data: {
      source: "jolpica",
      externalId: `${PREFIX}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: "Piloto materializado",
      number: 1,
      headshotUrl,
      contentHash: "seed",
    },
    select: { id: true },
  });
}

async function createBinding(characterId: string, externalDriverId: string) {
  return prisma.externalBindingDriver.create({ data: { characterId, externalDriverId } });
}

afterAll(async () => {
  await prisma.externalDriver.deleteMany({
    where: { source: "jolpica", externalId: { startsWith: `${PREFIX}-` } },
  });
  await prisma.character.deleteMany({ where: { id: { in: createdCharacters } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: `${PREFIX}-` } } });
  await prisma.$disconnect();
});

async function readImageUrl(characterId: string): Promise<string | null> {
  return (await prisma.character.findUniqueOrThrow({
    where: { id: characterId },
    select: { imageUrl: true },
  })).imageUrl;
}

describe("CharacterHeadshotMaterializationService", () => {
  async function baseline() {
    return new CharacterHeadshotMaterializationService().materialize();
  }

  it("preenche imageUrl nula com o headshot do vínculo (Caso 1)", async () => {
    const before = await baseline();
    const user = await createUser();
    const character = await createCharacter(user.id, "Piloto A", null);
    const driver = await createExternalDriver("https://ext.test/a.png");
    await createBinding(character.id, driver.id);

    const report = await new CharacterHeadshotMaterializationService().materialize();

    expect(report.charactersUpdated - before.charactersUpdated).toBe(1);
    expect(await readImageUrl(character.id)).toBe("https://ext.test/a.png");
  });

  it("trata string vazia como sem imagem e preenche (Caso 2)", async () => {
    const before = await baseline();
    const user = await createUser();
    const character = await createCharacter(user.id, "Piloto B", "");
    const driver = await createExternalDriver("https://ext.test/b.png");
    await createBinding(character.id, driver.id);

    const report = await new CharacterHeadshotMaterializationService().materialize();

    expect(report.charactersUpdated - before.charactersUpdated).toBe(1);
    expect(await readImageUrl(character.id)).toBe("https://ext.test/b.png");
  });

  it("preserva imagem personalizada existente (Caso 3)", async () => {
    const before = await baseline();
    const user = await createUser();
    const character = await createCharacter(user.id, "Piloto C", "custom-user-image");
    const driver = await createExternalDriver("https://ext.test/c.png");
    await createBinding(character.id, driver.id);

    const report = await new CharacterHeadshotMaterializationService().materialize();

    expect(report.charactersPreserved - before.charactersPreserved).toBe(1);
    expect(report.charactersUpdated - before.charactersUpdated).toBe(0);
    expect(await readImageUrl(character.id)).toBe("custom-user-image");
  });

  it("mantém sem imagem quando não há headshot (Caso 4)", async () => {
    const before = await baseline();
    const user = await createUser();
    const character = await createCharacter(user.id, "Piloto D", null);
    const driver = await createExternalDriver(null);
    await createBinding(character.id, driver.id);

    const report = await new CharacterHeadshotMaterializationService().materialize();

    expect(report.charactersWithoutHeadshot - before.charactersWithoutHeadshot).toBe(1);
    expect(report.charactersUpdated - before.charactersUpdated).toBe(0);
    expect(await readImageUrl(character.id)).toBeNull();
  });

  it("é idempotente: segunda execução não altera imagens já materializadas (Caso 5)", async () => {
    const before = await baseline();
    const user = await createUser();
    const character = await createCharacter(user.id, "Piloto E", null);
    const driver = await createExternalDriver("https://ext.test/e.png");
    await createBinding(character.id, driver.id);

    const first = await new CharacterHeadshotMaterializationService().materialize();
    expect(first.charactersUpdated - before.charactersUpdated).toBe(1);

    const second = await new CharacterHeadshotMaterializationService().materialize();
    expect(second.charactersUpdated).toBe(first.charactersUpdated - 1);
    expect(second.charactersPreserved).toBe(first.charactersPreserved + 1);
    expect(second.charactersWithoutHeadshot).toBe(first.charactersWithoutHeadshot);
    expect(await readImageUrl(character.id)).toBe("https://ext.test/e.png");
  });

  it("associa pelo binding, não pelo nome", async () => {
    const user = await createUser();
    const first = await createCharacter(user.id, "Duplicado", null);
    const second = await createCharacter(user.id, "Duplicado", null);
    const firstDriver = await createExternalDriver("https://ext.test/dupe-1.png");
    const secondDriver = await createExternalDriver("https://ext.test/dupe-2.png");
    await createBinding(first.id, firstDriver.id);
    await createBinding(second.id, secondDriver.id);

    await new CharacterHeadshotMaterializationService().materialize();

    expect(await readImageUrl(first.id)).toBe("https://ext.test/dupe-1.png");
    expect(await readImageUrl(second.id)).toBe("https://ext.test/dupe-2.png");
  });

  it("personagem sem vínculo externo não é alterado", async () => {
    const before = await baseline();
    const user = await createUser();
    const character = await createCharacter(user.id, "Piloto Livre", null);
    await createExternalDriver("https://ext.test/avulso.png");

    const report = await new CharacterHeadshotMaterializationService().materialize();

    expect(report.charactersUpdated - before.charactersUpdated).toBe(0);
    expect(await readImageUrl(character.id)).toBeNull();
  });

  it("preenche headshot da CDN F1 com rendition de alta resolução", async () => {
    const before = await baseline();
    const user = await createUser();
    const character = await createCharacter(user.id, "Piloto F1", null);
    const driver = await createExternalDriver(
      "https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ALEALB01_Alexander_Albon/alealb01.png.transform/1col/image.png",
    );
    await createBinding(character.id, driver.id);

    const report = await new CharacterHeadshotMaterializationService().materialize();

    expect(report.charactersUpdated - before.charactersUpdated).toBe(1);
    expect(await readImageUrl(character.id)).toBe(
      "https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ALEALB01_Alexander_Albon/alealb01.png.transform/2col-retina/image.png",
    );
  });

  it("faz upgrade de imageUrl já materializada pelo fluxo (1col) sem tocar em custom", async () => {
    const before = await baseline();
    const user = await createUser();
    const autoMaterialized = await createCharacter(
      user.id,
      "Piloto Matrix",
      "https://media.formula1.com/x/y.png.transform/1col/image.png",
    );
    const customF1 = await createCharacter(
      user.id,
      "Piloto Costume",
      "https://media.formula1.com/c/d.png.transform/4col/image.png",
    );
    const autoDriver = await createExternalDriver(
      "https://media.formula1.com/x/y.png.transform/1col/image.png",
    );
    const customDriver = await createExternalDriver(
      "https://media.formula1.com/c/d.png.transform/4col/image.png",
    );
    await createBinding(autoMaterialized.id, autoDriver.id);
    await createBinding(customF1.id, customDriver.id);

    const first = await new CharacterHeadshotMaterializationService().materialize();
    expect(first.charactersUpdated - before.charactersUpdated).toBe(1);
    expect(await readImageUrl(autoMaterialized.id)).toBe(
      "https://media.formula1.com/x/y.png.transform/2col-retina/image.png",
    );
    expect(await readImageUrl(customF1.id)).toBe(
      "https://media.formula1.com/c/d.png.transform/4col/image.png",
    );

    const second = await new CharacterHeadshotMaterializationService().materialize();
    expect(second.charactersUpdated).toBe(first.charactersUpdated - 1);
    expect(second.charactersPreserved).toBe(first.charactersPreserved + 1);
    expect(await readImageUrl(autoMaterialized.id)).toBe(
      "https://media.formula1.com/x/y.png.transform/2col-retina/image.png",
    );
  });
});

describe("Character headshot materialization routes — admin-only", () => {
  let app: FastifyInstance;
  let adminCookie: string;
  let userCookie: string;

  beforeAll(async () => {
    app = buildApp();
    await app.ready();

    const adminEmail = `${PREFIX}-route-admin-${Date.now()}@f1nw.test`;
    const userEmail = `${PREFIX}-route-user-${Date.now()}@f1nw.test`;
    adminCookie = await signUpGetCookie(app, adminEmail, "Char Mat Admin");
    userCookie = await signUpGetCookie(app, userEmail, "Char Mat User");

    const admin = await prisma.user.findUniqueOrThrow({ where: { email: adminEmail } });
    await prisma.user.update({ where: { id: admin.id }, data: { role: "ADMIN" } });
  });

  afterAll(async () => {
    await app.close();
  });

  it("sem sessão → 401", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/characters/headshots",
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("UNAUTHENTICATED");
  });

  it("usuário comum → 403", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/characters/headshots",
      headers: { cookie: userCookie },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("admin materializa → 200 com relatório", async () => {
    const user = await createUser();
    const character = await createCharacter(user.id, "Piloto Rota", null);
    const driver = await createExternalDriver("https://ext.test/rota.png");
    await createBinding(character.id, driver.id);

    const res = await app.inject({
      method: "POST",
      url: "/api/enrichment/characters/headshots",
      headers: { cookie: adminCookie },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.report.charactersUpdated).toBeGreaterThanOrEqual(1);
    expect(await readImageUrl(character.id)).toBe("https://ext.test/rota.png");
  });
});

async function signUpGetCookie(
  app: FastifyInstance,
  email: string,
  name: string,
): Promise<string> {
  const res = await app.inject({
    method: "POST",
    url: "/api/auth/sign-up/email",
    payload: { name, email, password: "senha-segura-123" },
  });
  expect(res.statusCode).toBe(200);
  return (res.cookies ?? [])
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}