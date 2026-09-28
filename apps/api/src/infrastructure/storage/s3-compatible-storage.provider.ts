import { Buffer } from "node:buffer";
import { createHash, createHmac } from "node:crypto";

import {
  assertSafeStorageKey,
  StorageError,
  type StorageProvider,
  type StoredObject,
  type UploadInput,
} from "./storage-provider.js";

export type S3CompatibleOptions = {
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
};

const ALGORITHM = "AWS4-HMAC-SHA256";
const SERVICE = "s3";

function sha256Hex(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac("sha256", key).update(value, "utf8").digest();
}

function encodeKeyPath(key: string): string {
  return key.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

export class S3CompatibleStorageProvider implements StorageProvider {
  readonly name = "s3";
  private readonly options: Required<S3CompatibleOptions>;

  constructor(options: S3CompatibleOptions) {
    this.options = {
      ...options,
      forcePathStyle: options.forcePathStyle ?? true,
    };
  }

  private objectUrl(key: string): URL {
    assertSafeStorageKey(key);
    const endpoint = new URL(this.options.endpoint);
    if (this.options.forcePathStyle) {
      return new URL(
        `${endpoint.origin}/${this.options.bucket}/${encodeKeyPath(key)}`,
      );
    }
    return new URL(
      `${endpoint.protocol}//${this.options.bucket}.${endpoint.host}/${encodeKeyPath(key)}`,
    );
  }

  private async send(
    method: string,
    key: string,
    body?: Buffer,
    contentType?: string,
  ): Promise<Response> {
    const url = this.objectUrl(key);
    const payloadHash = sha256Hex(body ?? "");
    const amzDate = new Date()
      .toISOString()
      .replace(/[:-]|\.\d{3}/g, "");
    const dateStamp = amzDate.slice(0, 8);

    const headers: Record<string, string> = {
      host: url.host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
    };
    if (contentType) {
      headers["content-type"] = contentType;
    }

    const signedHeaderNames = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaderNames
      .map((name) => `${name}:${headers[name]}\n`)
      .join("");
    const signedHeaders = signedHeaderNames.join(";");
    const canonicalRequest = [
      method,
      url.pathname,
      url.search.slice(1),
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join("\n");

    const scope = `${dateStamp}/${this.options.region}/${SERVICE}/aws4_request`;
    const stringToSign = [
      ALGORITHM,
      amzDate,
      scope,
      sha256Hex(canonicalRequest),
    ].join("\n");

    const signingKey = hmac(
      hmac(
        hmac(
          hmac(`AWS4${this.options.secretAccessKey}`, dateStamp),
          this.options.region,
        ),
        SERVICE,
      ),
      "aws4_request",
    );
    const signature = createHmac("sha256", signingKey)
      .update(stringToSign, "utf8")
      .digest("hex");
    headers.authorization = `${ALGORITHM} Credential=${this.options.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return fetch(url, { method, headers, body });
  }

  private failure(code: string, status: number): StorageError {
    return new StorageError(
      code,
      `Falha no armazenamento S3-compatible (HTTP ${status})`,
    );
  }

  async upload({ key, body, contentType }: UploadInput): Promise<void> {
    const response = await this.send("PUT", key, body, contentType);
    if (!response.ok) {
      throw this.failure("STORAGE_WRITE_FAILED", response.status);
    }
  }

  async delete(key: string): Promise<void> {
    const response = await this.send("DELETE", key);
    if (!response.ok && response.status !== 404) {
      throw this.failure("STORAGE_DELETE_FAILED", response.status);
    }
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.send("GET", key);
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      throw this.failure("STORAGE_READ_FAILED", response.status);
    }
    const body = Buffer.from(await response.arrayBuffer());
    return { body, byteSize: body.byteLength };
  }

  async exists(key: string): Promise<boolean> {
    const response = await this.send("HEAD", key);
    if (response.status === 404) {
      return false;
    }
    if (!response.ok) {
      throw this.failure("STORAGE_READ_FAILED", response.status);
    }
    return true;
  }
}
