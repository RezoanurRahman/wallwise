import { Frame } from 'lucide-react';

import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/Feedback';

export default function ArtworksPage() {
  return (
    <section className="page page--artworks" aria-labelledby="artworks-page-title">
      <PageHeader
        eyebrow="Collection / Works"
        title="The working collection"
        titleId="artworks-page-title"
        description="Move between available, reserved, and retired works while keeping each artist, dimension, and framing detail close at hand."
      />

      <div className="card placeholder-card">
        <EmptyState
          icon={<Frame size={25} strokeWidth={1.6} focusable="false" />}
          title="Artwork catalogue is being assembled"
          message="The catalogue, filtering, and artwork records will be connected to the Wallwise API here. No sample works are shown."
        />
      </div>
    </section>
  );
}
