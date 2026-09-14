const path = require("node:path");
const fs = require("node:fs");
const envRaw = fs.readFileSync(path.join(process.cwd(), ".env"), "utf8");
const dbLine = envRaw.split(/\r?\n/).find((l) => /^DATABASE_URL\s*=/.test(l));
process.env.DATABASE_URL = dbLine.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
(async () => {
  const mask = (s) => s ? s.slice(0, 11) + "..." : "(none)";
  const db = process.env.DATABASE_URL;
  const host = /@([^:/]+)/.exec(db)?.[1] ?? "?";
  const port = /:(\d+)\//.exec(db)?.[1] ?? "?";
  const dbname = /\/([a-zA-Z0-9_]+)(\?|$)/.exec(db)?.[1] ?? "?";
  const [seasons, bindings, world, extSeasons, extTeams, extDrivers, extDriverSeasons, teams, characters, profiles, entries, conversations, users, ogSeasons, ogTeams, ogDrivers, ogDriverSeasons] = await Promise.all([
    prisma.season.findMany(),
    prisma.externalBindingSeason.findMany(),
    prisma.worldState.findMany(),
    prisma.externalSeason.findMany(),
    prisma.externalTeam.findMany(),
    prisma.externalDriver.findMany({ select: { id: true, source: true, externalId: true, name: true, fullName: true, nationality: true, number: true, contentHash: true, sourceRecord: true, lastSyncedAt: true } }),
    prisma.externalDriverSeason.findMany({ select: { id: true, source: true, externalDriverId: true, seasonYear: true, teamExternalId: true, role: true, number: true, contentHash: true, lastSyncedAt: true } }),
    prisma.team.findMany(),
    prisma.character.findMany(),
    prisma.driverProfile.findMany(),
    prisma.seasonDriverEntry.findMany(),
    prisma.conversation.count(),
    prisma.user.findMany(),
    prisma.externalSeason.findMany({ where: { source: "opening-grid" } }),
    prisma.externalTeam.findMany({ where: { source: "opening-grid" } }),
    prisma.externalDriver.findMany({ where: { source: "opening-grid" } }),
    prisma.externalDriverSeason.findMany({ where: { source: "opening-grid" } }),
  ]);
  const out = {
    capturedAt: new Date().toISOString(),
    dbUrl: { host, port, dbname },
    seasons: seasons.map((s) => ({ year: s.year, name: s.name, status: s.status, provenance: s.provenance })),
    bindings: bindings.map((b) => ({ seasonId: b.seasonId, externalSeasonId: b.externalSeasonId, confidence: b.confidence, boundBy: b.boundBy, createdAt: b.createdAt })),
    worldState: world.map((w) => ({ key: w.key, currentSeasonId: w.currentSeasonId })),
    extSeasons: extSeasons.map((e) => ({ source: e.source, year: e.year, name: e.name, status: e.status, contentHash: e.contentHash, lastSyncedAt: e.lastSyncedAt?.toISOString?.() ?? null })),
    extTeams: extTeams.map((t) => ({ source: t.source, externalId: t.externalId, name: t.name, contentHash: t.contentHash, lastSyncedAt: t.lastSyncedAt?.toISOString?.() ?? null })),
    extDrivers: extDrivers.map((d) => ({ source: d.source, externalId: d.externalId, name: d.name, fullName: d.fullName, nationality: d.nationality, number: d.number, contentHash: d.contentHash, sourceRecord: d.sourceRecord, lastSyncedAt: d.lastSyncedAt?.toISOString?.() ?? null })),
    extDriverSeasons: extDriverSeasons.map((ds) => ({ source: ds.source, seasonYear: ds.seasonYear, driverExternalId: ds.externalDriverId, teamExternalId: ds.teamExternalId, role: ds.role, number: ds.number, contentHash: ds.contentHash, lastSyncedAt: ds.lastSyncedAt?.toISOString?.() ?? null })),
    teams: teams.map((t) => ({ id: t.id, name: t.name, shortName: t.shortName, color: t.color, userId: t.userId, createdAt: t.createdAt.toISOString?.() })),
    characters: characters.map((c) => ({ id: c.id, userId: c.userId, controlledBy: c.controlledBy, name: c.name, nationality: c.nationality, gender: c.gender, birthDate: c.birthDate?.toISOString?.() ?? null, imageUrl: c.imageUrl, createdAt: c.createdAt.toISOString?.() })),
    profiles: profiles.map((p) => ({ id: p.id, characterId: p.characterId, teamId: p.teamId, number: p.number })),
    entries: entries.map((e) => ({ id: e.id, seasonId: e.seasonId, teamId: e.teamId, driverProfileId: e.driverProfileId, role: e.role, seat: e.seat, number: e.number, status: e.status, provenance: e.provenance })),
    conversations,
    users: users.map((u) => ({ id: u.id, name: u.name, email: mask(u.email), role: u.role })),
    ogSeasons, ogTeams, ogDrivers, ogDriverSeasons,
  };
  fs.writeFileSync(path.join(process.cwd(), "_snapshot_pre.json"), JSON.stringify(out, null, 2));
  console.log("SNAPSHOT_OK", JSON.stringify({
    dbUrl: out.dbUrl,
    seasons: out.seasons.map(s=>`${s.year}/${s.status}`),
    binding: out.bindings.map(b=>`${b.confidence}:${b.seasonId}`),
    currentSeasonId: out.worldState[0]?.currentSeasonId,
    jolpica: { rows: out.extDriverSeasons.length, teams: out.extTeams.length, drivers: out.extDrivers.length },
    openingGrid: { seasons: out.ogSeasons.length, teams: out.ogTeams.length, drivers: out.ogDrivers.length, ds: out.ogDriverSeasons.length },
    universe: { teams: out.teams.map(t=>`${t.name}/${t.userId}`), chars: out.characters.map(c=>`${c.name}/${c.controlledBy}`), profiles: out.profiles.length, entries: out.entries.length },
    conversations,
    users: out.users.map(u=>`${u.role}:${u.name??u.id}`),
  }));
  await prisma.$disconnect();
})().catch(async (e) => { console.error("ERR", e); await prisma.$disconnect(); process.exit(1); });
