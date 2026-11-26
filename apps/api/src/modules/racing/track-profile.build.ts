import {
  TRACK_PROFILE_SCHEMA_VERSION,
  TRACK_UNAVAILABLE_FIELDS,
  type TrackProfile,
  type TrackProfileDataset,
  type TrackSource,
  type TrackWeatherMonth,
} from "./track-profile.js";

export type BuildCircuit = {
  readonly id: string;
  readonly name: string;
  readonly fullName: string;
  readonly countryId: string;
  readonly type: string;
  readonly direction: string;
  readonly placeName: string;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly lengthKm: number | null;
  readonly turns: number | null;
};

export type BuildRace = {
  readonly id: string;
  readonly year: number;
  readonly round: number;
  readonly officialName: string;
  readonly circuitId: string;
  readonly circuitLayoutId: string | null;
  readonly laps: number | null;
  readonly turns: number | null;
  readonly courseLengthKm: number | null;
  readonly date: string | null;
};

export type BuildResult = {
  readonly raceId: string;
  readonly positionNumber: number | null;
  readonly positionText: string;
  readonly gridPositionNumber: number | null;
  readonly reasonRetired: string;
  readonly positionsGained: number | null;
  readonly pitStops: number | null;
};

export type WeatherSource = "open-meteo" | "nasa-power";

export type BuildWeather = {
  readonly circuitId: string;
  readonly months: readonly TrackWeatherMonth[];
  readonly source: WeatherSource;
};

const F1DB_SOURCE: TrackSource = {
  name: "F1DB",
  url: "https://github.com/f1db/f1db",
  license: "CC BY 4.0",
  note: "circuitos, calendário, grids, posições e abandono (snapshot local)",
};

const OPEN_METEO_SOURCE: TrackSource = {
  name: "Open-Meteo Historical Weather API",
  url: "https://open-meteo.com/en/docs/historical-weather-api",
  license: "CC BY 4.0",
  note: "climatologia ERA5/ERA5-Land por coordenada do circuito (2015-2025)",
};

const NASA_POWER_SOURCE: TrackSource = {
  name: "NASA POWER Daily API",
  url: "https://power.larc.nasa.gov/docs/services/api/temporal/daily/",
  license: "NASA open data",
  note: "climatologia diária por coordenada (2015-2025); fallback quando Open-Meteo indisponível",
};

function monthOf(date: string | null): number | null {
  if (!date) return null;
  const month = Number(date.slice(5, 7));
  return Number.isInteger(month) && month >= 1 && month <= 12 ? month : null;
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function rankPercentile(values: readonly number[], target: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length <= 1) return 0.5;
  const first = sorted.indexOf(target);
  const last = sorted.lastIndexOf(target);
  const rank = (first + last) / 2;
  return rank / (sorted.length - 1);
}

export function buildTrackProfileDataset(input: {
  readonly targetYear: number;
  readonly generatedAt: string;
  readonly sourceVersion: string;
  readonly circuits: readonly BuildCircuit[];
  readonly races: readonly BuildRace[];
  readonly results: readonly BuildResult[];
  readonly weather: readonly BuildWeather[];
}): TrackProfileDataset {
  const circuitsById = new Map(input.circuits.map((circuit) => [circuit.id, circuit]));
  const racesById = new Map(input.races.map((race) => [race.id, race]));
  const weatherByCircuit = new Map(input.weather.map((entry) => [entry.circuitId, entry]));
  const resultsByRace = new Map<string, BuildResult[]>();
  for (const result of input.results) {
    const list = resultsByRace.get(result.raceId) ?? [];
    list.push(result);
    resultsByRace.set(result.raceId, list);
  }

  const targetRaces = input.races
    .filter((race) => race.year === input.targetYear)
    .sort((a, b) => a.round - b.round);
  const seen = new Set<string>();
  const raw = targetRaces.flatMap((race) => {
    if (seen.has(race.circuitId)) return [];
    seen.add(race.circuitId);
    const circuit = circuitsById.get(race.circuitId);
    if (!circuit) return [];

    const historyRaces = input.races.filter(
      (entry) =>
        entry.circuitId === race.circuitId &&
        entry.year < input.targetYear &&
        entry.year >= input.targetYear - 12 &&
        (race.circuitLayoutId === null || entry.circuitLayoutId === race.circuitLayoutId),
    );
    const historyResults = historyRaces.flatMap((entry) => resultsByRace.get(entry.id) ?? []);
    const starts = historyResults.length;
    const retirements = historyResults.filter((result) => result.reasonRetired.trim().length > 0);
    const gains = historyResults
      .filter(
        (result) =>
          result.positionNumber !== null &&
          result.gridPositionNumber !== null &&
          result.gridPositionNumber > 0 &&
          result.positionsGained !== null,
      )
      .map((result) => result.positionsGained as number);
    const pitStops = historyResults
      .filter((result) => result.pitStops !== null)
      .map((result) => result.pitStops as number);
    const allCircuitRaces = input.races.filter((entry) => entry.circuitId === race.circuitId);
    const years = allCircuitRaces.map((entry) => entry.year);
    const weatherEntry = weatherByCircuit.get(race.circuitId) ?? null;
    const months = weatherEntry?.months ?? null;
    const weatherSource = weatherEntry?.source ?? null;
    const eventMonth = monthOf(race.date);

    return [
      {
        circuitId: race.circuitId,
        name: circuit.name,
        officialName: race.officialName,
        country: circuit.countryId,
        city: circuit.placeName || null,
        type: circuit.type,
        direction: circuit.direction,
        latitude: circuit.latitude,
        longitude: circuit.longitude,
        lengthKm: race.courseLengthKm ?? circuit.lengthKm,
        laps: race.laps,
        turns: race.turns ?? circuit.turns,
        layoutId: race.circuitLayoutId,
        eventMonth,
        firstRaceYear: years.length > 0 ? Math.min(...years) : null,
        racesHeld: allCircuitRaces.length,
        derived: {
          dnfRate: starts > 0 ? round(retirements.length / starts, 3) : null,
          avgPositionsGained:
            gains.length > 0
              ? round(gains.reduce((sum, value) => sum + value, 0) / gains.length, 2)
              : null,
          pitStopsPerRace:
            pitStops.length > 0
              ? round(pitStops.reduce((sum, value) => sum + value, 0) / pitStops.length, 2)
              : null,
          overtakingDifficulty: null as number | null,
          sampleStarts: starts,
          confidence:
            starts > 0 ? round(0.3 + 0.5 * Math.min(1, starts / 120) + (months ? 0.1 : 0), 2) : 0.2,
        },
        weather: months
          ? {
              eventMonthRainProbability:
                eventMonth !== null
                  ? (months.find((month) => month.month === eventMonth)?.rainDayProbability ?? null)
                  : null,
              months: [...months],
            }
          : null,
        unavailable: [...TRACK_UNAVAILABLE_FIELDS, ...(months ? [] : ["weather"])],
        sources: [
          F1DB_SOURCE,
          ...(weatherSource === "nasa-power"
            ? [NASA_POWER_SOURCE]
            : weatherSource === "open-meteo"
              ? [OPEN_METEO_SOURCE]
              : []),
        ],
        confidence: months ? 0.6 : 0.4,
      },
    ];
  });

  const gainsForDifficulty = raw
    .map((entry) => entry.derived.avgPositionsGained)
    .filter((value): value is number => value !== null);
  for (const entry of raw) {
    const gain = entry.derived.avgPositionsGained;
    entry.derived.overtakingDifficulty =
      gain !== null && gainsForDifficulty.length > 1
        ? Math.max(1, Math.min(10, Math.round(1 + (1 - rankPercentile(gainsForDifficulty, gain)) * 9)))
        : null;
    entry.confidence = round(
      0.35 + 0.35 * entry.derived.confidence + (entry.weather ? 0.2 : 0),
      2,
    );
  }

  const usedSources = new Set(input.weather.map((entry) => entry.source));
  return {
    schemaVersion: TRACK_PROFILE_SCHEMA_VERSION,
    generatedAt: input.generatedAt,
    sourceVersion: input.sourceVersion,
    targetYear: input.targetYear,
    circuits: raw as TrackProfile[],
    sources: [
      F1DB_SOURCE,
      ...(usedSources.has("open-meteo") ? [OPEN_METEO_SOURCE] : []),
      ...(usedSources.has("nasa-power") ? [NASA_POWER_SOURCE] : []),
    ],
  };
}
