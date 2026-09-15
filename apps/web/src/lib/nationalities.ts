import { foregroundFor, withAlpha } from "./team-identity";

export type NationalityPalette = {
  primary: string;
  secondary: string;
  accent: string;
  foreground: string;
  muted: string;
  border: string;
  glow: string;
  gradient: string;
};

export type NationalityInfo = {
  iso: string | null;
  countryName: string | null;
  flagUrl: string | null;
  palette: NationalityPalette | null;
};

export function flagUrlForIso(iso: string): string {
  return `https://flags.restcountries.com/v5/svg/${iso.toLowerCase()}.svg`;
}

function palette(
  primary: string,
  secondary: string,
  accent: string,
): NationalityPalette {
  const foreground = foregroundFor(primary);
  return {
    primary,
    secondary,
    accent,
    foreground,
    muted: withAlpha(foreground, 0.75),
    border: withAlpha(accent, 0.35),
    glow: withAlpha(accent, 0.14),
    gradient: `linear-gradient(135deg, ${withAlpha(primary, 0.16)} 0%, ${withAlpha(secondary, 0.14)} 52%, ${withAlpha(accent, 0.16)} 100%)`,
  };
}

function nationality(
  iso: string,
  countryName: string,
  primary: string,
  secondary: string,
  accent: string,
): NationalityInfo {
  return {
    iso,
    countryName,
    flagUrl: flagUrlForIso(iso),
    palette: palette(primary, secondary, accent),
  };
}

const UNITED_KINGDOM = nationality("GB", "United Kingdom", "#c8102e", "#ffffff", "#012169");
const NETHERLANDS = nationality("NL", "Netherlands", "#ae1c28", "#ffffff", "#21468b");
const BRAZIL = nationality("BR", "Brazil", "#009c3b", "#ffdf00", "#002776");
const FRANCE = nationality("FR", "France", "#002395", "#ffffff", "#ed2939");
const MEXICO = nationality("MX", "Mexico", "#006847", "#ffffff", "#ce1126");
const ITALY = nationality("IT", "Italy", "#009246", "#ffffff", "#ce2b37");
const SPAIN = nationality("ES", "Spain", "#aa151b", "#f1bf00", "#ffffff");
const MONACO = nationality("MC", "Monaco", "#ce1126", "#ffffff", "#ce1126");
const CANADA = nationality("CA", "Canada", "#ff0000", "#ffffff", "#ff0000");
const JAPAN = nationality("JP", "Japan", "#bc002d", "#ffffff", "#bc002d");
const THAILAND = nationality("TH", "Thailand", "#a51931", "#f4f5f8", "#2d2a4a");
const GERMANY = nationality("DE", "Germany", "#000000", "#dd0000", "#ffcc00");
const NEW_ZEALAND = nationality("NZ", "New Zealand", "#00247d", "#cc142b", "#ffffff");
const ARGENTINA = nationality("AR", "Argentina", "#74acdf", "#f6b40e", "#ffffff");
const FINLAND = nationality("FI", "Finland", "#003580", "#ffffff", "#003580");
const AUSTRALIA = nationality("AU", "Australia", "#00008b", "#cc142b", "#ffffff");

const MAP: Record<string, NationalityInfo> = {
  britisher: UNITED_KINGDOM,
  "britânico": UNITED_KINGDOM,
  britânica: UNITED_KINGDOM,
  british: UNITED_KINGDOM,
  english: UNITED_KINGDOM,
  dutch: NETHERLANDS,
  holandês: NETHERLANDS,
  holandesa: NETHERLANDS,
  netherlands: NETHERLANDS,
  brazilian: BRAZIL,
  brasileira: BRAZIL,
  brasileiro: BRAZIL,
  brazil: BRAZIL,
  french: FRANCE,
  francesa: FRANCE,
  francês: FRANCE,
  france: FRANCE,
  mexican: MEXICO,
  mexicana: MEXICO,
  mexicano: MEXICO,
  mexico: MEXICO,
  italian: ITALY,
  italiana: ITALY,
  italiano: ITALY,
  italy: ITALY,
  spanish: SPAIN,
  espanhola: SPAIN,
  espanhol: SPAIN,
  spain: SPAIN,
  monegasque: MONACO,
  monegasco: MONACO,
  canadian: CANADA,
  canadense: CANADA,
  japanese: JAPAN,
  japonesa: JAPAN,
  japonês: JAPAN,
  thai: THAILAND,
  tailandesa: THAILAND,
  german: GERMANY,
  alemã: GERMANY,
  alemão: GERMANY,
  "new zealander": NEW_ZEALAND,
  neozelandesa: NEW_ZEALAND,
  argentine: ARGENTINA,
  argentina: ARGENTINA,
  finnish: FINLAND,
  finlandesa: FINLAND,
  australian: AUSTRALIA,
  australiana: AUSTRALIA,
};

export function resolveNationality(nationality: string): NationalityInfo {
  const key = nationality.toLowerCase().trim();
  return MAP[key] ?? { iso: null, countryName: null, flagUrl: null, palette: null };
}
