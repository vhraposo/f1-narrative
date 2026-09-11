"use client";

import { CircleCheck, Loader2, TriangleAlert } from "lucide-react";
import * as React from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  useConfirmDriverBinding,
  useDriverReconciliation,
  useSuggestDriverBinding,
  useUnbindDriverBinding,
  type DriverReconciliationListing,
} from "@/hooks/use-universe";
import { ApiError } from "@/lib/api";

type UniverseReconcileDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  seasonId: string;
  externalDriverId: string;
  externalDriverLabel: string;
  externalDriverNumber: number | null;
  isAdmin: boolean;
};

const EMPTY_CANDIDATES: DriverReconciliationListing["candidates"] = [];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback;
}

export function UniverseReconcileDialog({
  open,
  onOpenChange,
  seasonId,
  externalDriverId,
  externalDriverLabel,
  externalDriverNumber,
  isAdmin,
}: UniverseReconcileDialogProps) {
  const listing = useDriverReconciliation(externalDriverId);
  const confirm = useConfirmDriverBinding(seasonId, externalDriverId);
  const suggest = useSuggestDriverBinding(externalDriverId);
  const unbind = useUnbindDriverBinding(seasonId, externalDriverId);

  const [selectedCandidateId, setSelectedCandidateId] = React.useState<string | null>(null);
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setSelectedCandidateId(null);
      setActionError(null);
    }
  }, [open]);

  const data = listing.data;
  const binding = data?.currentBinding ?? null;
  const candidates = data?.candidates ?? EMPTY_CANDIDATES;
  const primaryCandidateId = candidates[0]?.id ?? null;
  const effectiveSelectedId = selectedCandidateId ?? primaryCandidateId;
  const pending = confirm.isPending || suggest.isPending || unbind.isPending;

  const handleConfirm = React.useCallback(async () => {
    setActionError(null);
    const candidateId = selectedCandidateId ?? candidates[0]?.id;
    if (!data) return;
    if (!binding) {
      if (!candidateId) return;
      try {
        await suggest.mutateAsync(candidateId);
      } catch (err) {
        setActionError(
          errorMessage(err, "Não foi possível sugerir o vínculo."),
        );
        return;
      }
    }
    try {
      await confirm.mutateAsync();
    } catch (err) {
      setActionError(
        errorMessage(err, "Não foi possível confirmar o vínculo."),
      );
    }
  }, [data, binding, candidates, selectedCandidateId, suggest, confirm]);

  const handleUnbind = React.useCallback(async () => {
    if (!binding) return;
    setActionError(null);
    try {
      await unbind.mutateAsync(binding.id);
    } catch (err) {
      setActionError(
        errorMessage(err, "Não foi possível desfazer o vínculo."),
      );
    }
  }, [binding, unbind]);

  const handleRetry = React.useCallback(() => {
    void listing.refetch();
  }, [listing]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Reconciliar entidade</DialogTitle>
          <DialogDescription>
            Ajuste a relação de identidade entre a fonte externa e o seu universo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 px-5">
          <div className="rounded-lg border border-border bg-muted/30 px-3 py-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
              Fonte externa · piloto
            </p>
            <p className="mt-1 text-sm font-semibold">{externalDriverLabel}</p>
            <p className="text-xs text-muted-foreground">
              {externalDriverNumber != null
                ? `Nº ${externalDriverNumber}`
                : "Sem número"}
            </p>
          </div>

          {listing.isLoading ? (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Carregando candidatos...
            </div>
          ) : null}

          {listing.isError && !listing.isLoading ? (
            <div role="alert">
              <p className="flex items-center gap-2 text-sm text-destructive">
                <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
                {errorMessage(
                  listing.error,
                  "Não foi possível carregar os candidatos.",
                )}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={handleRetry}
                disabled={listing.isRefetching}
              >
                {listing.isRefetching ? (
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : null}
                Tentar novamente
              </Button>
            </div>
          ) : null}

          {data && binding ? (
            <div>
              <p className="flex items-center gap-2 text-sm font-semibold">
                <CircleCheck className="h-4 w-4 text-emerald-500" aria-hidden />
                {binding.confidence === "CONFIRMED"
                  ? "Vínculo confirmado"
                  : "Vínculo sugerido"}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Personagem do universo: {binding.targetLabel}
              </p>
            </div>
          ) : null}

          {data && !binding && candidates.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                Candidatos do universo
              </p>
              <div
                role="radiogroup"
                aria-label="Candidatos para vínculo"
                className="space-y-2"
              >
                {candidates.map((candidate) => {
                  const checked =
                    candidate.id === effectiveSelectedId;
                  return (
                    <label
                      key={candidate.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${
                        checked
                          ? "border-brand/50 bg-brand/5"
                          : "border-border bg-muted/20"
                      }`}
                    >
                      <input
                        type="radio"
                        name="reconcile-candidate"
                        value={candidate.id}
                        checked={checked}
                        onChange={() => setSelectedCandidateId(candidate.id)}
                        disabled={!isAdmin}
                        className="mt-1"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold">
                          {candidate.label}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          Possível correspondência · similaridade de nome{" "}
                          {Math.round(candidate.score * 100)}%
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          ) : null}

          {data && !binding && candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum candidato disponível no universo. Crie ou vincule um
              piloto para sugerir uma correspondência.
            </p>
          ) : null}

          {!isAdmin && data ? (
            <p className="text-xs text-muted-foreground">
              Somente administradores podem confirmar, descartar ou desfazer
              vínculos.
            </p>
          ) : null}

          {actionError ? (
            <p
              className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              role="alert"
            >
              {actionError}
            </p>
          ) : null}

          <p className="text-xs text-muted-foreground">
            O vínculo é uma relação de identidade entre o piloto da fonte e o
            personagem do universo. Não altera a posição no grid, os resultados
            ou o campeonato.
          </p>
        </div>

        <DialogFooter>
          {data && binding && binding.confidence === "CONFIRMED" ? (
            <>
              {isAdmin ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => void handleUnbind()}
                  disabled={pending}
                >
                  {unbind.isPending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  Desfazer vínculo
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Concluir
              </Button>
            </>
          ) : null}

          {data && binding && binding.confidence === "SUGGESTED" ? (
            <>
              {isAdmin ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void handleConfirm()}
                    disabled={pending}
                  >
                    {confirm.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : null}
                    Confirmar vínculo
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleUnbind()}
                    disabled={pending}
                  >
                    {unbind.isPending ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                    ) : null}
                    Descartar sugestão
                  </Button>
                </>
              ) : (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onOpenChange(false)}
                >
                  Fechar
                </Button>
              )}
            </>
          ) : null}

          {data && !binding && candidates.length > 0 ? (
            <>
              {isAdmin ? (
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleConfirm()}
                  disabled={pending || !effectiveSelectedId}
                >
                  {pending ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
                  ) : null}
                  Confirmar vínculo
                </Button>
              ) : null}
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Manter separado
              </Button>
            </>
          ) : null}

          {!listing.isLoading &&
          (!data ||
            listing.isError ||
            (data && !binding && candidates.length === 0)) ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Fechar
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}