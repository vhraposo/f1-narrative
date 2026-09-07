"use client";

import { Bot, Pencil, User } from "lucide-react";
import Link from "next/link";

import {
  CONTROLLED_BY_LABELS,
  formatBirthDate,
  type Character,
} from "@/lib/characters";
import type { Driver } from "@/lib/driver-profiles";

type CharacterIdentityProps = {
  character: Character;
  driver?: Driver | null;
};

// Cabeçalho de identidade do personagem: retrato + nome (único h1 da página)
// + controle + perfil de piloto quando REALMENTE existir (driver?.team/number
// vêm do DriverProfile do backend; nada é derivado de heurística).
export function CharacterIdentity({
  character,
  driver,
}: CharacterIdentityProps) {
  const controlledLabel = CONTROLLED_BY_LABELS[character.controlledBy];
  const ControlledIcon = character.controlledBy === "USER" ? User : Bot;
  const birthLabel = formatBirthDate(character.birthDate);

  const meta = [
    character.nationality,
    character.gender && `Gênero · ${character.gender}`,
    `Nascido(a) · ${birthLabel}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <header className="relative overflow-hidden rounded-xl border border-border bg-card">
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px] bg-brand" />
      <div className="flex flex-col gap-5 p-5 sm:flex-row sm:gap-6 sm:p-6">
        <div className="aspect-[4/3] w-full overflow-hidden rounded-lg bg-muted sm:w-44 sm:shrink-0 sm:aspect-auto sm:self-start">
          {character.imageUrl ? (
            <img
              src={character.imageUrl}
              alt={character.name}
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span
                aria-hidden="true"
                className="text-6xl font-black uppercase text-muted-foreground/40"
              >
                {character.name.trim().charAt(0) || "?"}
              </span>
            </div>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
            <ControlledIcon className="h-3.5 w-3.5" aria-hidden="true" />
            Personagem · {controlledLabel}
          </p>
          <h1 className="text-3xl font-black leading-tight tracking-tight text-foreground sm:text-4xl">
            {character.name}
          </h1>
          {meta && (
            <p className="text-sm text-muted-foreground sm:text-base">{meta}</p>
          )}

          {driver && (
            <div className="flex flex-wrap items-center gap-2.5 pt-1">
              {driver.number != null && (
                <span className="rounded-md bg-brand/10 px-2.5 py-1 text-lg font-black tabular-nums leading-none text-brand">
                  #{driver.number}
                </span>
              )}
              {driver.team && (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-base font-bold text-foreground">
                  {driver.team.color ? (
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-full"
                      style={{ backgroundColor: driver.team.color }}
                    />
                  ) : null}
                  <span className="truncate">{driver.team.name}</span>
                </span>
              )}
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Piloto
              </span>
            </div>
          )}

          <div className="pt-2">
            <Link
              href={`/app/characters/${character.id}/edit`}
              className="inline-flex h-9 items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 text-sm font-medium text-foreground ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <Pencil className="mr-2 h-4 w-4" />
              Editar personagem
            </Link>
          </div>
        </div>
      </div>
    </header>
  );
}