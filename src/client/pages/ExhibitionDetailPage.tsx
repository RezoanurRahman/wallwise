import { CalendarRange } from 'lucide-react';

import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/Feedback';

export interface ExhibitionDetailPageProps {
  id: string;
}

export default function ExhibitionDetailPage({ id }: ExhibitionDetailPageProps) {
  return (
    <section
      className="page page--exhibition-detail"
      aria-labelledby="exhibition-detail-page-title"
    >
      <PageHeader
        eyebrow="Programme / Exhibition detail"
        title="Exhibition workspace"
        titleId="exhibition-detail-page-title"
        description={
          <>
            The production desk for exhibition <span className="id-chip">{id}</span> will gather its
            hang, tasks, readiness, conflicts, transitions, and activity in one place.
          </>
        }
      />

      <div className="card placeholder-card">
        <EmptyState
          icon={<CalendarRange size={25} strokeWidth={1.6} focusable="false" />}
          title="Exhibition detail is being assembled"
          message="The placement plan, installation tasks, lifecycle controls, conflict notices, and audit trail will be connected to this exhibition record next."
        />
      </div>
    </section>
  );
}
