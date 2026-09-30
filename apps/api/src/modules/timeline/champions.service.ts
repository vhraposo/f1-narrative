import { prisma } from "../../infrastructure/database/prisma.js";
import {
  applyCorrectionWithinTransaction,
  type StandingCorrectionCommand,
} from "./correction.service.js";
import {
  buildCorrectionPreviewToken,
  CorrectionPreviewAbort,
} from "./correction.preview.js";
import { queryTimelineItems, type TimelineItem } from "./timeline.read.js";
import { lockUniverseTimeline, TimelineError, type Tx } from "./timeline.service.js";

const WORLD_KEY = "default";

export type ChampionsState =
  | "MATCH"
  | "DIVERGENT"
  | "UNIVERSE_ONLY"
  | "EXTERNAL_ONLY"
  | "NONE";

export type ChampionOrigin = "DERIVED" | "STANDING" | "NONE";

export type ExternalChampionDescriptor = {
  externalDriverId: string;
  name: string;
  source: string;
};

export type UniverseChampionDescriptor = {
  driverProfileId: string;
  characterId: string;
  name: string;
  externalDriverId: string | null;
};

export type ChampionEntry = {
  seasonId: string;
  year: number;
  externalChampion: ExternalChampionDescriptor | null;
  universeChampion: UniverseChampionDescriptor | null;
  state: ChampionsState;
  origin: ChampionOrigin;
  canEdit: boolean;
  canRestore: boolean;
  blockedReason: "DERIVED_CHAMPION" | null;
  restoreDriverProfileId: string | null;
};

export type ChampionChangeMode = "EDIT" | "RESTORE";

export type ChampionChangePreview = {
  previewToken: string;
  seasonId: string;
  year: number;
  mode: ChampionChangeMode;
  externalChampion: ExternalChampionDescriptor | null;
  before: UniverseChampionDescriptor | null;
  after: UniverseChampionDescriptor;
  changes: Array<{
    field: "champion";
    before: string | null;
    after: string;
  }>;
  commandCount: number;
};

async function assertChampionEditable(tx: Tx, seasonId: string): Promise<void> {
  const results = await tx.raceResult.count({
    where: { race: { seasonId } },
  });
  if (results > 0) {
    throw new TimelineError(
      "DERIVED_STANDING",
      "O campeão desta temporada é derivado de resultados; corrija a causa esportiva pela Linha do Tempo.",
      409,
    );
  }
}

async function loadWorldDate(tx: Tx, universeId: string): Promise<Date> {
  const world = await tx.worldState.findUnique({
    where: { universeId_key: { universeId, key: WORLD_KEY } },
    select: { currentDate: true },
  });
  if (!world) {
    throw new TimelineError(
      "WORLD_STATE_MISSING",
      "O universo ainda não possui estado do mundo.",
      409,
    );
  }
  return world.currentDate;
}

async function requireSeason(tx: Tx, universeId: string, seasonId: string) {
  const season = await tx.season.findFirst({
    where: { id: seasonId, universeId },
    select: { id: true, year: true },
  });
  if (!season) {
    throw new TimelineError(
      "SEASON_NOT_FOUND",
      "Temporada não pertence a este universo.",
      404,
    );
  }
  return season;
}

function pickChampion(
  rows: Array<{
    driverProfileId: string;
    position: number | null;
    characterId: string;
    name: string;
  }>,
) {
  const leaders = rows
    .filter((row) => row.position === 1)
    .sort((a, b) => a.driverProfileId.localeCompare(b.driverProfileId));
  return leaders[0] ?? null;
}

export async function listUniverseChampions(
  universeId: string,
): Promise<ChampionEntry[]> {
  const seasons = await prisma.season.findMany({
    where: { universeId },
    select: { id: true, year: true },
    orderBy: [{ year: "desc" }],
  });
  if (seasons.length === 0) return [];
  const years = seasons.map((season) => season.year);

  const [standings, results, externalStandings, seasonBindings, driverBindings, profiles] =
    await Promise.all([
      prisma.championshipStanding.findMany({
        where: { season: { universeId } },
        select: {
          seasonId: true,
          driverProfileId: true,
          position: true,
          driverProfile: {
            select: { character: { select: { id: true, name: true } } },
          },
        },
      }),
      prisma.raceResult.findMany({
        where: { race: { season: { universeId } } },
        select: { race: { select: { seasonId: true } } },
      }),
      prisma.externalStanding.findMany({
        where: { position: 1, seasonYear: { in: years } },
        select: {
          seasonYear: true,
          externalDriverId: true,
          source: true,
          externalDriver: { select: { name: true } },
        },
        orderBy: [{ source: "asc" }],
      }),
      prisma.externalBindingSeason.findMany({
        where: { universeId },
        select: { seasonId: true, externalSeason: { select: { source: true } } },
      }),
      prisma.externalBindingDriver.findMany({
        where: { universeId },
        select: { characterId: true, externalDriverId: true },
      }),
      prisma.driverProfile.findMany({
        where: { character: { universeId } },
        select: { id: true, characterId: true },
      }),
    ]);

  const resultsBySeason = new Map<string, number>();
  for (const result of results) {
    const seasonId = result.race.seasonId;
    resultsBySeason.set(seasonId, (resultsBySeason.get(seasonId) ?? 0) + 1);
  }

  const standingsBySeason = new Map<
    string,
    Array<{
      driverProfileId: string;
      position: number | null;
      characterId: string;
      name: string;
    }>
  >();
  for (const standing of standings) {
    const list = standingsBySeason.get(standing.seasonId) ?? [];
    list.push({
      driverProfileId: standing.driverProfileId,
      position: standing.position,
      characterId: standing.driverProfile.character.id,
      name: standing.driverProfile.character.name,
    });
    standingsBySeason.set(standing.seasonId, list);
  }

  const externalByYear = new Map<string, ExternalChampionDescriptor>();
  for (const standing of externalStandings) {
    const key = String(standing.seasonYear);
    if (!externalByYear.has(key)) {
      externalByYear.set(key, {
        externalDriverId: standing.externalDriverId,
        name: standing.externalDriver.name,
        source: standing.source,
      });
    }
  }

  const sourceBySeason = new Map(
    seasonBindings.map((binding) => [binding.seasonId, binding.externalSeason.source]),
  );
  const externalIdByCharacter = new Map(
    driverBindings.map((binding) => [binding.characterId, binding.externalDriverId]),
  );
  const profileByCharacter = new Map(
    profiles.map((profile) => [profile.characterId, profile.id]),
  );
  const profileByExternalDriver = new Map<string, string>();
  for (const binding of driverBindings) {
    const profileId = profileByCharacter.get(binding.characterId);
    if (profileId) profileByExternalDriver.set(binding.externalDriverId, profileId);
  }

  return seasons.map((season) => {
    const rows = standingsBySeason.get(season.id) ?? [];
    const leader = pickChampion(rows);
    const universeChampion: UniverseChampionDescriptor | null = leader
      ? {
          driverProfileId: leader.driverProfileId,
          characterId: leader.characterId,
          name: leader.name,
          externalDriverId: externalIdByCharacter.get(leader.characterId) ?? null,
        }
      : null;

    const preferredSource = sourceBySeason.get(season.id);
    const candidates = externalStandings.filter(
      (standing) => standing.seasonYear === season.year,
    );
    const externalRow =
      candidates.find((standing) => standing.source === preferredSource) ??
      candidates[0] ??
      null;
    const externalChampion: ExternalChampionDescriptor | null = externalRow
      ? {
          externalDriverId: externalRow.externalDriverId,
          name: externalRow.externalDriver.name,
          source: externalRow.source,
        }
      : null;

    const hasResults = (resultsBySeason.get(season.id) ?? 0) > 0;
    const origin: ChampionOrigin = hasResults
      ? "DERIVED"
      : universeChampion
        ? "STANDING"
        : "NONE";

    let state: ChampionsState;
    if (externalChampion && universeChampion) {
      state =
        universeChampion.externalDriverId === externalChampion.externalDriverId
          ? "MATCH"
          : "DIVERGENT";
    } else if (universeChampion) {
      state = "UNIVERSE_ONLY";
    } else if (externalChampion) {
      state = "EXTERNAL_ONLY";
    } else {
      state = "NONE";
    }

    const canEdit = origin === "STANDING";
    const restoreDriverProfileId = externalChampion
      ? (profileByExternalDriver.get(externalChampion.externalDriverId) ?? null)
      : null;

    return {
      seasonId: season.id,
      year: season.year,
      externalChampion,
      universeChampion,
      state,
      origin,
      canEdit,
      canRestore: canEdit && state === "DIVERGENT" && restoreDriverProfileId !== null,
      blockedReason: origin === "DERIVED" ? "DERIVED_CHAMPION" : null,
      restoreDriverProfileId,
    } satisfies ChampionEntry;
  });
}

export async function getChampionDetail(
  universeId: string,
  seasonId: string,
): Promise<{ champion: ChampionEntry; history: TimelineItem[] }> {
  const champions = await listUniverseChampions(universeId);
  const champion = champions.find((entry) => entry.seasonId === seasonId);
  if (!champion) {
    throw new TimelineError(
      "SEASON_NOT_FOUND",
      "Temporada não pertence a este universo.",
      404,
    );
  }
  const history = await queryTimelineItems(universeId, {
    kind: "STANDING_CORRECTED",
    seasonId,
    limit: 50,
  });
  return { champion, history: history.items };
}

async function resolveChampionTarget(
  tx: Tx,
  universeId: string,
  seasonId: string,
  mode: ChampionChangeMode,
  driverProfileId?: string,
): Promise<UniverseChampionDescriptor> {
  const season = await requireSeason(tx, universeId, seasonId);

  if (mode === "EDIT") {
    if (!driverProfileId) {
      throw new TimelineError(
        "DRIVER_REQUIRED",
        "Informe o piloto que será o novo campeão.",
        400,
      );
    }
    const profile = await tx.driverProfile.findFirst({
      where: { id: driverProfileId, character: { universeId } },
      select: { id: true, character: { select: { id: true, name: true } } },
    });
    if (!profile) {
      throw new TimelineError(
        "DRIVER_NOT_FOUND",
        "Piloto não pertence a este universo.",
        404,
      );
    }
    return {
      driverProfileId: profile.id,
      characterId: profile.character.id,
      name: profile.character.name,
      externalDriverId: null,
    };
  }

  const external = await tx.externalStanding.findFirst({
    where: { position: 1, seasonYear: season.year },
    orderBy: [{ source: "asc" }],
    select: { externalDriverId: true },
  });
  if (!external) {
    throw new TimelineError(
      "EXTERNAL_CHAMPION_MISSING",
      "A fonte externa não possui campeão para esta temporada.",
      409,
    );
  }
  const binding = await tx.externalBindingDriver.findFirst({
    where: { universeId, externalDriverId: external.externalDriverId },
    select: { characterId: true },
  });
  if (!binding) {
    throw new TimelineError(
      "RESTORE_TARGET_UNAVAILABLE",
      "O campeão da fonte não está vinculado a um piloto deste universo.",
      409,
    );
  }
  const profile = await tx.driverProfile.findUnique({
    where: { characterId: binding.characterId },
    select: { id: true, character: { select: { id: true, name: true } } },
  });
  if (!profile) {
    throw new TimelineError(
      "RESTORE_TARGET_UNAVAILABLE",
      "O campeão da fonte não possui perfil de piloto neste universo.",
      409,
    );
  }
  return {
    driverProfileId: profile.id,
    characterId: profile.character.id,
    name: profile.character.name,
    externalDriverId: external.externalDriverId,
  };
}

async function buildChampionCommands(
  tx: Tx,
  universeId: string,
  seasonId: string,
  targetDriverProfileId: string,
  worldDate: Date,
): Promise<StandingCorrectionCommand[]> {
  const standings = await tx.championshipStanding.findMany({
    where: { seasonId },
    select: { driverProfileId: true, position: true },
  });
  const current = pickChampion(
    standings.map((standing) => ({
      driverProfileId: standing.driverProfileId,
      position: standing.position,
      characterId: "",
      name: "",
    })),
  );

  const commands: StandingCorrectionCommand[] = [];
  if (current && current.driverProfileId !== targetDriverProfileId) {
    commands.push({
      kind: "STANDING_CORRECTED",
      worldDate,
      seasonId,
      driverProfileId: current.driverProfileId,
      position: 2,
    });
  }
  commands.push({
    kind: "STANDING_CORRECTED",
    worldDate,
    seasonId,
    driverProfileId: targetDriverProfileId,
    position: 1,
  });
  return commands;
}

async function loadSeasonChampion(
  tx: Tx,
  seasonId: string,
): Promise<UniverseChampionDescriptor | null> {
  const rows = await tx.championshipStanding.findMany({
    where: { seasonId },
    select: {
      driverProfileId: true,
      position: true,
      driverProfile: {
        select: { character: { select: { id: true, name: true } } },
      },
    },
  });
  const leader = pickChampion(
    rows.map((row) => ({
      driverProfileId: row.driverProfileId,
      position: row.position,
      characterId: row.driverProfile.character.id,
      name: row.driverProfile.character.name,
    })),
  );
  if (!leader) return null;
  return {
    driverProfileId: leader.driverProfileId,
    characterId: leader.characterId,
    name: leader.name,
    externalDriverId: null,
  };
}

async function resolveExternalChampion(
  tx: Tx,
  year: number,
): Promise<ExternalChampionDescriptor | null> {
  const external = await tx.externalStanding.findFirst({
    where: { position: 1, seasonYear: year },
    orderBy: [{ source: "asc" }],
    select: {
      externalDriverId: true,
      source: true,
      externalDriver: { select: { name: true } },
    },
  });
  if (!external) return null;
  return {
    externalDriverId: external.externalDriverId,
    name: external.externalDriver.name,
    source: external.source,
  };
}

export async function previewChampionChange(
  universeId: string,
  seasonId: string,
  mode: ChampionChangeMode,
  driverProfileId?: string,
): Promise<ChampionChangePreview> {
  try {
    return await prisma.$transaction(async (tx) => {
      const season = await requireSeason(tx, universeId, seasonId);
      await assertChampionEditable(tx, seasonId);
      const worldDate = await loadWorldDate(tx, universeId);
      const target = await resolveChampionTarget(
        tx,
        universeId,
        seasonId,
        mode,
        driverProfileId,
      );
      const commands = await buildChampionCommands(
        tx,
        universeId,
        seasonId,
        target.driverProfileId,
        worldDate,
      );
      const previewToken = await buildCorrectionPreviewToken(
        tx,
        universeId,
        commands,
        seasonId,
      );
      const before = await loadSeasonChampion(tx, seasonId);

      for (const command of commands) {
        await applyCorrectionWithinTransaction(tx, universeId, command);
      }

      const after = await loadSeasonChampion(tx, seasonId);
      if (!after || after.driverProfileId !== target.driverProfileId) {
        throw new TimelineError(
          "INVARIANT_VIOLATION",
          "A pré-visualização não resultou no campeão esperado.",
          409,
        );
      }

      throw new CorrectionPreviewAbort({
        previewToken,
        seasonId,
        year: season.year,
        mode,
        externalChampion: await resolveExternalChampion(tx, season.year),
        before,
        after,
        changes: [
          {
            field: "champion",
            before: before?.name ?? null,
            after: after.name,
          },
        ],
        commandCount: commands.length,
      });
    });
  } catch (error) {
    if (error instanceof CorrectionPreviewAbort) return error.report;
    throw error;
  }
}

export async function applyChampionChange(
  universeId: string,
  seasonId: string,
  mode: ChampionChangeMode,
  previewToken: string,
  driverProfileId?: string,
): Promise<{ events: Array<{ id: string; sequence: number; kind: string }> }> {
  return prisma.$transaction(async (tx) => {
    await lockUniverseTimeline(tx, universeId);
    await requireSeason(tx, universeId, seasonId);
    await assertChampionEditable(tx, seasonId);
    const worldDate = await loadWorldDate(tx, universeId);
    const target = await resolveChampionTarget(
      tx,
      universeId,
      seasonId,
      mode,
      driverProfileId,
    );
    const commands = await buildChampionCommands(
      tx,
      universeId,
      seasonId,
      target.driverProfileId,
      worldDate,
    );
    const currentToken = await buildCorrectionPreviewToken(
      tx,
      universeId,
      commands,
      seasonId,
    );
    if (currentToken !== previewToken) {
      throw new TimelineError(
        "PREVIEW_STALE",
        "O estado do universo mudou desde o preview; gere um novo preview.",
        409,
      );
    }

    const events: Array<{ id: string; sequence: number; kind: string }> = [];
    for (const command of commands) {
      const event = await applyCorrectionWithinTransaction(tx, universeId, command);
      events.push({ id: event.id, sequence: event.sequence, kind: event.kind });
    }
    return { events };
  });
}
