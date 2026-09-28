import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { LocalStorageProvider } from "./local-storage.provider.js";
import { joinStorageKey, StorageError } from "./storage-provider.js";

describe("LocalStorageProvider", () => {
  let root: string;
  let provider: LocalStorageProvider;

  beforeAll(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "f1nw-storage-"));
    provider = new LocalStorageProvider(root);
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("faz upload, lê, verifica existência e remove com key gerada pelo servidor", async () => {
    const key = joinStorageKey("user-avatars", "u1", "a.png");
    const body = Buffer.from("PNG-DATA");

    await provider.upload({ key, body, contentType: "image/png" });

    expect(await provider.exists(key)).toBe(true);
    const object = await provider.get(key);
    expect(object?.body.equals(body)).toBe(true);
    expect(object?.byteSize).toBe(body.byteLength);
    expect((await readFile(path.join(root, key))).equals(body)).toBe(true);

    await provider.delete(key);
    expect(await provider.exists(key)).toBe(false);
    expect(await provider.get(key)).toBeNull();
  });

  it("não sobrescreve arquivo existente de outro usuário", async () => {
    const key = joinStorageKey("user-avatars", "u2", "b.png");
    const body = Buffer.from("ORIGINAL");
    await provider.upload({ key, body, contentType: "image/png" });

    await expect(
      provider.upload({ key, body: Buffer.from("OUTRO"), contentType: "image/png" }),
    ).rejects.toMatchObject({ code: "STORAGE_KEY_EXISTS" });
    expect((await provider.get(key))?.body.toString()).toBe("ORIGINAL");
  });

  it("rejeita path traversal e keys inválidas", async () => {
    const body = Buffer.from("X");
    await expect(
      provider.upload({ key: "../escape.png", body, contentType: "image/png" }),
    ).rejects.toMatchObject({ code: "INVALID_STORAGE_KEY" });
    await expect(
      provider.get("user-avatars/../../etc/passwd"),
    ).rejects.toMatchObject({ code: "INVALID_STORAGE_KEY" });
    await expect(provider.get("/etc/passwd")).rejects.toMatchObject({
      code: "INVALID_STORAGE_KEY",
    });
    await expect(provider.get("user-avatars\\u1\\x.png")).rejects.toMatchObject({
      code: "INVALID_STORAGE_KEY",
    });
    expect(() => joinStorageKey("user-avatars", "..", "x.png")).toThrow(StorageError);
  });

  it("remove é tolerante a arquivo ausente", async () => {
    await expect(
      provider.delete("user-avatars/u3/inexistente.png"),
    ).resolves.toBeUndefined();
  });
});
