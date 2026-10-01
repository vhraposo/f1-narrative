import type { JolpicaClient } from "./jolpica.client.js";
import {
  normalizeCircuits,
  normalizeCircuitsFromRaces,
  normalizeRaces,
  type NormalizedCircuit,
  type NormalizedRace,
  type NormalizedWithSource,
} from "./jolpica.normalizer.js";

export interface SeasonScheduleData {
  races: NormalizedWithSource<NormalizedRace>[];
  circuits: NormalizedWithSource<NormalizedCircuit>[];
}

export interface ExternalDataProvider {
  readonly source: string;
  getCircuits(): Promise<NormalizedWithSource<NormalizedCircuit>[]>;
  getSeasonSchedule(year: number): Promise<SeasonScheduleData>;
}

export class JolpicaExternalDataProvider implements ExternalDataProvider {
  readonly source: string;
  private readonly client: JolpicaClient;

  constructor(client: JolpicaClient, source = "jolpica") {
    this.client = client;
    this.source = source;
  }

  async getCircuits(): Promise<NormalizedWithSource<NormalizedCircuit>[]> {
    return normalizeCircuits(await this.client.getCircuits());
  }

  async getSeasonSchedule(year: number): Promise<SeasonScheduleData> {
    const raw = await this.client.getSeasonRaces(year);
    return {
      races: normalizeRaces(raw, year),
      circuits: normalizeCircuitsFromRaces(raw),
    };
  }
}

export function createExternalDataProvider(
  source: string,
  client: JolpicaClient,
): ExternalDataProvider {
  if (source === "jolpica") {
    return new JolpicaExternalDataProvider(client, source);
  }
  throw new Error(`Fonte externa não suportada: ${source}`);
}
