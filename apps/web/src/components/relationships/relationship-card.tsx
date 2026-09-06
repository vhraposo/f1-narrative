"use client";

import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import type { Relationship } from "@/lib/relationships";

type RelationshipCardProps = {
  relationship: Relationship;
  onEdit: (relationship: Relationship) => void;
  onRemove: (relationship: Relationship) => void;
  isRemoving: boolean;
  removeError: string | null;
};

function DimensionItem({ label, value }: { label: string; value: unknown }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs">
      <span className="font-medium">{String(label)}:</span>
      <span className="text-muted-foreground">{String(value)}</span>
    </span>
  );
}

export function RelationshipCard({
  relationship,
  onEdit,
  onRemove,
  isRemoving,
  removeError,
}: RelationshipCardProps) {
  const [confirming, setConfirming] = useState(false);
  const { characterA, characterB, dimensions } = relationship;

  const dimensionEntries = Object.entries(dimensions ?? {});

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">
          <span>{characterA.name}</span>
          <span className="mx-2 text-muted-foreground">↔</span>
          <span>{characterB.name}</span>
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {characterA.nationality} e {characterB.nationality}
        </p>
      </CardHeader>
      <CardContent>
        {dimensionEntries.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Sem dimensões definidas.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {dimensionEntries.map(([key, value]) => (
              <DimensionItem key={key} label={key} value={value} />
            ))}
          </div>
        )}
      </CardContent>
      <CardFooter className="gap-2">
        <Button variant="outline" size="sm" onClick={() => onEdit(relationship)}>
          <Pencil className="mr-2 h-4 w-4" />
          Editar
        </Button>
        <Button
          variant="destructive"
          size="sm"
          onClick={() => setConfirming(true)}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          Remover
        </Button>
      </CardFooter>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Remover relacionamento"
        description={`Deseja remover o relacionamento entre ${characterA.name} e ${characterB.name}? Esta ação não pode ser desfeita.`}
        onConfirm={() => onRemove(relationship)}
        isPending={isRemoving}
        error={removeError}
      />
      {removeError && (
        <p className="px-6 pb-4 text-sm text-destructive" role="alert">
          {removeError}
        </p>
      )}
    </Card>
  );
}
