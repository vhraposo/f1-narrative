"use client";

import { Pencil, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { formatDriverNumber, type Driver } from "@/lib/driver-profiles";
import type { Team } from "@/lib/teams";

type TeamCardProps = {
  team: Team;
  drivers: Driver[];
  onEdit: (team: Team) => void;
  onRemove: (team: Team) => void;
  isRemoving: boolean;
  removeError: string | null;
};

const driverRowStyles =
  "flex items-center gap-2.5 rounded-md px-1.5 py-1.5 transition-colors hover:bg-muted/60";

function DriverRow({ driver }: { driver: Driver }) {
  const initial = driver.character.name.trim().charAt(0).toUpperCase() || "?";
  const row = (
    <>
      <span className="shrink-0">
        {driver.character.imageUrl ? (
          <img
            src={driver.character.imageUrl}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <span
            aria-hidden="true"
            className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-sm font-black uppercase text-muted-foreground/60"
          >
            {initial}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold leading-tight text-foreground">
          {driver.character.name}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {driver.character.nationality}
        </span>
      </span>
      <span className="shrink-0 text-sm font-black tabular-nums text-muted-foreground">
        {formatDriverNumber(driver.number)}
      </span>
    </>
  );

  return (
    <li className="min-w-0">
      <Link
        href={`/app/characters/${driver.characterId}`}
        aria-label={`Abrir ficha de ${driver.character.name}`}
        className="outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <span className={driverRowStyles}>{row}</span>
      </Link>
    </li>
  );
}

export function TeamCard({
  team,
  drivers,
  onEdit,
  onRemove,
  isRemoving,
  removeError,
}: TeamCardProps) {
  const [confirming, setConfirming] = useState(false);

  const hasColor = Boolean(team.color);
  const driverLabel = drivers.length === 1 ? "1 PILOTO" : `${drivers.length} PILOTOS`;

  return (
    <article className="flex overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-brand/50">
      <span
        aria-hidden="true"
        className="w-1 shrink-0 self-stretch bg-foreground/10"
        style={hasColor ? { backgroundColor: team.color as string } : undefined}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <h3 className="truncate text-lg font-black leading-tight tracking-tight text-foreground sm:text-xl">
                {team.name}
              </h3>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                {team.shortName && (
                  <span className="font-semibold uppercase tracking-widest">
                    {team.shortName}
                  </span>
                )}
                <span className="font-semibold tabular-nums tracking-wide">
                  {driverLabel}
                </span>
              </div>
            </div>
          </div>

          <div className="border-t border-border pt-4">
            {drivers.length > 0 ? (
              <ul className="space-y-1">
                {drivers.map((driver) => (
                  <DriverRow key={driver.characterId} driver={driver} />
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">
                Nenhum piloto vinculado
              </p>
            )}
          </div>
        </div>

        <div className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onEdit(team)}
          >
            <Pencil className="mr-1.5 h-3.5 w-3.5" />
            Editar
          </Button>
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
        title="Remover equipe"
        description={`Deseja remover "${team.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => onRemove(team)}
        isPending={isRemoving}
        error={removeError}
      />
    </article>
  );
}
