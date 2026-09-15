export type TeamVisualIdentity = {
  primary: string;
  secondary?: string | null;
  accent?: string | null;
  foreground?: string | null;
};

export type ResolvedTeamIdentity = {
  primary: string;
  secondary: string;
  accent: string;
  foreground: string;
  muted: string;
  border: string;
  gradient: string;
};

export function parseHex(hex: string): [number, number, number] {
  const h = hex.replace(/^#/, "");
  let r: number;
  let g: number;
  let b: number;
  if (h.length === 3) {
    r = parseInt(h[0] + h[0], 16);
    g = parseInt(h[1] + h[1], 16);
    b = parseInt(h[2] + h[2], 16);
  } else if (h.length === 6) {
    r = parseInt(h.slice(0, 2), 16);
    g = parseInt(h.slice(2, 4), 16);
    b = parseInt(h.slice(4, 6), 16);
  } else {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  if ([r, g, b].some((c) => isNaN(c))) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  return [r, g, b];
}

export function formatHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = parseHex(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

type TeamIdentityCatalogEntry = ResolvedTeamIdentity & {
  aliases: readonly string[];
};

function teamIdentity(
  aliases: readonly string[],
  primary: string,
  secondary: string,
  accent: string,
  foreground: string,
): TeamIdentityCatalogEntry {
  return {
    aliases,
    primary,
    secondary,
    accent,
    foreground,
    muted: withAlpha(foreground, 0.78),
    border: withAlpha(foreground, 0.55),
    gradient: `linear-gradient(135deg, ${primary} 0%, ${secondary} 58%, ${accent} 100%)`,
  };
}

export const TEAM_IDENTITIES_2026: Record<string, TeamIdentityCatalogEntry> = {
  mercedes: teamIdentity(
    ["mercedes", "petronas"],
    "#00a19b",
    "#151515",
    "#c7cdd1",
    "#ffffff",
  ),
  ferrari: teamIdentity(
    ["ferrari"],
    "#e80020",
    "#7a0011",
    "#f7f7f7",
    "#ffffff",
  ),
  mclaren: teamIdentity(
    ["mclaren"],
    "#ff8000",
    "#1d1d1b",
    "#00a19b",
    "#111827",
  ),
  redBull: teamIdentity(
    ["red bull racing", "red bull"],
    "#1e41ff",
    "#07134d",
    "#ff1e32",
    "#ffffff",
  ),
  racingBulls: teamIdentity(
    ["racing bulls", "visa cash app", "rb f1 team"],
    "#6692ff",
    "#f6f8ff",
    "#1f4bc5",
    "#111827",
  ),
  alpine: teamIdentity(
    ["alpine"],
    "#0093cc",
    "#173b8f",
    "#ff87bc",
    "#ffffff",
  ),
  haas: teamIdentity(
    ["haas"],
    "#ffffff",
    "#151515",
    "#ed1c24",
    "#111827",
  ),
  audi: teamIdentity(
    ["audi"],
    "#b0b4b7",
    "#111111",
    "#d52b1e",
    "#ffffff",
  ),
  williams: teamIdentity(
    ["williams"],
    "#64c4ff",
    "#0057b8",
    "#ffffff",
    "#111827",
  ),
  astonMartin: teamIdentity(
    ["aston martin"],
    "#006f62",
    "#004c45",
    "#c7f4dd",
    "#ffffff",
  ),
  cadillac: teamIdentity(
    ["cadillac"],
    "#121212",
    "#f5f5f5",
    "#a51c30",
    "#ffffff",
  ),
};

function normalizedTeamName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function teamIdentityFor(name: string | null | undefined): ResolvedTeamIdentity | null {
  if (!name) return null;
  const normalized = normalizedTeamName(name);
  const entry = Object.values(TEAM_IDENTITIES_2026).find((candidate) =>
    candidate.aliases.some((alias) => normalized.includes(alias)),
  );
  if (!entry) return null;
  const { aliases: _, ...identity } = entry;
  return identity;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = parseHex(hex);
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

export function contrastRatio(hex1: string, hex2: string): number {
  const l1 = relativeLuminance(hex1);
  const l2 = relativeLuminance(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

export function foregroundFor(hex: string): string {
  const white = "#ffffff";
  const dark = "#111827";
  return contrastRatio(hex, white) >= contrastRatio(hex, dark) ? white : dark;
}

export function deriveSecondary(primary: string): string {
  const [r, g, b] = parseHex(primary);
  return formatHex(
    clamp(r + 18),
    clamp(g + 14),
    clamp(b + 10),
  );
}

export function deriveAccent(primary: string): string {
  const [h, s, l] = rgbToHsl(...parseHex(primary));
  const h2 = (h + 18) % 360;
  return formatHex(...hslToRgb(h2, s, l));
}

function clamp(v: number): number {
  return Math.max(0, Math.min(255, Math.round(v)));
}

function rgbToHsl(
  r: number,
  g: number,
  b: number,
): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}

function hslToRgb(
  h: number,
  s: number,
  l: number,
): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const c = (1 - Math.abs(2 * ln - 1)) * sn;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = ln - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else { r = c; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export function resolveTeamIdentity(
  team: {
    name?: string | null;
    color?: string | null;
    visualIdentity?: TeamVisualIdentity | null;
  },
): ResolvedTeamIdentity | null {
  const catalogIdentity = team.visualIdentity
    ? null
    : teamIdentityFor(team.name);
  const primary = team.visualIdentity?.primary ?? catalogIdentity?.primary ?? team.color;
  if (!primary) return null;

  const secondary =
    team.visualIdentity?.secondary ?? catalogIdentity?.secondary ?? deriveSecondary(primary);
  const accent =
    team.visualIdentity?.accent ?? catalogIdentity?.accent ?? deriveAccent(primary);
  const foreground =
    team.visualIdentity?.foreground ?? catalogIdentity?.foreground ?? foregroundFor(primary);

  return {
    primary,
    secondary,
    accent,
    foreground,
    muted: catalogIdentity?.muted ?? withAlpha(foreground, 0.78),
    border: catalogIdentity?.border ?? withAlpha(foreground, 0.55),
    gradient:
      catalogIdentity?.gradient ??
      `linear-gradient(135deg, ${primary} 0%, ${secondary} 58%, ${accent} 100%)`,
  };
}
