import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { getF1dbDataset } from "../modules/f1db/f1db.dataset.js";
import {
  buildTrackProfileDataset,
  type BuildCircuit,
  type BuildRace,
  type BuildResult,
  type BuildWeather,
  type WeatherSource,
} from "../modules/racing/track-profile.build.js";
import {
  assertTrackProfileInvariants,
  validateTrackProfileDataset,
  type TrackWeatherMonth,
} from "../modules/racing/track-profile.js";

const OPEN_METEO_URL = "https://archive-api.open-meteo.com/v1/archive";
const NASA_POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily/point";
const START_DATE = "2015-01-01";
const END_DATE = "2025-12-31";

type OpenMeteoDaily = {
  time?: string[];
  rain_sum?: Array<number | null>;
  precipitation_sum?: Array<number | null>;
  temperature_2m_mean?: Array<number | null>;
  wind_speed_10m_max?: Array<number | null>;
};

type CoordinateCircuit = {
  id: string;
  latitude: number;
  longitude: number;
};

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function monthsFromDaily(daily: OpenMeteoDaily): TrackWeatherMonth[] {
  const buckets = new Map<
    number,
    { days: number; rainyDays: number; tempSum: number; tempCount: number; windSum: number; windCount: number }
  >();
  for (let index = 0; index < (daily.time?.length ?? 0); index += 1) {
    const date = daily.time?.[index];
    if (!date) continue;
    const month = Number(date.slice(5, 7));
    const bucket =
      buckets.get(month) ??
      { days: 0, rainyDays: 0, tempSum: 0, tempCount: 0, windSum: 0, windCount: 0 };
    bucket.days += 1;
    const rain = daily.rain_sum?.[index] ?? daily.precipitation_sum?.[index] ?? null;
    if (rain !== null && rain >= 1) bucket.rainyDays += 1;
    const temp = daily.temperature_2m_mean?.[index] ?? null;
    if (temp !== null) {
      bucket.tempSum += temp;
      bucket.tempCount += 1;
    }
    const wind = daily.wind_speed_10m_max?.[index] ?? null;
    if (wind !== null) {
      bucket.windSum += wind;
      bucket.windCount += 1;
    }
    buckets.set(month, bucket);
  }

  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const bucket = buckets.get(month);
    return {
      month,
      rainDayProbability: bucket && bucket.days > 0 ? round(bucket.rainyDays / bucket.days, 3) : 0,
      avgTempC: bucket && bucket.tempCount > 0 ? round(bucket.tempSum / bucket.tempCount, 1) : null,
      avgWindKmh: bucket && bucket.windCount > 0 ? round(bucket.windSum / bucket.windCount, 1) : null,
      sampleDays: bucket?.days ?? 0,
    };
  });
}

async function fetchOpenMeteoBatch(
  circuits: readonly CoordinateCircuit[],
): Promise<Map<string, TrackWeatherMonth[]>> {
  const url = new URL(OPEN_METEO_URL);
  url.searchParams.set("latitude", circuits.map((circuit) => circuit.latitude).join(","));
  url.searchParams.set("longitude", circuits.map((circuit) => circuit.longitude).join(","));
  url.searchParams.set("start_date", START_DATE);
  url.searchParams.set("end_date", END_DATE);
  url.searchParams.set("daily", "rain_sum,precipitation_sum,temperature_2m_mean,wind_speed_10m_max");
  url.searchParams.set("timezone", "auto");
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
  const body = (await response.json()) as
    | { daily?: OpenMeteoDaily }
    | Array<{ daily?: OpenMeteoDaily }>;
  const entries = Array.isArray(body) ? body : [body];
  const result = new Map<string, TrackWeatherMonth[]>();
  entries.forEach((entry, index) => {
    const circuit = circuits[index];
    if (circuit && entry.daily?.time?.length) {
      result.set(circuit.id, monthsFromDaily(entry.daily));
    }
  });
  return result;
}

async function fetchNasaMonths(circuit: CoordinateCircuit): Promise<TrackWeatherMonth[]> {
  const url = new URL(NASA_POWER_URL);
  url.searchParams.set("parameters", "PRECTOTCORR,T2M,WS2M");
  url.searchParams.set("community", "RE");
  url.searchParams.set("latitude", String(circuit.latitude));
  url.searchParams.set("longitude", String(circuit.longitude));
  url.searchParams.set("start", START_DATE.replace(/-/g, ""));
  url.searchParams.set("end", END_DATE.replace(/-/g, ""));
  url.searchParams.set("format", "JSON");
  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) throw new Error(`NASA POWER HTTP ${response.status}`);
  const body = (await response.json()) as {
    properties?: {
      parameter?: {
        PRECTOTCORR?: Record<string, number>;
        T2M?: Record<string, number>;
        WS2M?: Record<string, number>;
      };
    };
  };
  const parameter = body.properties?.parameter;
  if (!parameter?.PRECTOTCORR) throw new Error("NASA POWER sem PRECTOTCORR");
  const buckets = new Map<
    number,
    { days: number; rainyDays: number; tempSum: number; tempCount: number; windSum: number; windCount: number }
  >();
  for (const [date, rawRain] of Object.entries(parameter.PRECTOTCORR)) {
    const month = Number(date.slice(4, 6));
    const bucket =
      buckets.get(month) ??
      { days: 0, rainyDays: 0, tempSum: 0, tempCount: 0, windSum: 0, windCount: 0 };
    bucket.days += 1;
    if (Number.isFinite(rawRain) && rawRain >= 0 && rawRain >= 1) bucket.rainyDays += 1;
    const temp = parameter.T2M?.[date];
    if (typeof temp === "number" && temp > -100) {
      bucket.tempSum += temp;
      bucket.tempCount += 1;
    }
    const wind = parameter.WS2M?.[date];
    if (typeof wind === "number" && wind > -100) {
      bucket.windSum += wind * 3.6;
      bucket.windCount += 1;
    }
    buckets.set(month, bucket);
  }
  return Array.from({ length: 12 }, (_, index) => {
    const month = index + 1;
    const bucket = buckets.get(month);
    return {
      month,
      rainDayProbability: bucket && bucket.days > 0 ? round(bucket.rainyDays / bucket.days, 3) : 0,
      avgTempC: bucket && bucket.tempCount > 0 ? round(bucket.tempSum / bucket.tempCount, 1) : null,
      avgWindKmh: bucket && bucket.windCount > 0 ? round(bucket.windSum / bucket.windCount, 1) : null,
      sampleDays: bucket?.days ?? 0,
    };
  });
}

async function fetchNasaWithRetry(circuit: CoordinateCircuit): Promise<TrackWeatherMonth[]> {
  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetchNasaMonths(circuit);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, 15_000));
    }
  }
  throw lastError ?? new Error(`NASA POWER falhou para ${circuit.id}`);
}

async function main(): Promise<void> {
  const dataset = getF1dbDataset();
  if (!dataset) {
    throw new Error("F1DB indisponível: defina F1DB_DATA_DIR ou baixe data/external/f1db");
  }
  const targetYear = Math.max(...dataset.races.map((race) => race.year));
  const circuits: BuildCircuit[] = dataset.circuits.map((circuit) => ({
    id: circuit.id,
    name: circuit.name,
    fullName: circuit.fullName,
    countryId: circuit.countryId,
    type: circuit.type,
    direction: circuit.direction,
    placeName: circuit.placeName,
    latitude: circuit.latitude,
    longitude: circuit.longitude,
    lengthKm: circuit.lengthKm,
    turns: circuit.turns,
  }));
  const races: BuildRace[] = dataset.races.map((race) => ({
    id: race.id,
    year: race.year,
    round: race.round,
    officialName: race.officialName ?? `${race.circuitId} ${race.year}`,
    circuitId: race.circuitId,
    circuitLayoutId: race.circuitLayoutId,
    laps: race.laps,
    turns: race.turns,
    courseLengthKm: race.courseLengthKm,
    date: race.date,
  }));
  const results: BuildResult[] = [...dataset.resultsByDriverId.values()]
    .flat()
    .map((result) => ({
      raceId: result.raceId,
      positionNumber: result.positionNumber,
      positionText: result.positionText,
      gridPositionNumber: result.gridPositionNumber,
      reasonRetired: result.reasonRetired ?? "",
      positionsGained: result.positionsGained,
      pitStops: result.pitStops,
    }));

  const targetCircuitIds = new Set(
    dataset.races.filter((race) => race.year === targetYear).map((race) => race.circuitId),
  );
  const targetCircuits: CoordinateCircuit[] = dataset.circuits
    .filter(
      (circuit) =>
        targetCircuitIds.has(circuit.id) &&
        circuit.latitude !== null &&
        circuit.longitude !== null,
    )
    .map((circuit) => ({
      id: circuit.id,
      latitude: circuit.latitude as number,
      longitude: circuit.longitude as number,
    }));
  const missingCoordinates = [...targetCircuitIds].filter(
    (id) => !targetCircuits.some((circuit) => circuit.id === id),
  );
  if (missingCoordinates.length > 0) {
    throw new Error(`Circuitos sem coordenadas: ${missingCoordinates.join(", ")}`);
  }

  let openMeteo = new Map<string, TrackWeatherMonth[]>();
  try {
    openMeteo = await fetchOpenMeteoBatch(targetCircuits);
    console.log(`Open-Meteo: ${openMeteo.size}/${targetCircuits.length} circuitos`);
  } catch (error) {
    console.warn(
      `Open-Meteo indisponível (${error instanceof Error ? error.message : String(error)}); usando NASA POWER`,
    );
  }

  const weather: BuildWeather[] = [];
  const weatherErrors: string[] = [];
  for (const circuit of targetCircuits) {
    const fromOpenMeteo = openMeteo.get(circuit.id);
    if (fromOpenMeteo) {
      weather.push({ circuitId: circuit.id, months: fromOpenMeteo, source: "open-meteo" as WeatherSource });
      continue;
    }
    try {
      const months = await fetchNasaWithRetry(circuit);
      weather.push({ circuitId: circuit.id, months, source: "nasa-power" as WeatherSource });
      await new Promise((resolve) => setTimeout(resolve, 300));
    } catch (error) {
      weatherErrors.push(`${circuit.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (weatherErrors.length > 0) {
    throw new Error(`Clima incompleto: ${weatherErrors.join("; ")}`);
  }

  const built = buildTrackProfileDataset({
    targetYear,
    generatedAt: new Date().toISOString(),
    sourceVersion: dataset.sourceVersion,
    circuits,
    races,
    results,
    weather,
  });
  const validated = validateTrackProfileDataset(built);
  assertTrackProfileInvariants(validated);

  const outDir = path.resolve(process.cwd(), "..", "..", "data", "v5");
  await mkdir(outDir, { recursive: true });
  await writeFile(
    path.join(outDir, "weather-climatology.v1.json"),
    JSON.stringify(
      {
        schemaVersion: "v5.weather-climatology.v1",
        generatedAt: validated.generatedAt,
        sources: validated.sources.filter((source) => source.name !== "F1DB"),
        circuits: weather,
      },
      null,
      2,
    ),
    "utf8",
  );
  await writeFile(
    path.join(outDir, "track-profiles.v1.json"),
    JSON.stringify(validated, null, 2),
    "utf8",
  );
  console.log(
    `V5 track profiles: ${validated.circuits.length} circuitos (${targetYear}); F1DB ${validated.sourceVersion}; clima ${weather.length}; saída ${outDir}`,
  );
}

await main();
