export type NationalityInfo = {
  iso: string | null;
  flag: string | null;
  palette: {
    primary: string;
    secondary: string;
    accent: string;
  } | null;
};

function isoToFlag(iso: string): string {
  return iso
    .toUpperCase()
    .split("")
    .map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65))
    .join("");
}

const MAP: Record<string, NationalityInfo> = {
  britisher: { iso: "GB", flag: isoToFlag("GB"), palette: { primary: "#c8102e", secondary: "#012169", accent: "#ffffff" } },
  "britânico": { iso: "GB", flag: isoToFlag("GB"), palette: { primary: "#c8102e", secondary: "#012169", accent: "#ffffff" } },
  britânica: { iso: "GB", flag: isoToFlag("GB"), palette: { primary: "#c8102e", secondary: "#012169", accent: "#ffffff" } },
  british: { iso: "GB", flag: isoToFlag("GB"), palette: { primary: "#c8102e", secondary: "#012169", accent: "#ffffff" } },
  english: { iso: "GB", flag: isoToFlag("GB"), palette: { primary: "#c8102e", secondary: "#012169", accent: "#ffffff" } },

  dutch: { iso: "NL", flag: isoToFlag("NL"), palette: { primary: "#ae1c28", secondary: "#ffffff", accent: "#21468b" } },
  holandês: { iso: "NL", flag: isoToFlag("NL"), palette: { primary: "#ae1c28", secondary: "#ffffff", accent: "#21468b" } },
  holandesa: { iso: "NL", flag: isoToFlag("NL"), palette: { primary: "#ae1c28", secondary: "#ffffff", accent: "#21468b" } },
  netherlands: { iso: "NL", flag: isoToFlag("NL"), palette: { primary: "#ae1c28", secondary: "#ffffff", accent: "#21468b" } },

  brazilian: { iso: "BR", flag: isoToFlag("BR"), palette: { primary: "#009c3b", secondary: "#ffdf00", accent: "#002776" } },
  brasileira: { iso: "BR", flag: isoToFlag("BR"), palette: { primary: "#009c3b", secondary: "#ffdf00", accent: "#002776" } },
  brasileiro: { iso: "BR", flag: isoToFlag("BR"), palette: { primary: "#009c3b", secondary: "#ffdf00", accent: "#002776" } },

  french: { iso: "FR", flag: isoToFlag("FR"), palette: { primary: "#002395", secondary: "#ed2939", accent: "#ffffff" } },
  francesa: { iso: "FR", flag: isoToFlag("FR"), palette: { primary: "#002395", secondary: "#ed2939", accent: "#ffffff" } },
  francês: { iso: "FR", flag: isoToFlag("FR"), palette: { primary: "#002395", secondary: "#ed2939", accent: "#ffffff" } },
  france: { iso: "FR", flag: isoToFlag("FR"), palette: { primary: "#002395", secondary: "#ed2939", accent: "#ffffff" } },

  mexican: { iso: "MX", flag: isoToFlag("MX"), palette: { primary: "#006847", secondary: "#ce1126", accent: "#ffffff" } },
  mexicana: { iso: "MX", flag: isoToFlag("MX"), palette: { primary: "#006847", secondary: "#ce1126", accent: "#ffffff" } },
  mexicano: { iso: "MX", flag: isoToFlag("MX"), palette: { primary: "#006847", secondary: "#ce1126", accent: "#ffffff" } },

  italian: { iso: "IT", flag: isoToFlag("IT"), palette: { primary: "#009246", secondary: "#ce2b37", accent: "#ffffff" } },
  italiana: { iso: "IT", flag: isoToFlag("IT"), palette: { primary: "#009246", secondary: "#ce2b37", accent: "#ffffff" } },
  italiano: { iso: "IT", flag: isoToFlag("IT"), palette: { primary: "#009246", secondary: "#ce2b37", accent: "#ffffff" } },

  spanish: { iso: "ES", flag: isoToFlag("ES"), palette: { primary: "#aa151b", secondary: "#f1bf00", accent: "#ffffff" } },
  espanhola: { iso: "ES", flag: isoToFlag("ES"), palette: { primary: "#aa151b", secondary: "#f1bf00", accent: "#ffffff" } },
  espanhol: { iso: "ES", flag: isoToFlag("ES"), palette: { primary: "#aa151b", secondary: "#f1bf00", accent: "#ffffff" } },
  spain: { iso: "ES", flag: isoToFlag("ES"), palette: { primary: "#aa151b", secondary: "#f1bf00", accent: "#ffffff" } },

  monegasque: { iso: "MC", flag: isoToFlag("MC"), palette: { primary: "#ce1126", secondary: "#ffffff", accent: "#ffffff" } },
  monegasco: { iso: "MC", flag: isoToFlag("MC"), palette: { primary: "#ce1126", secondary: "#ffffff", accent: "#ffffff" } },

  canadian: { iso: "CA", flag: isoToFlag("CA"), palette: { primary: "#ff0000", secondary: "#ffffff", accent: "#ff0000" } },
  canadense: { iso: "CA", flag: isoToFlag("CA"), palette: { primary: "#ff0000", secondary: "#ffffff", accent: "#ff0000" } },

  japanese: { iso: "JP", flag: isoToFlag("JP"), palette: { primary: "#bc002d", secondary: "#ffffff", accent: "#bc002d" } },
  japonesa: { iso: "JP", flag: isoToFlag("JP"), palette: { primary: "#bc002d", secondary: "#ffffff", accent: "#bc002d" } },
  japonês: { iso: "JP", flag: isoToFlag("JP"), palette: { primary: "#bc002d", secondary: "#ffffff", accent: "#bc002d" } },

  thai: { iso: "TH", flag: isoToFlag("TH"), palette: { primary: "#a51931", secondary: "#f4f5f8", accent: "#2d2a4a" } },
  tailandesa: { iso: "TH", flag: isoToFlag("TH"), palette: { primary: "#a51931", secondary: "#f4f5f8", accent: "#2d2a4a" } },

  german: { iso: "DE", flag: isoToFlag("DE"), palette: { primary: "#000000", secondary: "#dd0000", accent: "#ffcc00" } },
  alemã: { iso: "DE", flag: isoToFlag("DE"), palette: { primary: "#000000", secondary: "#dd0000", accent: "#ffcc00" } },
  alemão: { iso: "DE", flag: isoToFlag("DE"), palette: { primary: "#000000", secondary: "#dd0000", accent: "#ffcc00" } },

  "new zealander": { iso: "NZ", flag: isoToFlag("NZ"), palette: { primary: "#00247d", secondary: "#cc142b", accent: "#ffffff" } },
  neozelandesa: { iso: "NZ", flag: isoToFlag("NZ"), palette: { primary: "#00247d", secondary: "#cc142b", accent: "#ffffff" } },

  argentine: { iso: "AR", flag: isoToFlag("AR"), palette: { primary: "#74acdf", secondary: "#f6b40e", accent: "#ffffff" } },
  argentina: { iso: "AR", flag: isoToFlag("AR"), palette: { primary: "#74acdf", secondary: "#f6b40e", accent: "#ffffff" } },

  finnish: { iso: "FI", flag: isoToFlag("FI"), palette: { primary: "#003580", secondary: "#ffffff", accent: "#003580" } },
  finlandesa: { iso: "FI", flag: isoToFlag("FI"), palette: { primary: "#003580", secondary: "#ffffff", accent: "#003580" } },

  australian: { iso: "AU", flag: isoToFlag("AU"), palette: { primary: "#00008b", secondary: "#cc142b", accent: "#ffffff" } },
  australiana: { iso: "AU", flag: isoToFlag("AU"), palette: { primary: "#00008b", secondary: "#cc142b", accent: "#ffffff" } },
};

export function resolveNationality(nationality: string): NationalityInfo {
  const key = nationality.toLowerCase().trim();
  return (
    MAP[key] ?? { iso: null, flag: null, palette: null }
  );
}