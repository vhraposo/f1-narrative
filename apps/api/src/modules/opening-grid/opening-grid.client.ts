import { OpeningGridError, type OpeningGridTransport } from "./opening-grid.transport.js";
import {
  openingGridEntryListSeasonSchema,
  type OpeningGridEntryListSeason,
} from "./opening-grid.source.js";

export interface OpeningGridClientOptions {
  transport: OpeningGridTransport;
}

export class OpeningGridClient {
  private readonly transport: OpeningGridTransport;

  constructor(options: OpeningGridClientOptions) {
    this.transport = options.transport;
  }

  sourceUrlFor(year: number): string {
    return `${this.transport.baseUrl}${year}/opening-grid.json`;
  }

  async getSeason(year: number): Promise<OpeningGridEntryListSeason> {
    const path = `${year}/opening-grid.json`;
    const raw = await this.transport.getJson(path);
    const parsed = openingGridEntryListSeasonSchema.safeParse(raw);
    if (!parsed.success) {
      throw new OpeningGridError(
        "MALFORMED",
        `Payload de Opening Grid inválido para ${year}.`,
      );
    }
    if (parsed.data.year !== year) {
      throw new OpeningGridError(
        "MALFORMED",
        `Payload de Opening Grid respondeu ano ${parsed.data.year}, esperado ${year}.`,
      );
    }
    return parsed.data as OpeningGridEntryListSeason;
  }
}