import { Buffer } from "node:buffer";

export const ALLOWED_IMAGE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
] as const;

export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

const EXTENSION_BY_MIME: Record<AllowedImageMime, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isAllowedImageMime(value: string): value is AllowedImageMime {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(value);
}

export function detectImageMime(buffer: Buffer): AllowedImageMime | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.toString("ascii", 0, 4) === "RIFF" &&
    buffer.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function extensionForMime(mime: AllowedImageMime): string {
  return EXTENSION_BY_MIME[mime];
}

export function sanitizeOriginalFilename(value: string | undefined): string | null {
  if (!value) return null;
  const base = value.split(/[\\/]/).pop()?.trim() ?? "";
  if (!base) return null;
  return base.slice(0, 200);
}
