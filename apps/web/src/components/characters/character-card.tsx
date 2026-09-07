"use client";

import { ArrowUpRight, Bot, Pencil, Trash2, User } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import {
  CONTROLLED_BY_LABELS,
  formatBirthDate,
  type Character,
} from "@/lib/characters";
import type { Driver } from "@/lib/driver-profiles";

type CharacterCardProps = {
  character: Character;
  driver?: Driver | null;
  onDelete: (character: Character) => void;
  isDeleting: boolean;
};

const editLinkStyles =
  "inline-flex items-center justify-center whitespace-nowrap rounded-md border border-input bg-background px-3 h-8 text-sm font-medium ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2";

export function CharacterCard({
  character,
  driver,
  onDelete,
  isDeleting,
}: CharacterCardProps) {
  const [confirming, setConfirming] = useState(false);

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
    <article className="group flex flex-col overflow-hidden rounded-xl border border-border bg-card transition-colors hover:border-brand/50">
      <Link
        href={`/app/characters/${character.id}`}
        className="flex flex-1 flex-col focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="relative aspect-[4/3] overflow-hidden bg-muted">
          {character.imageUrl ? (
            // Porta-retrato do personagem: imagem real quando disponível.
            <img
              src={character.imageUrl}
              alt={character.name}
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <span
                aria-hidden="true"
                className="text-5xl font-black uppercase text-muted-foreground/40"
              >
                {character.name.trim().charAt(0) || "?"}
              </span>
            </div>
          )}
          <ArrowUpRight
            className="absolute right-3 top-3 h-4 w-4 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
            aria-hidden="true"
          />
        </div>

        <div className="flex flex-1 flex-col gap-1.5 p-4">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-brand">
            <ControlledIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {controlledLabel}
          </p>
          <h3 className="text-lg font-black leading-tight tracking-tight text-foreground">
            {character.name}
          </h3>
          {meta && (
            <p className="text-xs text-muted-foreground sm:text-sm">{meta}</p>
          )}
          {driver && (
            <div className="mt-auto flex items-center gap-2 border-t border-border pt-3">
              {driver.number != null && (
                <span className="text-lg font-black tabular-nums leading-none text-foreground">
                  #{driver.number}
                </span>
              )}
              {driver.team && (
                <span className="inline-flex min-w-0 items-center gap-1.5 text-sm font-semibold text-foreground">
                  {driver.team.color ? (
                    <span
                      aria-hidden="true"
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: driver.team.color }}
                    />
                  ) : null}
                  <span className="truncate">{driver.team.name}</span>
                </span>
              )}
              <span className="ml-auto shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Piloto
              </span>
            </div>
          )}
        </div>
      </Link>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-4 py-3">
        <Link href={`/app/characters/${character.id}/edit`} className={editLinkStyles}>
          <Pencil className="mr-1.5 h-3.5 w-3.5" />
          Editar
        </Link>
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-destructive"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-1.5 h-3.5 w-3.5" />
          Excluir
        </Button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Excluir personagem"
        description={`Deseja excluir "${character.name}"? Esta ação não pode ser desfeita.`}
        onConfirm={() => onDelete(character)}
        isPending={isDeleting}
      />
    </article>
  );
}