import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertTrackProfileInvariants,
  validateTrackProfileDataset,
  type TrackProfileDataset,
} from "./track-profile.js";

let cached: TrackProfileDataset | null | undefined;

function defaultPath(): string {
  return path.resolve(process.cwd(), "..", "..", "data", "v5", "track-profiles.v1.json");
}

export function loadTrackProfileDataset(filePath: string = defaultPath()): TrackProfileDataset {
  if (filePath === defaultPath() && cached !== undefined) {
    if (cached === null) throw new Error("track-profiles.v1.json indisponível");
    return cached;
  }
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch {
    if (filePath === defaultPath()) cached = null;
    throw new Error(`track-profiles indisponível em ${filePath}`);
  }
  const parsed = validateTrackProfileDataset(JSON.parse(raw) as unknown);
  assertTrackProfileInvariants(parsed);
  if (filePath === defaultPath()) cached = parsed;
  return parsed;
}

export function resetTrackProfileDatasetCache(): void {
  cached = undefined;
}
