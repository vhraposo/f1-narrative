import { describe, expect, it } from "vitest";
import { normalizeOpenF1Drivers } from "./openf1.normalizer.js";

describe("normalizeOpenF1Drivers", () => {
  it("mapeia o grid da OpenF1 para NormalizedOpenF1Driver", () => {
    const items = [
      {
        driver_number: 1,
        full_name: "Max Verstappen",
        first_name: "Max",
        last_name: "Verstappen",
        headshot_url: "https://cdn.openf1.org/1.png",
        team_name: "Red Bull",
        team_colour: "3671C6",
      },
    ];
    const result = normalizeOpenF1Drivers(items);
    expect(result).toEqual([
      {
        driverNumber: 1,
        fullName: "Max Verstappen",
        firstName: "Max",
        lastName: "Verstappen",
        headshotUrl: "https://cdn.openf1.org/1.png",
        teamName: "Red Bull",
        teamColour: "3671C6",
      },
    ]);
  });

  it("descarta itens sem driver_number", () => {
    const result = normalizeOpenF1Drivers([
      { full_name: "Sem Numero", team_name: "X" },
    ]);
    expect(result).toEqual([]);
  });

  it("normaliza campos vazios para null", () => {
    const result = normalizeOpenF1Drivers([
      {
        driver_number: 44,
        full_name: "Lewis Hamilton",
        first_name: "",
        last_name: " ",
        headshot_url: "",
        team_name: "Ferrari",
        team_colour: "E80020",
      },
    ]);
    expect(result).toEqual([
      {
        driverNumber: 44,
        fullName: "Lewis Hamilton",
        firstName: null,
        lastName: null,
        headshotUrl: null,
        teamName: "Ferrari",
        teamColour: "E80020",
      },
    ]);
  });
});