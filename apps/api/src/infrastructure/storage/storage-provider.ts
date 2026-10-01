import { Buffer } from "node:buffer";

export type StoredObject = {
  body: Buffer;
  byteSize: number;
};

export type UploadInput = {
  key: string;
  body: Buffer;
  contentType: string;
};

export interface StorageProvider {
  readonly name: string;
  upload(input: UploadInput): Promise<void>;
  delete(key: string): Promise<void>;
  get(key: string): Promise<StoredObject | null>;
  exists(key: string): Promise<boolean>;
}

export class StorageError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 502,
  ) {
    super(message);
    this.name = "StorageError";
  }
}

const SAFE_STORAGE_KEY = /^(?!.*\.\.)[a-z0-9][a-z0-9/_.-]*$/;
const MAX_STORAGE_KEY_LENGTH = 512;

export function assertSafeStorageKey(key: string): void {
  if (
    key.length === 0 ||
    key.length > MAX_STORAGE_KEY_LENGTH ||
    !SAFE_STORAGE_KEY.test(key)
  ) {
    throw new StorageError(
      "INVALID_STORAGE_KEY",
      "Chave de armazenamento inválida",
      400,
    );
  }
}

export function joinStorageKey(...parts: string[]): string {
  const key = parts
    .map((part) => part.trim().replace(/^\/+|\/+$/g, ""))
    .filter((part) => part.length > 0)
    .join("/");
  assertSafeStorageKey(key);
  return key;
}
