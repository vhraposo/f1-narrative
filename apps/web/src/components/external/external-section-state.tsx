import { Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";

export function ExternalSectionLoading() {
  return (
    <div className="flex justify-center py-8">
      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
    </div>
  );
}

export function ExternalSectionError({
  description,
  detail,
  refetching,
  onRetry,
}: {
  description: string;
  detail?: string;
  refetching: boolean;
  onRetry: () => void;
}) {
  return (
    <ErrorState
      className="py-6 sm:py-8"
      title="Dados indisponíveis"
      description={description}
      detail={detail}
      action={
        <Button variant="outline" size="sm" onClick={onRetry} disabled={refetching}>
          {refetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Tentar novamente
        </Button>
      }
    />
  );
}

export function ExternalSectionEmpty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <EmptyState className="py-6 sm:py-8" title={title} description={description} />
  );
}