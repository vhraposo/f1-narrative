"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { RelationshipConnection } from "@/components/relationships/relationship-connection";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Relationship } from "@/lib/relationships";

type RelationshipCardProps = {
  relationship: Relationship;
  onEdit: (relationship: Relationship) => void;
  onRemove: (relationship: Relationship) => void;
  isRemoving: boolean;
  removeError: string | null;
};

export function RelationshipCard({
  relationship,
  onEdit,
  onRemove,
  isRemoving,
  removeError,
}: RelationshipCardProps) {
  const [confirming, setConfirming] = useState(false);
  const { characterA, characterB, dimensions } = relationship;

  return (
    <article className="flex flex-col rounded-xl border border-border bg-card transition-colors hover:border-brand/50">
      <div className="flex flex-col gap-4 p-5">
        <RelationshipConnection
          a={characterA}
          b={characterB}
          dimensions={dimensions ?? undefined}
        />
      </div>

      <div className="mt-auto flex shrink-0 items-center justify-end gap-2 border-t border-border px-5 py-2.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onEdit(relationship)}
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

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remover relacionamento"
        description={`Deseja remover o relacionamento entre ${characterA.name} e ${characterB.name}? Esta ação não pode ser desfeita.`}
        onConfirm={() => onRemove(relationship)}
        isPending={isRemoving}
        error={removeError}
      />
    </article>
  );
}
