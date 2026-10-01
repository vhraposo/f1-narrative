import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import {
  F1dbProvider,
  loadF1dbDataset,
  type F1dbDataset,
} from "./f1db.provider.js";

const DATASET: F1dbDataset = {
  version: "2026.1",
  drivers: [
    {
      driverId: "max-verstappen",
      firstName: "Max",
      lastName: "Verstappen",
      nationality: "Dutch",
      placeOfBirth: "Hasselt, Belgium",
      dateOfBirth: "1997-09-30",
      number: 33,
      code: "VER",
    },
    {
      driverId: "lando-norris",
      firstName: "Lando",
      lastName: "Norris",
      nationality: "British",
      placeOfBirth: "Bristol, England",
      dateOfBirth: "1999-11-13",
      number: 4,
      code: "NOR",
    },
    {
      driverId: "lewis-hamilton",
      name: "Lewis Hamilton",
      nationality: "British",
      dateOfBirth: "1985-01-07",
      number: 44,
    },
  ],
  seasonEntries: [
    { driverId: "max-verstappen", year: 2015, constructorName: "Toro Rosso", number: 33 },
    { driverId: "max-verstappen", year: 2016, constructorName: "Red Bull", number: 33 },
    { driverId: "max-verstappen", year: 2025, constructorName: "Red Bull", number: 1 },
    { driverId: "lando-norris", year: 2025, constructorName: "McLaren", number: 4 },
  ],
  standings: [
    { driverId: "max-verstappen", year: 2021, position: 1 },
    { driverId: "max-verstappen", year: 2022, position: 1 },
    { driverId: "max-verstappen", year: 2025, position: 2 },
    { driverId: "lando-norris", year: 2025, position: 1 },
  ],
};

const tempDirs: string[] = [];

afterAll(async () => {
  for (const dir of tempDirs) {
    await rm(dir, { recursive: true, force: true });
  }
});

describe("F1dbProvider", () => {
  const provider = new F1dbProvider(DATASET);

  it("1) resolve por nome com acentos/caixa e por id exato", async () => {
    const byName = await provider.resolveDriverIdentity({ name: "max verstappen" });
    expect(byName).toHaveLength(1);
    expect(byName[0]?.externalId).toBe("max-verstappen");
    expect(byName[0]?.f1dbDriverId).toBe("max-verstappen");

    const byId = await provider.resolveDriverIdentity({
      name: "qualquer",
      f1dbDriverId: "lando-norris",
    });
    expect(byId).toHaveLength(1);
    expect(byId[0]?.name).toBe("Lando Norris");
  });

  it("2) piloto inexistente retorna vazio sem inventar", async () => {
    const result = await provider.resolveDriverIdentity({ name: "Piloto Fantasma" });
    expect(result).toHaveLength(0);
  });

  it("3) perfil estruturado com fatos, equipes, títulos e licença CC BY 4.0", async () => {
    const result = await provider.fetchStructuredProfile({
      externalId: "max-verstappen",
      name: "Max Verstappen",
    });
    expect(result.profile.fullName).toBe("Max Verstappen");
    expect(result.profile.dateOfBirth?.toISOString().slice(0, 10)).toBe("1997-09-30");
    expect(result.profile.placeOfBirth).toBe("Hasselt, Belgium");
    expect(result.profile.driverNumber).toBe(33);
    expect(result.profile.currentTeamName).toBe("Red Bull");
    expect(result.profile.biographyFacts.teams).toEqual(["Toro Rosso", "Red Bull"]);
    expect(result.profile.biographyFacts.championships).toEqual([2021, 2022]);
    expect(result.source.provider).toBe("F1DB");
    expect(result.source.license).toBe("CC_BY_4_0");
    expect(result.source.attributionText).toContain("CC BY 4.0");
    expect(result.source.sourceVersion).toBe("2026.1");
  });

  it("4) career data entregue ordenada e sem inventar relação", async () => {
    const career = await provider.fetchCareerData({
      externalId: "max-verstappen",
      name: "Max Verstappen",
    });
    expect(career.seasons.map((season) => season.year)).toEqual([2015, 2016, 2025]);
    expect(career.championships).toEqual([2021, 2022]);
    const relationships = await provider.fetchRelationships({
      externalId: "max-verstappen",
      name: "Max Verstappen",
    });
    expect(relationships).toEqual([]);
    const sources = await provider.fetchSourceReferences({
      externalId: "max-verstappen",
      name: "Max Verstappen",
    });
    expect(sources).toHaveLength(1);
  });

  it("5) perfil de driver inexistente no dataset falha claramente", async () => {
    await expect(
      provider.fetchStructuredProfile({ externalId: "nao-existe", name: "Ninguém" }),
    ).rejects.toThrow(/not found/);
  });

  it("6) loadF1dbDataset lê arquivos estruturados e versiona o release", async () => {
    const dir = await mkdtemp(join(tmpdir(), "f1db-"));
    tempDirs.push(dir);
    await writeFile(
      join(dir, "drivers.json"),
      JSON.stringify([{ driverId: "d1", name: "Driver One", nationality: "BR" }]),
    );
    await writeFile(
      join(dir, "season-entries.json"),
      JSON.stringify([{ driverId: "d1", year: 2030, constructorName: "Equipe" }]),
    );
    await writeFile(join(dir, "standings.json"), JSON.stringify([]));
    await writeFile(join(dir, "release.json"), JSON.stringify({ tag: "2030.2" }));

    const dataset = await loadF1dbDataset(dir);
    expect(dataset.version).toBe("2030.2");
    expect(dataset.drivers).toHaveLength(1);
    expect(dataset.seasonEntries).toHaveLength(1);

    const emptyDir = await mkdtemp(join(tmpdir(), "f1db-empty-"));
    tempDirs.push(emptyDir);
    const emptyDataset = await loadF1dbDataset(emptyDir);
    expect(emptyDataset.drivers).toEqual([]);
    expect(emptyDataset.version).toBe("unknown");
  });
});
