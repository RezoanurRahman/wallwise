import { CalendarDays, Database, Frame, LayoutDashboard, Menu, UsersRound, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';

import { cn, navigate } from '../utils';

const PRIMARY_NAVIGATION = [
  { href: '/', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/artists', label: 'Artists', icon: UsersRound },
  { href: '/artworks', label: 'Artworks', icon: Frame },
  { href: '/exhibitions', label: 'Exhibitions', icon: CalendarDays },
] as const;

export interface PageHeaderProps {
  actions?: ReactNode;
  className?: string;
  description?: ReactNode;
  eyebrow?: string;
  meta?: ReactNode;
  title: ReactNode;
  titleId?: string;
}

export interface AppShellProps {
  children: ReactNode;
  currentPath: string;
  header?: ReactNode;
  pageTitle?: string;
}

function isCurrentPath(currentPath: string, href: string): boolean {
  return href === '/'
    ? currentPath === '/'
    : currentPath === href || currentPath.startsWith(`${href}/`);
}

function isPlainInternalClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return false;
  }

  return new URL(event.currentTarget.href).origin === window.location.origin;
}

export function PageHeader({
  actions,
  className,
  description,
  eyebrow,
  meta,
  title,
  titleId,
}: PageHeaderProps) {
  const generatedId = useId();
  const headingId = titleId ?? `page-title-${generatedId}`;

  return (
    <header className={cn('page-header', className)} aria-labelledby={headingId}>
      <div className="page-header__copy">
        {eyebrow === undefined ? null : <p className="eyebrow">{eyebrow}</p>}
        <h1 className="page-header__title" id={headingId}>
          {title}
        </h1>
        {description === undefined ? null : (
          <p className="page-header__description">{description}</p>
        )}
        {meta === undefined ? null : <div className="page-header__meta">{meta}</div>}
      </div>
      {actions === undefined ? null : <div className="page-header__actions">{actions}</div>}
    </header>
  );
}

export default function AppShell({ children, currentPath, header, pageTitle }: AppShellProps) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  const navigationToggleRef = useRef<HTMLButtonElement>(null);
  const mainLabelId = useId();

  useEffect(() => {
    const closeNavigation = (): void => {
      setNavigationOpen(false);
    };

    window.addEventListener('popstate', closeNavigation);
    return () => {
      window.removeEventListener('popstate', closeNavigation);
    };
  }, []);

  useEffect(() => {
    if (!navigationOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') {
        return;
      }

      setNavigationOpen(false);
      navigationToggleRef.current?.focus();
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [navigationOpen]);

  const followInternalLink = (event: MouseEvent<HTMLAnchorElement>, href: string): void => {
    if (!isPlainInternalClick(event)) {
      return;
    }

    event.preventDefault();
    setNavigationOpen(false);
    navigate(href);
  };

  const toggleNavigation = (): void => {
    setNavigationOpen((open) => !open);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>

      <aside className="app-sidebar" aria-label="Wallwise desk navigation">
        <div className="sidebar__masthead">
          <a
            className="wordmark"
            href="/"
            onClick={(event) => {
              followInternalLink(event, '/');
            }}
            aria-label="Wallwise dashboard"
          >
            <span className="wordmark__mark" aria-hidden="true">
              W
            </span>
            <span className="wordmark__text">Wallwise</span>
          </a>

          <button
            ref={navigationToggleRef}
            type="button"
            className="nav-toggle"
            aria-controls="primary-navigation"
            aria-expanded={navigationOpen}
            onClick={toggleNavigation}
          >
            {navigationOpen ? (
              <X size={20} strokeWidth={1.8} aria-hidden="true" focusable="false" />
            ) : (
              <Menu size={20} strokeWidth={1.8} aria-hidden="true" focusable="false" />
            )}
            <span>{navigationOpen ? 'Close menu' : 'Menu'}</span>
          </button>
        </div>

        <p className="sidebar__eyebrow">Gallery operations / 01</p>

        <nav
          className="primary-nav"
          id="primary-navigation"
          aria-label="Primary"
          data-open={navigationOpen ? 'true' : 'false'}
        >
          <p className="primary-nav__label">Workspaces</p>
          <ul className="primary-nav__list">
            {PRIMARY_NAVIGATION.map((item) => {
              const Icon = item.icon;
              const current = isCurrentPath(currentPath, item.href);

              return (
                <li key={item.href}>
                  <a
                    className="primary-nav__link"
                    href={item.href}
                    aria-current={current ? 'page' : undefined}
                    onClick={(event) => {
                      followInternalLink(event, item.href);
                    }}
                  >
                    <Icon
                      className="primary-nav__icon"
                      size={19}
                      strokeWidth={1.7}
                      aria-hidden="true"
                      focusable="false"
                    />
                    <span>{item.label}</span>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="sidebar__foot">
          <div className="storage-note">
            <Database size={17} strokeWidth={1.8} aria-hidden="true" focusable="false" />
            <div>
              <p className="storage-note__title">Durable desk record</p>
              <p className="storage-note__body">Artists, hangs, and plans persist in SQLite.</p>
            </div>
          </div>
          <p className="sidebar__edition">Private gallery desk · Vol. 01</p>
        </div>
      </aside>

      <main
        className="app-main"
        id="main-content"
        tabIndex={-1}
        aria-labelledby={pageTitle === undefined ? undefined : mainLabelId}
      >
        {pageTitle === undefined ? null : (
          <span className="visually-hidden" id={mainLabelId}>
            {pageTitle}
          </span>
        )}
        {header === undefined ? null : <div className="app-main__header-slot">{header}</div>}
        {children}
      </main>
    </div>
  );
}
