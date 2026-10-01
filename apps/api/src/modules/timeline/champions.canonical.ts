export type CanonicalChampion = {
  readonly year: number;
  readonly driverName: string;
};

export const CANONICAL_CHAMPIONS_SOURCE = {
  provider: "FIA_CANONICAL_CHRONOLOGY",
  sourceVersion: "2000-2025",
  license: "FACTUAL_REFERENCE",
  description:
    "Lista factual de campeões mundiais de F1 (2000-2025) verificada contra a cronologia oficial da FIA; usada como fallback quando o espelho externo não possui o standing final da temporada.",
} as const;

export const FIA_CANONICAL_CHAMPIONS_2000_2025: readonly CanonicalChampion[] = [
  { year: 2000, driverName: "Michael Schumacher" },
  { year: 2001, driverName: "Michael Schumacher" },
  { year: 2002, driverName: "Michael Schumacher" },
  { year: 2003, driverName: "Michael Schumacher" },
  { year: 2004, driverName: "Michael Schumacher" },
  { year: 2005, driverName: "Fernando Alonso" },
  { year: 2006, driverName: "Fernando Alonso" },
  { year: 2007, driverName: "Kimi Räikkönen" },
  { year: 2008, driverName: "Lewis Hamilton" },
  { year: 2009, driverName: "Jenson Button" },
  { year: 2010, driverName: "Sebastian Vettel" },
  { year: 2011, driverName: "Sebastian Vettel" },
  { year: 2012, driverName: "Sebastian Vettel" },
  { year: 2013, driverName: "Sebastian Vettel" },
  { year: 2014, driverName: "Lewis Hamilton" },
  { year: 2015, driverName: "Lewis Hamilton" },
  { year: 2016, driverName: "Nico Rosberg" },
  { year: 2017, driverName: "Lewis Hamilton" },
  { year: 2018, driverName: "Lewis Hamilton" },
  { year: 2019, driverName: "Lewis Hamilton" },
  { year: 2020, driverName: "Lewis Hamilton" },
  { year: 2021, driverName: "Max Verstappen" },
  { year: 2022, driverName: "Max Verstappen" },
  { year: 2023, driverName: "Max Verstappen" },
  { year: 2024, driverName: "Max Verstappen" },
  { year: 2025, driverName: "Lando Norris" },
];

const CANONICAL_BY_YEAR = new Map(
  FIA_CANONICAL_CHAMPIONS_2000_2025.map((entry) => [entry.year, entry]),
);

export function canonicalChampionForYear(year: number): CanonicalChampion | null {
  return CANONICAL_BY_YEAR.get(year) ?? null;
}

export function normalizeChampionName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalNameMatches(
  externalName: string | null | undefined,
  canonicalName: string,
): boolean {
  if (!externalName) return false;
  const external = normalizeChampionName(externalName).split(" ").filter(Boolean);
  const canonical = normalizeChampionName(canonicalName).split(" ").filter(Boolean);
  if (external.length === 0 || canonical.length === 0) return false;
  const externalSurname = external[external.length - 1];
  const canonicalSurname = canonical[canonical.length - 1];
  if (externalSurname !== canonicalSurname) return false;
  const externalFirst = external[0] ?? "";
  const canonicalFirst = canonical[0] ?? "";
  return (
    externalFirst === canonicalFirst ||
    externalFirst.charAt(0) === canonicalFirst.charAt(0)
  );
}
