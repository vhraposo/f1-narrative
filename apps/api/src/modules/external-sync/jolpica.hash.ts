import { createHash } from "node:crypto";

export function computeContentHash(value: unknown): string {
  const canonical = canonicalize(value);
  return createHash("sha256").update(canonical).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record).sort();
    const parts = keys.map((key) => {
      return `${JSON.stringify(key)}:${canonicalize(record[key])}`;
    });
    return `{${parts.join(",")}}`;
  }
  return JSON.stringify(value);
}