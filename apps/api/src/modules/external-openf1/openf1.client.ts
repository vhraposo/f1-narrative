import { OpenF1Transport } from "./openf1.transport.js";

export interface OpenF1DriverRaw {
  driver_number?: number;
  broadcast_name?: string;
  full_name?: string;
  name_acronym?: string;
  team_name?: string;
  team_colour?: string;
  first_name?: string;
  last_name?: string;
  headshot_url?: string | null;
  country_code?: string;
  session_key?: number;
  meeting_key?: number;
}

export interface OpenF1ClientOptions {
  baseUrl: string;
  timeoutMs?: number;
  maxRetries?: number;
  fetchImpl?: typeof fetch;
}

export class OpenF1Client {
  private readonly transport: OpenF1Transport;

  constructor(options: OpenF1ClientOptions) {
    this.transport = new OpenF1Transport(options);
  }

  async getLatestDrivers(): Promise<OpenF1DriverRaw[]> {
    const body = await this.transport.getJson("drivers?session_key=latest");
    if (!Array.isArray(body)) {
      throw new Error("OpenF1 retornou um corpo inválido para /drivers.");
    }
    return body as OpenF1DriverRaw[];
  }
}