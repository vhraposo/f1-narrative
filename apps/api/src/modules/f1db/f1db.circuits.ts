import { getF1dbDataset, type F1dbCircuit, type F1dbCircuitLayout } from "./f1db.dataset.js";

const CIRCUIT_ID_ALIASES: Record<string, string> = {
  albert_park: "melbourne",
  americas: "austin",
  catalunya: "catalunya",
  hockenheimring: "hockenheimring",
  indy: "indianapolis",
  jacarepagua: "jacarepagua",
  losail: "lusail",
  magny_cours: "magny-cours",
  marina_bay: "marina-bay",
  montjuic: "montjuic",
  mugello: "mugello",
  nurburgring: "nurburgring",
  paul_ricard: "paul-ricard",
  portimao: "algarve",
  red_bull_ring: "spielberg",
  ricard: "paul-ricard",
  rodriguez: "mexico-city",
  sepang: "sepang",
  spa: "spa-francorchamps",
  vegas: "las-vegas",
  villeneuve: "montreal",
  watkins_glen: "watkins-glen",
  yas_marina: "yas-marina",
  yeongam: "korea",
  zandvoort: "zandvoort",
};

function slug(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function resolveF1dbCircuitId(input: {
  externalId: string | null;
  name: string;
}): string | null {
  const dataset = getF1dbDataset();
  if (!dataset) return null;
  const candidates: string[] = [];
  if (input.externalId) {
    const alias = CIRCUIT_ID_ALIASES[input.externalId];
    if (alias) candidates.push(alias);
    candidates.push(input.externalId);
    candidates.push(input.externalId.replace(/_/g, "-"));
  }
  for (const candidate of candidates) {
    if (dataset.circuitsById.has(candidate)) return candidate;
  }
  const nameSlug = slug(input.name);
  if (nameSlug.length > 0) {
    for (const circuit of dataset.circuits) {
      if (slug(circuit.fullName) === nameSlug || slug(circuit.name) === nameSlug) {
        return circuit.id;
      }
    }
  }
  return null;
}

export type F1dbCircuitInfo = {
  readonly circuit: F1dbCircuit;
  readonly layouts: readonly F1dbCircuitLayout[];
  readonly effectiveLayout: F1dbCircuitLayout | null;
  readonly firstRaceYear: number | null;
  readonly lastRaceYear: number | null;
  readonly raceCount: number;
};

export function getF1dbCircuitInfo(circuitId: string): F1dbCircuitInfo | null {
  const dataset = getF1dbDataset();
  if (!dataset) return null;
  const circuit = dataset.circuitsById.get(circuitId);
  if (!circuit) return null;
  const layouts = [...(dataset.layoutsByCircuitId.get(circuitId) ?? [])].sort((a, b) =>
    a.id.localeCompare(b.id),
  );
  const circuitRaces = dataset.races.filter((race) => race.circuitId === circuitId);
  const years = circuitRaces.map((race) => race.year);
  const effectiveLayout =
    layouts.find((layout) => layout.effective) ?? layouts[layouts.length - 1] ?? null;
  return {
    circuit,
    layouts,
    effectiveLayout,
    firstRaceYear: years.length > 0 ? Math.min(...years) : null,
    lastRaceYear: years.length > 0 ? Math.max(...years) : null,
    raceCount: circuitRaces.length,
  };
}

export function f1dbCircuitRaceName(
  circuitId: string,
  year: number,
): { officialName: string | null; grandPrixId: string | null; layoutId: string | null } | null {
  const dataset = getF1dbDataset();
  if (!dataset) return null;
  const race = dataset.races.find(
    (entry) => entry.circuitId === circuitId && entry.year === year,
  );
  if (!race) return null;
  return {
    officialName: race.officialName,
    grandPrixId: race.grandPrixId,
    layoutId: race.circuitLayoutId,
  };
}
