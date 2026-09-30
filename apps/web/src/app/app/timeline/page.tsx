"use client";

import { TimelineView } from "@/components/timeline/timeline-view";
import { PageHeader } from "@/components/ui/page-header";

export default function TimelinePage() {
  return (
    <div className="space-y-6">
      <PageHeader
        kicker="NARRATIVA / LINHA DO TEMPO"
        title="Linha do Tempo"
        description="A história do seu universo, correções aplicadas e divergências em relação à realidade externa."
      />
      <TimelineView />
    </div>
  );
}
