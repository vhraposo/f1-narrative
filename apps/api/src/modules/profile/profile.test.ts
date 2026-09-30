import { Buffer } from "node:buffer";
import { createHmac, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { FastifyInstance } from "fastify";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { buildApp } from "../../app.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import { LocalStorageProvider } from "../../infrastructure/storage/local-storage.provider.js";
import {
  joinStorageKey,
  StorageError,
  type StorageProvider,
} from "../../infrastructure/storage/storage-provider.js";
import { saveAvatarMedia } from "../media/media.service.js";

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(32, 1),
]);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0]),
  Buffer.alloc(32, 2),
]);

type TestUser = { cookie: string; userId: string };
type Fixture = {
  universeId: string;
  teamId: string;
  driverId: string;
};

class FailingStorageProvider implements StorageProvider {
  readonly name = "failing";
  async upload(): Promise<void> {
    throw new StorageError("STORAGE_WRITE_FAILED", "Falha simulada de storage");
  }
  async delete(): Promise<void> {}
  async get(): Promise<null> {
    return null;
  }
  async exists(): Promise<boolean> {
    return false;
  }
}

async function createDbUser(suffix: string): Promise<TestUser> {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET not set");
  const user = await prisma.user.create({
    data: {
      email: `profile-${suffix}-${Date.now()}@f1nw.test`,
      name: `Perfil ${suffix}`,
      password: null,
      emailVerified: false,
    },
    select: { id: true },
  });
  createdUserIds.push(user.id);
  const token = randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      token,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      userId: user.id,
    },
  });
  const sig = createHmac("sha256", secret).update(token).digest("base64");
  return { cookie: `f1nw.session_token=${token}.${sig}`, userId: user.id };
}

async function createUniverseFixture(
  userId: string,
  name: string,
): Promise<Fixture> {
  const universe = await prisma.universe.create({
    data: { userId, status: "READY" },
  });
  const team = await prisma.team.create({
    data: {
      name: name,
      shortName: name.slice(0, 3).toUpperCase(),
      userId,
      universeId: universe.id,
    },
  });
  const character = await prisma.character.create({
    data: {
      name: `${name} Driver`,
      nationality: "Brazil",
      birthDate: new Date("2000-01-01"),
      userId,
      universeId: universe.id,
    },
  });
  const driver = await prisma.driverProfile.create({
    data: { characterId: character.id, number: 44 },
  });
  return { universeId: universe.id, teamId: team.id, driverId: driver.id };
}

function mediaIdFromUrl(url: string): string {
  const match = url.match(/\/api\/media\/([0-9a-fA-F-]{36})$/);
  if (!match) throw new Error(`URL de mídia inesperada: ${url}`);
  return match[1];
}

const createdUserIds: string[] = [];

describe("Profile + Media (Fase 5)", () => {
  let app: FastifyInstance;
  let root: string;
  let storage: LocalStorageProvider;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "f1nw-profile-"));
    storage = new LocalStorageProvider(root);
    app = buildApp(undefined, undefined, undefined, undefined, undefined, storage);
    await app.ready();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await rm(root, { recursive: true, force: true });
    await app.close();
    await prisma.$disconnect();
  });

  it("exige autenticação em todas as rotas de perfil", async () => {
    const get = await app.inject({ method: "GET", url: "/api/profile" });
    const patch = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      payload: { favoriteTeamId: null },
    });
    const upload = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { "content-type": "image/png" },
      payload: PNG,
    });
    const remove = await app.inject({
      method: "DELETE",
      url: "/api/profile/avatar",
    });
    expect(get.statusCode).toBe(401);
    expect(patch.statusCode).toBe(401);
    expect(upload.statusCode).toBe(401);
    expect(remove.statusCode).toBe(401);
  });

  it("GET cria o UserProfile uma única vez e retorna a view do usuário", async () => {
    const user = await createDbUser("init");

    const first = await app.inject({
      method: "GET",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.1",
    });
    const second = await app.inject({
      method: "GET",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.2",
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    const profile = first.json().profile;
    expect(profile.userId).toBe(user.userId);
    expect(profile.displayName).toBe("Perfil init");
    expect(profile.image).toBeNull();
    expect(profile.favoriteTeam).toBeNull();
    expect(profile.favoriteDriver).toBeNull();

    const count = await prisma.userProfile.count({
      where: { userId: user.userId },
    });
    expect(count).toBe(1);
  });

  it("PATCH valida o payload com zod", async () => {
    const user = await createDbUser("zod");

    const empty = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      payload: {},
      remoteAddress: "10.55.0.3",
    });
    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      payload: { favoriteTeamId: "not-a-uuid" },
      remoteAddress: "10.55.0.4",
    });

    expect(empty.statusCode).toBe(400);
    expect(empty.json().code).toBe("VALIDATION_ERROR");
    expect(invalid.statusCode).toBe(400);
    expect(invalid.json().code).toBe("VALIDATION_ERROR");
  });

  it("PATCH define e limpa favoritos válidos do próprio Universe", async () => {
    const user = await createDbUser("fav");
    const fixture = await createUniverseFixture(user.userId, "Aurora");

    const set = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      payload: {
        favoriteTeamId: fixture.teamId,
        favoriteDriverId: fixture.driverId,
      },
      remoteAddress: "10.55.0.5",
    });
    expect(set.statusCode).toBe(200);
    expect(set.json().profile.favoriteTeam.id).toBe(fixture.teamId);
    expect(set.json().profile.favoriteDriver.id).toBe(fixture.driverId);
    expect(set.json().profile.favoriteDriver.name).toBe("Aurora Driver");

    const cleared = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      payload: { favoriteTeamId: null, favoriteDriverId: null },
      remoteAddress: "10.55.0.6",
    });
    expect(cleared.statusCode).toBe(200);
    expect(cleared.json().profile.favoriteTeam).toBeNull();
    expect(cleared.json().profile.favoriteDriver).toBeNull();
  });

  it("PATCH rejeita favorito inexistente e favorito de outro Universe", async () => {
    const userA = await createDbUser("iso-a");
    const userB = await createDbUser("iso-b");
    const fixtureA = await createUniverseFixture(userA.userId, "McLaren");
    const fixtureB = await createUniverseFixture(userB.userId, "McLaren");

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: userA.cookie },
      payload: { favoriteTeamId: "00000000-0000-4000-8000-000000000000" },
      remoteAddress: "10.55.0.7",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().code).toBe("FAVORITE_NOT_FOUND");

    const otherUniverseTeam = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: userA.cookie },
      payload: { favoriteTeamId: fixtureB.teamId },
      remoteAddress: "10.55.0.8",
    });
    expect(otherUniverseTeam.statusCode).toBe(403);
    expect(otherUniverseTeam.json().code).toBe("FAVORITE_NOT_IN_UNIVERSE");

    const otherUniverseDriver = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: userA.cookie },
      payload: { favoriteDriverId: fixtureB.driverId },
      remoteAddress: "10.55.0.9",
    });
    expect(otherUniverseDriver.statusCode).toBe(403);
    expect(otherUniverseDriver.json().code).toBe("FAVORITE_NOT_IN_UNIVERSE");

    const own = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: userA.cookie },
      payload: { favoriteTeamId: fixtureA.teamId },
      remoteAddress: "10.55.0.10",
    });
    expect(own.statusCode).toBe(200);
    expect(own.json().profile.favoriteTeam.id).toBe(fixtureA.teamId);
  });

  it("upload válido cria MediaAsset, atualiza User.image e serve a mídia ao dono", async () => {
    const user = await createDbUser("avatar");
    const other = await createDbUser("avatar-other");

    const upload = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: {
        cookie: user.cookie,
        "content-type": "image/png",
        "x-filename": "../foto estranha.png",
      },
      payload: PNG,
      remoteAddress: "10.55.0.11",
    });
    expect(upload.statusCode).toBe(200);
    const image = upload.json().profile.image as string;
    const assetId = mediaIdFromUrl(image);

    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: assetId },
    });
    expect(asset.ownerUserId).toBe(user.userId);
    expect(asset.kind).toBe("USER_AVATAR");
    expect(asset.mimeType).toBe("image/png");
    expect(asset.byteSize).toBe(PNG.byteLength);
    expect(asset.provider).toBe("local");
    expect(asset.storageKey.startsWith(`user-avatars/${user.userId}/`)).toBe(
      true,
    );
    expect(asset.originalFilename).toBe("foto estranha.png");
    expect(await storage.exists(asset.storageKey)).toBe(true);

    const media = await app.inject({
      method: "GET",
      url: `/api/media/${assetId}`,
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.12",
    });
    expect(media.statusCode).toBe(200);
    expect(media.headers["content-type"]).toContain("image/png");
    expect(media.rawPayload.equals(PNG)).toBe(true);

    const foreign = await app.inject({
      method: "GET",
      url: `/api/media/${assetId}`,
      headers: { cookie: other.cookie },
      remoteAddress: "10.55.0.13",
    });
    expect(foreign.statusCode).toBe(404);
    expect(foreign.json().code).toBe("MEDIA_NOT_FOUND");

    const reload = await app.inject({
      method: "GET",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.14",
    });
    expect(reload.json().profile.image).toBe(image);

    const sessionAfterUpload = await app.inject({
      method: "GET",
      url: "/api/auth/get-session",
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.15",
    });
    expect(sessionAfterUpload.statusCode).toBe(200);
    expect(sessionAfterUpload.json().user.image).toBe(image);
  });

  it("rejeita upload sem autenticação e tipos não suportados", async () => {
    const user = await createDbUser("types");

    const noAuth = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { "content-type": "image/png" },
      payload: PNG,
    });
    expect(noAuth.statusCode).toBe(401);

    const pdf = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie, "content-type": "application/pdf" },
      payload: Buffer.from("%PDF-1.4"),
      remoteAddress: "10.55.0.15",
    });
    expect([400, 415]).toContain(pdf.statusCode);

    const fakePng = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie, "content-type": "image/png" },
      payload: Buffer.from("<html>não é imagem</html>"),
      remoteAddress: "10.55.0.16",
    });
    expect(fakePng.statusCode).toBe(400);
    expect(fakePng.json().code).toBe("INVALID_IMAGE_CONTENT");

    const wrongSignature = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie, "content-type": "image/png" },
      payload: JPEG,
      remoteAddress: "10.55.0.17",
    });
    expect(wrongSignature.statusCode).toBe(400);
    expect(wrongSignature.json().code).toBe("INVALID_IMAGE_CONTENT");
  });

  it("rejeita upload acima do limite configurado", async () => {
    const user = await createDbUser("size");
    const big = Buffer.concat([PNG, Buffer.alloc(70_000, 1)]);

    const upload = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie, "content-type": "image/png" },
      payload: big,
      remoteAddress: "10.55.0.18",
    });
    expect(upload.statusCode).toBe(413);

    const count = await prisma.mediaAsset.count({
      where: { ownerUserId: user.userId },
    });
    expect(count).toBe(0);
  });

  it("substituição remove o asset e o arquivo anterior", async () => {
    const user = await createDbUser("replace");

    const first = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie, "content-type": "image/png" },
      payload: PNG,
      remoteAddress: "10.55.0.19",
    });
    const firstId = mediaIdFromUrl(first.json().profile.image);
    const firstAsset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: firstId },
    });

    const second = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie, "content-type": "image/jpeg" },
      payload: JPEG,
      remoteAddress: "10.55.0.20",
    });
    expect(second.statusCode).toBe(200);
    const secondId = mediaIdFromUrl(second.json().profile.image);
    expect(secondId).not.toBe(firstId);

    expect(
      await prisma.mediaAsset.findUnique({ where: { id: firstId } }),
    ).toBeNull();
    expect(await storage.exists(firstAsset.storageKey)).toBe(false);

    const oldMedia = await app.inject({
      method: "GET",
      url: `/api/media/${firstId}`,
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.21",
    });
    expect(oldMedia.statusCode).toBe(404);

    const newMedia = await app.inject({
      method: "GET",
      url: `/api/media/${secondId}`,
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.22",
    });
    expect(newMedia.statusCode).toBe(200);
    expect(newMedia.rawPayload.equals(JPEG)).toBe(true);
  });

  it("remoção de avatar é idempotente e limpa referência, asset e arquivo", async () => {
    const user = await createDbUser("remove");

    const upload = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie, "content-type": "image/png" },
      payload: PNG,
      remoteAddress: "10.55.0.23",
    });
    const assetId = mediaIdFromUrl(upload.json().profile.image);
    const asset = await prisma.mediaAsset.findUniqueOrThrow({
      where: { id: assetId },
    });

    const remove = await app.inject({
      method: "DELETE",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.24",
    });
    expect(remove.statusCode).toBe(204);

    const profile = await app.inject({
      method: "GET",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.25",
    });
    expect(profile.json().profile.image).toBeNull();
    expect(
      await prisma.mediaAsset.findUnique({ where: { id: assetId } }),
    ).toBeNull();
    expect(await storage.exists(asset.storageKey)).toBe(false);

    const again = await app.inject({
      method: "DELETE",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.26",
    });
    expect(again.statusCode).toBe(204);
  });

  it("falha de storage retorna 502 sem criar asset nem alterar a imagem", async () => {
    const user = await createDbUser("fail");
    const failingApp = buildApp(
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      new FailingStorageProvider(),
    );
    await failingApp.ready();

    const upload = await failingApp.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: user.cookie, "content-type": "image/png" },
      payload: PNG,
      remoteAddress: "10.55.0.27",
    });
    expect(upload.statusCode).toBe(502);
    expect(upload.json().code).toBe("STORAGE_WRITE_FAILED");
    expect(upload.body).not.toContain("user-avatars");

    const count = await prisma.mediaAsset.count({
      where: { ownerUserId: user.userId },
    });
    expect(count).toBe(0);

    const profile = await app.inject({
      method: "GET",
      url: "/api/profile",
      headers: { cookie: user.cookie },
      remoteAddress: "10.55.0.28",
    });
    expect(profile.json().profile.image).toBeNull();

    await failingApp.close();
  });

  it("compensa o upload quando a persistência da mídia falha", async () => {
    const user = await createDbUser("compensate");
    const deleted: string[] = [];
    const wrapped: StorageProvider = {
      name: "local",
      upload: (input) => storage.upload(input),
      delete: async (key) => {
        deleted.push(key);
        await storage.delete(key);
      },
      get: (key) => storage.get(key),
      exists: (key) => storage.exists(key),
    };

    vi.spyOn(prisma.mediaAsset, "create").mockRejectedValueOnce(
      new Error("db down"),
    );

    await expect(
      saveAvatarMedia({
        userId: user.userId,
        storage: wrapped,
        upload: { body: PNG, contentType: "image/png", filename: "x.png" },
      }),
    ).rejects.toThrow("db down");

    expect(deleted).toHaveLength(1);
    expect(deleted[0].startsWith(`user-avatars/${user.userId}/`)).toBe(true);
    expect(await wrapped.exists(deleted[0])).toBe(false);
  });

  it("garante constraints de integridade da migration", async () => {
    const userA = await createDbUser("db-a");
    const userB = await createDbUser("db-b");
    const key = joinStorageKey("user-avatars", "shared", "dup.png");

    await prisma.mediaAsset.create({
      data: {
        ownerUserId: userA.userId,
        provider: "local",
        storageKey: key,
        mimeType: "image/png",
        byteSize: 10,
      },
    });
    await expect(
      prisma.mediaAsset.create({
        data: {
          ownerUserId: userB.userId,
          provider: "local",
          storageKey: key,
          mimeType: "image/png",
          byteSize: 10,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.userProfile.create({ data: { userId: userA.userId } });
    await expect(
      prisma.userProfile.create({ data: { userId: userA.userId } }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("mantém isolamento entre usuários com entidades equivalentes", async () => {
    const userA = await createDbUser("equal-a");
    const userB = await createDbUser("equal-b");
    const fixtureA = await createUniverseFixture(userA.userId, "Equivalente");
    const fixtureB = await createUniverseFixture(userB.userId, "Equivalente");

    const setA = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: userA.cookie },
      payload: { favoriteTeamId: fixtureA.teamId, favoriteDriverId: fixtureA.driverId },
      remoteAddress: "10.55.0.29",
    });
    const setB = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: userB.cookie },
      payload: { favoriteTeamId: fixtureB.teamId, favoriteDriverId: fixtureB.driverId },
      remoteAddress: "10.55.0.30",
    });
    expect(setA.statusCode).toBe(200);
    expect(setB.statusCode).toBe(200);
    expect(setA.json().profile.favoriteTeam.id).toBe(fixtureA.teamId);
    expect(setB.json().profile.favoriteTeam.id).toBe(fixtureB.teamId);

    const uploadA = await app.inject({
      method: "POST",
      url: "/api/profile/avatar",
      headers: { cookie: userA.cookie, "content-type": "image/png" },
      payload: PNG,
      remoteAddress: "10.55.0.31",
    });
    const assetA = mediaIdFromUrl(uploadA.json().profile.image);

    const crossRead = await app.inject({
      method: "GET",
      url: `/api/media/${assetA}`,
      headers: { cookie: userB.cookie },
      remoteAddress: "10.55.0.32",
    });
    expect(crossRead.statusCode).toBe(404);

    const crossFavorite = await app.inject({
      method: "PATCH",
      url: "/api/profile",
      headers: { cookie: userB.cookie },
      payload: { favoriteTeamId: fixtureA.teamId },
      remoteAddress: "10.55.0.33",
    });
    expect(crossFavorite.statusCode).toBe(403);
    expect(crossFavorite.json().code).toBe("FAVORITE_NOT_IN_UNIVERSE");
  });
});
