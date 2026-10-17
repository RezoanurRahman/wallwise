import { LayoutDashboard } from 'lucide-react';

import { PageHeader } from '../components/AppShell';
import { EmptyState } from '../components/Feedback';

export default function DashboardPage() {
  return (
    <section className="page page--dashboard" aria-labelledby="dashboard-page-title">
      <PageHeader
        eyebrow="Portfolio / Overview"
        title="The gallery, in view."
        titleId="dashboard-page-title"
        description="A working overview of artists, artworks, upcoming exhibitions, readiness, and the installation desk."
      />

      <div className="card placeholder-card">
        <EmptyState
          icon={<LayoutDashboard size={25} strokeWidth={1.6} focusable="false" />}
          title="Dashboard view is being assembled"
          message="The analytics grid, recent activity, and readiness overview will be connected to the Wallwise API here. No sample gallery figures are shown."
        />
      </div>
    </section>
  );
}
