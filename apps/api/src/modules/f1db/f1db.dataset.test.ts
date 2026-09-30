import { describe, expect, it } from "vitest";

import {
  canonicalNameMatches,
  FIA_CANONICAL_CHAMPIONS_2000_2025,
} from "../timeline/champions.canonical.js";
import { getF1dbCircuitInfo, resolveF1dbCircuitId } from "./f1db.circuits.js";
import {
  getF1dbDataset,
  resetF1dbDatasetCache,
} from "./f1db.dataset.js";
import {
  computeF1dbDriverMilestones,
  getF1dbDriverStats,
  resolveF1dbDriver,
} from "./f1db.drivers.js";

describe("dataset F1DB local (release vendorizada)", () => {
  it("1) carrega a release e expõe versão de fonte", () => {
    resetF1dbDatasetCache();
    const dataset = getF1dbDataset();
    expect(dataset).not.toBeNull();
    expect(dataset?.sourceVersion).toBe("v2026.15.1");
    expect((dataset?.circuits.length ?? 0)).toBeGreaterThanOrEqual(70);
    expect((dataset?.races.length ?? 0)).toBeGreaterThan(1000);
  });

  it("2) resolve piloto, stats e marcos históricos reais do Lando Norris", () => {
    const driver = resolveF1dbDriver({ name: "Lando Norris" });
    expect(driver?.id).toBe("lando-norris");
    expect(driver?.dateOfBirth).toBe("1999-11-13");
    expect(driver?.placeOfBirth).toBe("Bristol");

    const stats = getF1dbDriverStats(driver!);
    expect(stats.wins).toBeGreaterThan(0);
    expect(stats.titles).toBe(1);

    const milestones = computeF1dbDriverMilestones("lando-norris")!;
    expect(milestones.debut?.year).toBe(2019);
    expect(milestones.firstPodium?.year).toBe(2020);
    expect(milestones.firstPole?.year).toBe(2021);
    expect(milestones.firstWin?.year).toBe(2024);
    expect(milestones.championshipYears).toEqual([2025]);
  });

  it("3) campeões 2000-2025 do dataset batem com a lista canônica", () => {
    const dataset = getF1dbDataset()!;
    for (const entry of FIA_CANONICAL_CHAMPIONS_2000_2025) {
      const champion = dataset.championsByYear.get(entry.year);
      expect(champion, `ano ${entry.year}`).toBeDefined();
      const driver = dataset.driversById.get(champion!.driverId);
      const matches =
        canonicalNameMatches(driver?.name, entry.driverName) ||
        canonicalNameMatches(driver?.fullName, entry.driverName);
      expect(matches, `ano ${entry.year}`).toBe(true);
    }
    expect(dataset.championsByYear.has(2026)).toBe(false);
  });

  it("4) enriquece circuito real (Interlagos) com dados técnicos", () => {
    const circuitId = resolveF1dbCircuitId({
      externalId: "interlagos",
      name: "Autódromo José Carlos Pace",
    });
    expect(circuitId).toBe("interlagos");
    const info = getF1dbCircuitInfo(circuitId!)!;
    expect(info.circuit.fullName).toBe("Autódromo José Carlos Pace");
    expect(info.circuit.lengthKm).toBeCloseTo(4.309, 3);
    expect(info.circuit.turns).toBe(15);
    expect(info.circuit.type).toBe("RACE");
    expect(info.circuit.placeName).toBe("São Paulo");
    expect(info.firstRaceYear).toBe(1973);
    expect(info.effectiveLayout?.id).toBe("interlagos-2");
    expect(info.layouts.length).toBeGreaterThanOrEqual(2);
  });

  it("5) não resolve circuitos desconhecidos", () => {
    expect(
      resolveF1dbCircuitId({ externalId: "circuito-inventado", name: "Circuito Inventado" }),
    ).toBeNull();
  });
});
