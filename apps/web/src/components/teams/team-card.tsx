"use client";

import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Driver } from "@/lib/driver-profiles";
import { resolveTeamIdentity } from "@/lib/team-identity";
import type { Team } from "@/lib/teams";
import { cn } from "@/lib/utils";

type Props = {
  team: Team;
  drivers: Driver[];
  onEdit?: (team: Team) => void;
  onRemove?: (team: Team) => void;
  isRemoving?: boolean;
  removeError?: string | null;
};

const editLinkStyles =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 h-8 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function TeamCard({
  team,
  drivers,
  onEdit,
  onRemove,
  isRemoving,
  removeError,
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const identity = resolveTeamIdentity(team);
  const accentColor = identity?.primary ?? team.color;

  return (
    <article
      className={cn(
        "relative isolate flex overflow-hidden rounded-xl border border-border bg-card transition-all duration-200 ease-out",
        identity
          ? cn(
              "group hover:border-[color:var(--team-border)]/60",
              "hover:shadow-[0_6px_20px_var(--team-border)]/45",
              "before:pointer-events-none before:absolute before:inset-0 before:rounded-[inherit]",
              "before:bg-[image:var(--team-gradient)] before:opacity-0",
              "before:transition-opacity before:duration-500 before:ease-out",
              "before:content-[''] hover:before:opacity-15",
            )
          : "hover:border-brand/50",
      )}
      style={
        identity
          ? ({
              "--team-primary": identity.primary,
              "--team-secondary": identity.secondary,
              "--team-accent": identity.accent,
              "--team-fg": identity.foreground,
              "--team-muted": identity.muted,
              "--team-border": identity.border,
              "--team-gradient": identity.gradient,
            } as React.CSSProperties)
          : undefined
      }
    >
      <span
        aria-hidden="true"
        className={cn(
          "w-1 shrink-0 self-stretch transition-colors duration-500",
          identity
            ? "bg-[var(--team-fg)]/10 group-hover:bg-[var(--team-fg)]/20"
            : "bg-foreground/10",
        )}
        style={accentColor ? { backgroundColor: accentColor } : undefined}
      />

      <div className="relative z-[1] flex min-w-0 flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate font-semibold leading-none text-foreground">
            {team.name}
          </h3>

          {team.shortName && (
            <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-xs font-bold text-foreground/70">
              {team.shortName}
            </span>
          )}
        </div>

        <p
          className={cn(
            "mt-1 text-xs text-muted-foreground transition-colors duration-500",
            identity && "group-hover:text-[color:var(--team-muted)]/90",
          )}
        >
          {drivers.length} {drivers.length === 1 ? "PILOTO" : "PILOTOS"}
        </p>

        <div className="-mx-1 mt-3 flex flex-wrap gap-1.5">
          {drivers.length === 0 ? (
            <span
              className={cn(
                "text-sm italic text-muted-foreground transition-colors duration-500",
                identity && "group-hover:text-[color:var(--team-muted)]/90",
              )}
            >
              Nenhum piloto vinculado
            </span>
          ) : (
            drivers.map((driver) => (
              <Link
                key={driver.id}
                href={`/app/characters/${driver.characterId}`}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs transition-colors hover:border-brand/50 hover:bg-accent"
              >
                {driver.character.imageUrl ? (
                  <img
                    src={driver.character.imageUrl}
                    alt={driver.character.name}
                    className="h-5 w-5 rounded-full object-cover"
                  />
                ) : (
                  <span
                    aria-hidden="true"
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground/60"
                  >
                    {driver.character.name.trim().charAt(0).toUpperCase() ||
                      "?"}
                  </span>
                )}

                <span className="tabular-nums text-foreground">
                  {driver.number !== null ? `#${driver.number}` : "—"}
                </span>

                <span className="truncate text-muted-foreground">
                  {driver.character.name}
                </span>

                {driver.character.nationality && (
                  <span className="truncate text-muted-foreground/70">
                    {driver.character.nationality}
                  </span>
                )}
              </Link>
            ))
          )}
        </div>

        {(removeError || onEdit || onRemove) && (
          <div className="mt-4 flex items-center justify-between gap-2 border-t border-border pt-3">
            <p className="min-w-0 flex-1 truncate text-xs text-destructive">
              {removeError ?? "\u00A0"}
            </p>

            <div className="flex shrink-0 items-center gap-2">
              {onEdit && (
                <button
                  type="button"
                  onClick={() => onEdit(team)}
                  className={editLinkStyles}
                  aria-label={`Editar ${team.name}`}
                >
                  <Pencil className="mr-1.5 h-3.5 w-3.5" />
                  Editar
                </button>
              )}

              {onRemove && (
                <button
                  type="button"
                  onClick={() => setConfirming(true)}
                  disabled={isRemoving}
                  className="inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 h-8 text-sm font-medium ring-offset-background transition-colors hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                  aria-label={`Remover ${team.name}`}
                >
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                  Remover
                </button>
              )}
            </div>
          </div>
        )}

        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title="Remover equipe"
          description={`Deseja remover "${team.name}" do universo? Essa ação não apaga os personagens vinculados.`}
          onConfirm={() => onRemove?.(team)}
          isPending={isRemoving}
        />
      </div>
    </article>
  );
}