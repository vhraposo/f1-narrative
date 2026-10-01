import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { env } from "../../config/env.js";
import { getF1dbCircuitInfo, resolveF1dbCircuitId } from "./f1db.circuits.js";

export const F1DB_CIRCUITS_ATTRIBUTION = "f1-circuits-svg by ROY Jules — CC BY 4.0";
export const F1DB_CIRCUITS_LICENSE = "CC_BY_4_0";
export const F1DB_CIRCUITS_SOURCE = "f1db-circuits-svg";

export type CircuitSvgStyle = "black-outline" | "white-outline";

const MAX_SVG_BYTES = 200_000;

export function resolveF1dbCircuitsDir(): string | null {
  const candidates = [
    ...(env.F1DB_CIRCUITS_SVG_DIR ? [path.resolve(env.F1DB_CIRCUITS_SVG_DIR)] : []),
    path.resolve(process.cwd(), "..", "..", "data", "external", "f1-circuits-svg"),
    path.resolve(process.cwd(), "data", "external", "f1-circuits-svg"),
  ];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "circuits.json"))) return candidate;
  }
  return null;
}

// Sanitização defensiva: os assets vêm de repositório CC BY 4.0, mas o
// serviço nunca deve devolver script, foreignObject ou handlers de evento.
export function sanitizeCircuitSvg(raw: string): string | null {
  let svg = raw.trim();
  if (!svg.startsWith("<svg")) return null;
  if (svg.length > MAX_SVG_BYTES) return null;
  svg = svg.replace(/<script[\s\S]*?<\/script\s*>/gi, "");
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject\s*>/gi, "");
  svg = svg.replace(/\son[a-z]+\s*=\s*"[^"]*"/gi, "");
  svg = svg.replace(/\son[a-z]+\s*=\s*'[^']*'/gi, "");
  svg = svg.replace(/javascript:/gi, "");
  if (/<script/i.test(svg) || /<foreignObject/i.test(svg) || /\son[a-z]+\s*=/i.test(svg)) {
    return null;
  }
  return svg;
}

export type CircuitSvgResolution = {
  readonly svg: string;
  readonly layoutId: string;
  readonly style: CircuitSvgStyle;
  readonly source: string;
  readonly license: string;
  readonly attribution: string;
};

export function resolveCircuitSvg(input: {
  externalId: string | null;
  name: string;
  style?: CircuitSvgStyle;
}): CircuitSvgResolution | null {
  const dataDir = resolveF1dbCircuitsDir();
  if (!dataDir) return null;
  const circuitId = resolveF1dbCircuitId({
    externalId: input.externalId,
    name: input.name,
  });
  if (!circuitId) return null;
  const info = getF1dbCircuitInfo(circuitId);
  if (!info) return null;
  const style: CircuitSvgStyle = input.style ?? "black-outline";
  const orderedLayouts = [
    ...(info.effectiveLayout ? [info.effectiveLayout] : []),
    ...[...info.layouts].reverse(),
  ];
  for (const layout of orderedLayouts) {
    const file = path.join(dataDir, "minimal", style, `${layout.id}.svg`);
    if (!existsSync(file)) continue;
    const sanitized = sanitizeCircuitSvg(readFileSync(file, "utf8"));
    if (!sanitized) continue;
    return {
      svg: sanitized,
      layoutId: layout.id,
      style,
      source: F1DB_CIRCUITS_SOURCE,
      license: F1DB_CIRCUITS_LICENSE,
      attribution: F1DB_CIRCUITS_ATTRIBUTION,
    };
  }
  return null;
}
