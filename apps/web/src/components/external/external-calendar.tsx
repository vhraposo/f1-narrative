import { SectionHeading } from "@/components/home/section-heading";
import { Card, CardContent } from "@/components/ui/card";
import {
  ExternalSectionEmpty,
  ExternalSectionError,
  ExternalSectionLoading,
} from "@/components/external/external-section-state";
import { ExternalSourceBadge } from "@/components/external/external-source-badge";
import {
  formatExternalDate,
  type ExternalRace,
} from "@/lib/external-world";

type ExternalCalendarProps = {
  races: ExternalRace[];
  isLoading: boolean;
  isError: boolean;
  refetching: boolean;
  onRetry: () => void;
};

export function ExternalCalendar({
  races,
  isLoading,
  isError,
  refetching,
  onRetry,
}: ExternalCalendarProps) {
  const sortedRaces = [...races].sort((a, b) => a.round - b.round);

  return (
    <section aria-label="Calendário externo" className="space-y-4">
      <SectionHeading
        kicker="Dados Externos"
        title="Calendário"
        action={<ExternalSourceBadge />}
      />
      {isLoading && <ExternalSectionLoading />}
      {isError && (
        <ExternalSectionError
          description="Não foi possível carregar o calendário da fonte."
          refetching={refetching}
          onRetry={onRetry}
        />
      )}
      {!isLoading && !isError && sortedRaces.length === 0 && (
        <ExternalSectionEmpty
          title="Não há corridas da fonte informadas."
          description="O calendário vem das corridas externas (ExternalRace) da temporada."
        />
      )}
      {!isLoading && !isError && sortedRaces.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {sortedRaces.map((race) => (
            <Card key={race.id}>
              <CardContent className="space-y-1.5 pt-6">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="min-w-0 flex-1 truncate text-base font-bold tracking-tight text-foreground">
                    {race.grandPrix ?? race.name ?? `Corrida ${race.round}`}
                  </h3>
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    R{race.round}
                  </span>
                </div>
                <p className="truncate text-sm text-muted-foreground">
                  {race.circuitName ?? "Circuito não informado"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Data: {formatExternalDate(race.date)}
                </p>
                {race.status ? (
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {race.status}
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}