import { CalendarDays } from 'lucide-react';

import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/Feedback';

export default function ExhibitionsPage() {
  return (
    <section className="page page--exhibitions" aria-labelledby="exhibitions-page-title">
      <PageHeader
        eyebrow="Programme / Calendar"
        title="Exhibitions on the horizon"
        titleId="exhibitions-page-title"
        description="Plan installations, track show readiness, and keep the gallery programme within its spaces and dates."
      />

      <div className="card placeholder-card">
        <EmptyState
          icon={<CalendarDays size={25} strokeWidth={1.6} focusable="false" />}
          title="Exhibition programme is being assembled"
          message="The programme list, schedule filters, readiness summaries, and exhibition creation flow will be connected here. No sample shows are shown."
        />
      </div>
    </section>
  );
}
