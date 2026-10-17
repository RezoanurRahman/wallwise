import { ArrowLeft, Compass } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import { navigate } from './utils';
import AppShell, { PageHeader } from './components/AppShell';
import ArtistsPage from './pages/ArtistsPage';
import ArtworksPage from './pages/ArtworksPage';
import DashboardPage from './pages/DashboardPage';
import ExhibitionDetailPage from './pages/ExhibitionDetailPage';
import ExhibitionsPage from './pages/ExhibitionsPage';

function normalizePathname(pathname: string): string {
  const withLeadingSlash = pathname.startsWith('/') ? pathname : `/${pathname}`;
  if (withLeadingSlash === '/') {
    return '/';
  }

  return withLeadingSlash.replace(/\/+$/, '') || '/';
}

function currentPathname(): string {
  return typeof window === 'undefined' ? '/' : normalizePathname(window.location.pathname);
}

function exhibitionIdFromPath(pathname: string): string | null {
  const match = /^\/exhibitions\/([^/]+)$/.exec(pathname);
  const encodedId = match?.[1];
  if (encodedId === undefined) {
    return null;
  }

  try {
    return decodeURIComponent(encodedId);
  } catch {
    return null;
  }
}

function pageTitleForPath(pathname: string): string {
  if (pathname === '/') {
    return 'Dashboard · Wallwise';
  }
  if (pathname === '/artists') {
    return 'Artists · Wallwise';
  }
  if (pathname === '/artworks') {
    return 'Artworks · Wallwise';
  }
  if (pathname === '/exhibitions') {
    return 'Exhibitions · Wallwise';
  }
  if (exhibitionIdFromPath(pathname) !== null) {
    return 'Exhibition workspace · Wallwise';
  }
  return 'Page not found · Wallwise';
}

function followHomeLink(event: MouseEvent<HTMLAnchorElement>): void {
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }

  event.preventDefault();
  navigate('/');
}

function NotFoundPage() {
  return (
    <section className="page page--not-found" aria-labelledby="not-found-title">
      <PageHeader
        eyebrow="404 / Off the floor plan"
        title="This page is not on the wall."
        titleId="not-found-title"
        description="The address you followed does not belong to a Wallwise workspace. The rest of the desk is still open."
      />
      <div className="card not-found-card">
        <div className="not-found-card__mark" aria-hidden="true">
          <Compass size={42} strokeWidth={1.25} focusable="false" />
          <span>404</span>
        </div>
        <div className="not-found-card__copy">
          <p className="eyebrow">Navigation note</p>
          <h2>Return to the gallery overview</h2>
          <p>Use the primary navigation or follow the link below to return to the dashboard.</p>
          <a className="button button--primary" href="/" onClick={followHomeLink}>
            <ArrowLeft size={17} strokeWidth={1.9} aria-hidden="true" focusable="false" />
            Back to dashboard
          </a>
        </div>
      </div>
    </section>
  );
}

function RoutedPage({ pathname }: { pathname: string }) {
  if (pathname === '/') {
    return <DashboardPage />;
  }
  if (pathname === '/artists') {
    return <ArtistsPage />;
  }
  if (pathname === '/artworks') {
    return <ArtworksPage />;
  }
  if (pathname === '/exhibitions') {
    return <ExhibitionsPage />;
  }

  const exhibitionId = exhibitionIdFromPath(pathname);
  if (exhibitionId !== null) {
    return <ExhibitionDetailPage id={exhibitionId} />;
  }

  return <NotFoundPage />;
}

export default function App() {
  const [pathname, setPathname] = useState(currentPathname);
  const previousPathname = useRef<string | null>(null);

  useEffect(() => {
    const syncLocation = (): void => {
      setPathname(currentPathname());
    };

    window.addEventListener('popstate', syncLocation);
    return () => {
      window.removeEventListener('popstate', syncLocation);
    };
  }, []);

  useEffect(() => {
    const previousPath = previousPathname.current;
    previousPathname.current = pathname;
    document.title = pageTitleForPath(pathname);

    if (previousPath !== null && previousPath !== pathname) {
      document.getElementById('main-content')?.focus();
    }
  }, [pathname]);

  return (
    <AppShell currentPath={pathname}>
      <RoutedPage pathname={pathname} />
    </AppShell>
  );
}
