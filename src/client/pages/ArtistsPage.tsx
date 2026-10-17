import { UsersRound } from 'lucide-react';

import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/Feedback';

export default function ArtistsPage() {
  return (
    <section className="page page--artists" aria-labelledby="artists-page-title">
      <PageHeader
        eyebrow="People / Roster"
        title="Artists & practices"
        titleId="artists-page-title"
        description="Keep a durable, searchable record of the people behind the work and the practices your gallery represents."
      />

      <div className="card placeholder-card">
        <EmptyState
          icon={<UsersRound size={25} strokeWidth={1.6} focusable="false" />}
          title="Artist roster is being assembled"
          message="Search, artist records, archiving, and the create and edit panels will appear here once the artist workspace is connected. No sample people are shown."
        />
      </div>
    </section>
  );
}
