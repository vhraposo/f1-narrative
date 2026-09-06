"use client";

import { Loader2, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  useCreateSchedule,
  useDeleteSchedule,
  useSchedule,
  useUpdateSchedule,
  type Schedule,
} from "@/hooks/use-schedule";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function toLocalInputValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

// Formulário pequeno reutilizado para criar e editar um agendamento.
function ScheduleForm({
  characterId,
  editing,
  onDone,
}: {
  characterId: string;
  editing: Schedule | null;
  onDone: () => void;
}) {
  const createMutation = useCreateSchedule(characterId);
  const updateMutation = useUpdateSchedule(characterId);
  const isPending = createMutation.isPending || updateMutation.isPending;

  const [activity, setActivity] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [hasEnd, setHasEnd] = useState(false);
  const [endsAt, setEndsAt] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) {
      setActivity(editing.activity);
      setStartsAt(toLocalInputValue(editing.startsAt));
      setHasEnd(Boolean(editing.endsAt));
      setEndsAt(toLocalInputValue(editing.endsAt ?? ""));
    } else {
      setActivity("");
      setStartsAt("");
      setHasEnd(false);
      setEndsAt("");
    }
    setError(null);
  }, [editing]);

  function submit() {
    setError(null);
    if (activity.trim() === "") {
      setError("Informe a atividade.");
      return;
    }
    if (!startsAt) {
      setError("Informe a data de início.");
      return;
    }
    if (hasEnd && endsAt && new Date(endsAt) < new Date(startsAt)) {
      setError("A data final não pode ser anterior à data de início.");
      return;
    }

    const startsAtIso = new Date(startsAt).toISOString();
    const endsAtValue =
      hasEnd && endsAt ? new Date(endsAt).toISOString() : null;

    if (editing) {
      updateMutation.mutate(
        {
          scheduleId: editing.id,
          input: {
            activity: activity.trim(),
            startsAt: startsAtIso,
            endsAt: endsAtValue,
          },
        },
        {
          onSuccess: onDone,
          onError: (err) =>
            setError(
              err instanceof Error ? err.message : "Não foi possível salvar.",
            ),
        },
      );
    } else {
      createMutation.mutate(
        { activity: activity.trim(), startsAt: startsAtIso, endsAt: endsAtValue },
        {
          onSuccess: onDone,
          onError: (err) =>
            setError(
              err instanceof Error ? err.message : "Não foi possível adicionar.",
            ),
        },
      );
    }
  }

  return (
    <div className="mt-4 space-y-4 rounded-md border p-4">
      <div className="space-y-2">
        <Label htmlFor="schedule-activity">Atividade</Label>
        <Input
          id="schedule-activity"
          value={activity}
          maxLength={200}
          placeholder="Ex.: Treino de pneus duros"
          onChange={(e) => setActivity(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="schedule-startsAt">Início</Label>
        <Input
          id="schedule-startsAt"
          type="datetime-local"
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="schedule-endsAt">Fim</Label>
        {hasEnd ? (
          <div className="flex gap-2">
            <Input
              id="schedule-endsAt"
              type="datetime-local"
              value={endsAt}
              onChange={(e) => setEndsAt(e.target.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="Limpar data final"
              onClick={() => {
                setHasEnd(false);
                setEndsAt("");
              }}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={() => setHasEnd(true)}>
            Definir data final
          </Button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" disabled={isPending} onClick={onDone}>
          Cancelar
        </Button>
        <Button type="button" disabled={isPending} onClick={submit}>
          {isPending ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Salvando...
            </>
          ) : editing ? (
            "Salvar"
          ) : (
            "Adicionar"
          )}
        </Button>
      </div>
    </div>
  );
}

export function ScheduleCard({ characterId }: { characterId: string }) {
  const { data, isLoading, isError, refetch } = useSchedule(characterId);
  const deleteMutation = useDeleteSchedule(characterId);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Schedule | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const confirmingItem =
    data?.find((item) => item.id === confirmingDeleteId) ?? null;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-xl">Agenda</CardTitle>
        {!isLoading && !isError && !editing && (
          <Button
            size="sm"
            onClick={() => {
              setShowForm(true);
              setEditing(null);
              setDeleteError(null);
            }}
          >
            <Plus className="mr-2 h-4 w-4" />
            Adicionar
          </Button>
        )}
      </CardHeader>

      <CardContent className="space-y-4">
        {isLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : isError ? (
          <div className="space-y-3">
            <p className="text-sm text-destructive" role="alert">
              Não foi possível carregar a agenda.
            </p>
            <Button size="sm" variant="outline" onClick={() => void refetch()}>
              <RotateCcw className="mr-2 h-4 w-4" />
              Tentar novamente
            </Button>
          </div>
        ) : showForm && !editing ? (
          <ScheduleForm
            characterId={characterId}
            editing={null}
            onDone={() => setShowForm(false)}
          />
        ) : data && data.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma atividade agendada.
          </p>
        ) : data ? (
          <ul className="space-y-2">
            {data.map((item) =>
              editing && editing.id === item.id ? (
                <li key={item.id}>
                  <ScheduleForm
                    characterId={characterId}
                    editing={editing}
                    onDone={() => setEditing(null)}
                  />
                </li>
              ) : (
                <li
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-md border p-3"
                >
                  <div className="min-w-0">
                    <p className="font-medium">{item.activity}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatDate(item.startsAt)}
                      {item.endsAt
                        ? ` → ${formatDate(item.endsAt)}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        setEditing(item);
                        setShowForm(false);
                        setDeleteError(null);
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" />
                      Editar
                    </Button>
                    {confirmingDeleteId === item.id ? null : (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label="Remover agendamento"
                        onClick={() => {
                          setConfirmingDeleteId(item.id);
                          setDeleteError(null);
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </li>
              ),
            )}
          </ul>
        ) : null}
      </CardContent>

      {confirmingItem && (
        <ConfirmDialog
          open
          onClose={() => setConfirmingDeleteId(null)}
          title="Remover agendamento"
          description={`Deseja remover "${confirmingItem.activity}"? Esta ação não pode ser desfeita.`}
          onConfirm={() => {
            setDeleteError(null);
            deleteMutation.mutate(confirmingItem.id, {
              onError: (err) => {
                setDeleteError(
                  err instanceof Error
                    ? err.message
                    : "Não foi possível remover.",
                );
              },
            });
          }}
          isPending={deleteMutation.isPending}
          error={deleteError}
        />
      )}

      {deleteError && (
        <CardFooter className="pt-0">
          <p className="text-sm text-destructive" role="alert">
            {deleteError}
          </p>
        </CardFooter>
      )}
    </Card>
  );
}