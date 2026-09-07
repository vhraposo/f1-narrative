"use client";

import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { ChampionshipStanding } from "@/lib/championship";
import {
  formatDriverNumber,
  type Driver,
} from "@/lib/driver-profiles";

type DriverCardProps = {
  driver: Driver;
  standing?: ChampionshipStanding | null;
  onRemove: (driver: Driver) => void;
  isRemoving: boolean;
};

const editLinkStyles =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 h-8 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function DriverCard({
  driver,
  standing,
  onRemove,
  isRemoving,
}: DriverCardProps) {
  const [confirming, setConfirming] = useState(false);

  const team = driver.team;
  const teamColor = team?.color ?? null;
  const initial =
    driver.character.name.trim().charAt(0).toUpperCase() || "?";

  const performance = standing
    ? [
        standing.position != null ? `P${standing.position}` : "P—",
        `${standing.points} PTS`,
        standing.wins || standing.podiums
          ? `${standing.wins}V · ${standing.podiums}P`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : null;

  return (
    <article className="group flex overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-brand/50">
      <span
        aria-hidden="true"
        className="w-1 shrink-0 self-stretch bg-foreground/10"
        style={teamColor ? { backgroundColor: teamColor } : undefined}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={`/app/characters/${driver.characterId}`}
          className="relative flex flex-1 items-center gap-4 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:gap-5 sm:p-5"
        >
          <div className="shrink-0">
            <span
              className="text-4xl font-black tabular-nums leading-none sm:text-5xl"
              style={teamColor ? { color: teamColor } : undefined}
            >
              {formatDriverNumber(driver.number)}
            </span>
          </div>

          <div className="min-w-0 flex-1 space-y-1">
            <h3 className="truncate text-lg font-black leading-tight tracking-tight text-foreground sm:text-xl">
              {driver.character.name}
            </h3>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground sm:text-sm">
              <span>{driver.character.nationality}</span>
              {team && (
                <span className="inline-flex min-w-0 items-center gap-1.5 font-semibold text-foreground">
                  {teamColor && (
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: teamColor }}
                    />
                  )}
                  <span className="truncate">{team.name}</span>
                </span>
              )}
            </p>
            {performance && (
              <p className="pt-0.5 text-xs font-semibold tabular-nums tracking-wide text-muted-foreground sm:text-sm">
                {performance}
              </p>
            )}
          </div>

          <div className="hidden shrink-0 sm:block">
            {driver.character.imageUrl ? (
              <img
                src={driver.character.imageUrl}
                alt={driver.character.name}
                className="h-16 w-20 rounded-lg object-cover"
              />
            ) : (
              <div className="flex h-16 w-20 items-center justify-center rounded-lg bg-muted">
                <span
                  aria-hidden="true"
                  className="text-xl font-black uppercase text-muted-foreground/40"
                >
                  {initial}
                </span>
              </div>
            )}
          </div>

          <ArrowUpRight
            aria-hidden="true"
            className="absolute right-3 top-3 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          />
        </Link>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-2.5">
          <Link
            href={`/app/characters/${driver.characterId}`}
            className={editLinkStyles}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Editar perfil
          </Link>
          <Button
            variant="ghost"
            size="sm"
            className="text-muted-foreground hover:text-destructive"
            onClick={() => setConfirming(true)}
          >
            <Trash2 className="mr-1.5 h-3.5 w-3.5" />
            Remover
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remover piloto"
        description={`Deseja remover ${driver.character.name} da lista de pilotos? Essa alteração pode ser feita novamente pela ficha do personagem.`}
        onConfirm={() => onRemove(driver)}
        isPending={isRemoving}
      />
    </article>
  );
}
