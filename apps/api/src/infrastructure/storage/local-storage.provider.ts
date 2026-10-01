import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  assertSafeStorageKey,
  StorageError,
  type StorageProvider,
  type StoredObject,
  type UploadInput,
} from "./storage-provider.js";

export class LocalStorageProvider implements StorageProvider {
  readonly name = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = path.resolve(root);
  }

  private resolveKey(key: string): string {
    assertSafeStorageKey(key);
    const fullPath = path.resolve(this.root, key);
    if (!fullPath.startsWith(this.root + path.sep)) {
      throw new StorageError(
        "INVALID_STORAGE_KEY",
        "Chave de armazenamento inválida",
        400,
      );
    }
    return fullPath;
  }

  async upload({ key, body }: UploadInput): Promise<void> {
    const fullPath = this.resolveKey(key);
    await mkdir(path.dirname(fullPath), { recursive: true });
    try {
      await writeFile(fullPath, body, { flag: "wx" });
    } catch (error) {
      if ((error as { code?: string }).code === "EEXIST") {
        throw new StorageError(
          "STORAGE_KEY_EXISTS",
          "Recurso de mídia já existe",
          409,
        );
      }
      throw new StorageError(
        "STORAGE_WRITE_FAILED",
        "Falha ao gravar a mídia no armazenamento local",
      );
    }
  }

  async delete(key: string): Promise<void> {
    const fullPath = this.resolveKey(key);
    try {
      await rm(fullPath, { force: true });
    } catch {
      throw new StorageError(
        "STORAGE_DELETE_FAILED",
        "Falha ao remover a mídia no armazenamento local",
      );
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const fullPath = this.resolveKey(key);
    try {
      const body = await readFile(fullPath);
      return { body, byteSize: body.byteLength };
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return null;
      }
      throw new StorageError(
        "STORAGE_READ_FAILED",
        "Falha ao ler a mídia no armazenamento local",
      );
    }
  }

  async exists(key: string): Promise<boolean> {
    const fullPath = this.resolveKey(key);
    try {
      await stat(fullPath);
      return true;
    } catch (error) {
      if ((error as { code?: string }).code === "ENOENT") {
        return false;
      }
      throw new StorageError(
        "STORAGE_READ_FAILED",
        "Falha ao ler a mídia no armazenamento local",
      );
    }
  }
}
