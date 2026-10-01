import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { S3CompatibleStorageProvider } from "./s3-compatible-storage.provider.js";
import { createStorageProviderFromEnv } from "./storage.factory.js";
import { StorageError } from "./storage-provider.js";
import type { Env } from "../../config/env.js";

const BUCKET = "f1nw-media";
const SECRET = "super-secret-value";

describe("S3CompatibleStorageProvider (contrato)", () => {
  let server: Server;
  let provider: S3CompatibleStorageProvider;
  const stored = new Map<string, Buffer>();
  const requests: Array<{ method: string; url: string }> = [];
  let lastAuth = "";
  let failNext = false;

  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const body = Buffer.concat(chunks);
        requests.push({ method: req.method ?? "", url: req.url ?? "" });
        if (req.headers.authorization) {
          lastAuth = String(req.headers.authorization);
        }
        if (failNext) {
          res.writeHead(500);
          res.end();
          return;
        }
        const key = decodeURIComponent(
          (req.url ?? "").replace(`/${BUCKET}/`, ""),
        );
        if (req.method === "PUT") {
          stored.set(key, body);
          res.writeHead(200);
          res.end();
          return;
        }
        if (req.method === "GET" || req.method === "HEAD") {
          const value = stored.get(key);
          if (!value) {
            res.writeHead(404);
            res.end();
            return;
          }
          res.writeHead(200, {
            "Content-Type": "image/png",
            "Content-Length": String(value.byteLength),
          });
          res.end(req.method === "HEAD" ? undefined : value);
          return;
        }
        if (req.method === "DELETE") {
          res.writeHead(stored.delete(key) ? 204 : 404);
          res.end();
          return;
        }
        res.writeHead(400);
        res.end();
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", () => resolve()),
    );
    const address = server.address() as AddressInfo;
    provider = new S3CompatibleStorageProvider({
      endpoint: `http://127.0.0.1:${address.port}`,
      bucket: BUCKET,
      region: "us-east-1",
      accessKeyId: "AKIDTEST",
      secretAccessKey: SECRET,
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("assina requisições e executa o ciclo upload/get/exists/delete", async () => {
    const key = "user-avatars/u1/avatar.png";
    const body = Buffer.from("S3-BODY");

    await provider.upload({ key, body, contentType: "image/png" });

    expect(requests.at(-1)).toEqual({
      method: "PUT",
      url: `/${BUCKET}/${key}`,
    });
    expect(lastAuth).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDTEST\//);
    expect(stored.get(key)?.equals(body)).toBe(true);

    expect(await provider.exists(key)).toBe(true);
    expect(requests.at(-1)?.method).toBe("HEAD");

    const object = await provider.get(key);
    expect(object?.body.equals(body)).toBe(true);

    await provider.delete(key);
    expect(await provider.exists(key)).toBe(false);
  });

  it("retorna null/undefined para objeto ausente e tolera delete 404", async () => {
    expect(await provider.get("user-avatars/u9/missing.png")).toBeNull();
    expect(await provider.exists("user-avatars/u9/missing.png")).toBe(false);
    await expect(
      provider.delete("user-avatars/u9/missing.png"),
    ).resolves.toBeUndefined();
  });

  it("não expõe segredo nem key em falha do provider", async () => {
    failNext = true;
    let caught: StorageError | null = null;
    try {
      await provider.upload({
        key: "user-avatars/u1/segredo.png",
        body: Buffer.from("X"),
        contentType: "image/png",
      });
    } catch (error) {
      caught = error as StorageError;
    } finally {
      failNext = false;
    }
    expect(caught).toBeInstanceOf(StorageError);
    expect(caught?.code).toBe("STORAGE_WRITE_FAILED");
    expect(caught?.message).not.toContain(SECRET);
    expect(caught?.message).not.toContain("segredo.png");
    expect(caught?.message).not.toContain("AKIDTEST");
  });

  it("envia o hash sha256 do corpo", async () => {
    const body = Buffer.from("HASHED");
    await provider.upload({
      key: "user-avatars/u1/hash.png",
      body,
      contentType: "image/png",
    });
    const expected = createHash("sha256").update(body).digest("hex");
    const putRequest = requests.filter((item) => item.method === "PUT").at(-1);
    expect(putRequest?.url).toBe(`/${BUCKET}/user-avatars/u1/hash.png`);
    expect(stored.get("user-avatars/u1/hash.png")?.equals(body)).toBe(true);
    expect(expected).toHaveLength(64);
  });
});

describe("createStorageProviderFromEnv", () => {
  it("cria o provider local por padrão", () => {
    const provider = createStorageProviderFromEnv({
      STORAGE_PROVIDER: "local",
      STORAGE_LOCAL_ROOT: "./.storage/test",
    } as Env);
    expect(provider.name).toBe("local");
  });

  it("falha com configuração S3 incompleta sem vazar segredos", () => {
    let caught: StorageError | null = null;
    try {
      createStorageProviderFromEnv({
        STORAGE_PROVIDER: "s3",
        S3_ENDPOINT: "https://s3.example.com",
        S3_SECRET_ACCESS_KEY: SECRET,
      } as Env);
    } catch (error) {
      caught = error as StorageError;
    }
    expect(caught).toBeInstanceOf(StorageError);
    expect(caught?.code).toBe("S3_CONFIG_MISSING");
    expect(caught?.message).toContain("S3_BUCKET");
    expect(caught?.message).not.toContain(SECRET);
  });
});
