import { readFileSync } from "node:fs";
import { OpeningGridError } from "./opening-grid.transport.js";
import {
  openingGridEntryListSeasonSchema,
  validateOpeningGridPayload,
  type OpeningGridEntryListSeason,
} from "./opening-grid.source.js";

function repositoryRootUrl(): URL {
  return new URL("../../../../../", import.meta.url);
}

export function openingGridFeedUrl(year: number): URL {
  return new URL(`${year}.json`, new URL("opening-grid/", repositoryRootUrl()));
}

export function loadOpeningGridFeed(year: number): OpeningGridEntryListSeason | null {
  let raw: string;
  try {
    raw = readFileSync(openingGridFeedUrl(year), "utf8");
  } catch {
    return null;
  }

  let parsed: ReturnType<typeof openingGridEntryListSeasonSchema.safeParse>;
  try {
    parsed = openingGridEntryListSeasonSchema.safeParse(JSON.parse(raw));
  } catch {
    throw new OpeningGridError(
      "MALFORMED",
      `Feed de Opening Grid (${year}) não é um JSON válido.`,
    );
  }
  if (!parsed.success) {
    throw new OpeningGridError(
      "MALFORMED",
      `Feed de Opening Grid (${year}) não respeita o schema.`,
    );
  }
  if (parsed.data.year !== year) {
    throw new OpeningGridError(
      "MALFORMED",
      `Feed de Opening Grid arquivado para ${parsed.data.year}, esperado ${year}.`,
    );
  }
  const conflicts = validateOpeningGridPayload(parsed.data);
  if (conflicts.length > 0) {
    throw new OpeningGridError(
      "MALFORMED",
      `Feed de Opening Grid (${year}) contém conflitos contextuais (${conflicts
        .map((conflict) => conflict.kind)
        .join(", ")}).`,
    );
  }
  return parsed.data;
}