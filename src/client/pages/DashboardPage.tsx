import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  Frame,
  LoaderCircle,
  MapPin,
  UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import {
  ARTIST_STATUSES,
  ARTWORK_STATUSES,
  EXHIBITION_STATUSES,
  TASK_STATUSES,
} from '../../shared/constants';
import type {
  ActivityAction,
  ActivityEntityType,
  DashboardSummary,
  IsoTimestamp,
} from '../../shared/types';
import { downloadExhibitionsCsv, getDashboard, saveCsvDownload } from '../api';
import { PageHeader } from '../components/AppShell';
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  LiveRegion,
  LoadingState,
} from '../components/Feedback';
import { ReadinessMeter, StatusBadge } from '../components/StatusBadge';
import type { StatusValue } from '../components/StatusBadge';
import { formatDateRange, formatTimestamp, navigate, statusLabel } from '../utils';

const ENTITY_LABELS: Readonly<Record<ActivityEntityType, string>> = {
  artist: 'Artist',
  artwork: 'Artwork',
  exhibition: 'Exhibition',
  placement: 'Placement',
  task: 'Task',
};

const ACTION_LABELS: Readonly<Record<ActivityAction, string>> = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Removed',
  status_changed: 'Status changed',
  seeded: 'Seeded',
};

interface ExportState {
  error: string | null;
  pending: boolean;
  success: string | null;
}

const EMPTY_EXPORT_STATE: ExportState = { error: null, pending: false, success: null };

interface DashboardLoadState {
  data: DashboardSummary | null;
  error: string | null;
  key: string;
  loading: boolean;
}

interface StatusRow {
  count: number;
  label: string;
  status: StatusValue;
}

function StatusDistribution({ rows, title }: { rows: readonly StatusRow[]; title: string }) {
  const headingId = useId();

  return (
    <section className="card card--inset" aria-labelledby={headingId}>
      <div className="card__body">
        <h3 className="small-caps" id={headingId}>
          {title}
        </h3>
        <ul className="list-reset stack stack--tight" style={{ marginTop: '0.65rem' }}>
          {rows.map((row) => (
            <li className="cluster cluster--between" key={row.status}>
              <StatusBadge compact label={row.label} status={row.status} />
              <span className="tabular" aria-label={`${row.count} ${row.label}`}>
                {row.count}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'Wallwise could not complete the request. Please try again.';
}

function followInternalLink(event: MouseEvent<HTMLAnchorElement>, href: string): void {
  if (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  ) {
    return;
  }

  event.preventDefault();
  navigate(href);
}

interface MetricDefinition {
  detail: string;
  href: string;
  icon: LucideIcon;
  label: string;
  value: number;
}

function metricDetails(dashboard: DashboardSummary): MetricDefinition[] {
  const { totals } = dashboard;

  return [
    {
      detail: `${totals.activeArtists} active in the roster`,
      href: totals.artists === 0 ? '/artists?new=1' : '/artists',
      icon: UsersRound,
      label: 'Artists',
      value: totals.artists,
    },
    {
      detail: 'Current, searchable practices',
      href: totals.activeArtists === 0 ? '/artists?new=1' : '/artists',
      icon: UsersRound,
      label: 'Active artists',
      value: totals.activeArtists,
    },
    {
      detail: `${totals.availableArtworks} available for programming`,
      href: totals.artworks === 0 ? '/artworks?new=1' : '/artworks',
      icon: Frame,
      label: 'Artworks',
      value: totals.artworks,
    },
    {
      detail: 'Ready for a future hang',
      href: totals.availableArtworks === 0 ? '/artworks?new=1' : '/artworks',
      icon: Frame,
      label: 'Available works',
      value: totals.availableArtworks,
    },
    {
      detail: `${totals.scheduledExhibitions} scheduled or current`,
      href: totals.exhibitions === 0 ? '/exhibitions?new=1' : '/exhibitions',
      icon: CalendarDays,
      label: 'Exhibitions',
      value: totals.exhibitions,
    },
    {
      detail: 'Non-cancelled, non-closed, and not yet ended',
      href: totals.scheduledExhibitions === 0 ? '/exhibitions?new=1' : '/exhibitions',
      icon: CalendarDays,
      label: 'Scheduled exhibitions',
      value: totals.scheduledExhibitions,
    },
    {
      detail: 'Artworks assigned across exhibition hangs',
      href: '/exhibitions',
      icon: MapPin,
      label: 'Placements',
      value: totals.placements,
    },
    {
      detail: `${dashboard.overdueTaskCount} overdue across the programme`,
      href: '/exhibitions',
      icon: ClipboardList,
      label: 'Open tasks',
      value: totals.openTasks,
    },
  ];
}

export default function DashboardPage() {
  const [dashboardState, setDashboardState] = useState<DashboardLoadState>({
    data: null,
    error: null,
    key: 'initial',
    loading: true,
  });
  const [reloadKey, setReloadKey] = useState(0);
  const [exportState, setExportState] = useState<ExportState>(EMPTY_EXPORT_STATE);
  const [liveMessage, setLiveMessage] = useState('');
  const exportControllerRef = useRef<AbortController | null>(null);

  const requestKey = `dashboard|${reloadKey}`;
  const dashboard = dashboardState.key === requestKey ? dashboardState.data : null;
  const loadError = dashboardState.key === requestKey ? dashboardState.error : null;
  const loading = dashboardState.key !== requestKey || dashboardState.loading;

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const result = await getDashboard(controller.signal);
        if (!controller.signal.aborted) {
          setDashboardState({
            data: result,
            error: null,
            key: requestKey,
            loading: false,
          });
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setDashboardState({
            data: null,
            error: errorMessage(error),
            key: requestKey,
            loading: false,
          });
        }
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, [reloadKey, requestKey]);

  useEffect(() => {
    return () => {
      exportControllerRef.current?.abort();
    };
  }, []);

  const handleExport = async (): Promise<void> => {
    if (exportState.pending) {
      return;
    }

    exportControllerRef.current?.abort();
    const controller = new AbortController();
    exportControllerRef.current = controller;
    setExportState({ error: null, pending: true, success: null });

    try {
      const download = await downloadExhibitionsCsv(controller.signal);
      if (controller.signal.aborted) {
        return;
      }
      saveCsvDownload(download);
      const message = `Exhibition CSV downloaded as ${download.filename}.`;
      setExportState({ error: null, pending: false, success: message });
      setLiveMessage(`Download ready: ${message}`);
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        return;
      }
      const message = errorMessage(error);
      setExportState({ error: message, pending: false, success: null });
      setLiveMessage(`Download failed: ${message}`);
    }
  };

  const generatedAt: IsoTimestamp | null = dashboard?.generatedAt ?? null;

  return (
    <section
      className="page page--dashboard"
      aria-busy={loading || exportState.pending}
      aria-labelledby="dashboard-page-title"
    >
      <PageHeader
        actions={
          <button
            aria-busy={exportState.pending}
            className="button button--secondary"
            disabled={exportState.pending}
            onClick={() => {
              void handleExport();
            }}
            type="button"
          >
            {exportState.pending ? (
              <LoaderCircle
                aria-hidden="true"
                className="feedback__icon--loading"
                focusable="false"
                size={17}
                strokeWidth={1.9}
              />
            ) : (
              <Download aria-hidden="true" focusable="false" size={17} strokeWidth={1.9} />
            )}
            Export CSV
          </button>
        }
        description="A working overview of artists, artworks, upcoming exhibitions, readiness, and the installation desk."
        eyebrow="Portfolio / Overview"
        meta={
          <>
            <span className="cluster">
              <Database aria-hidden="true" focusable="false" size={15} strokeWidth={1.8} />
              <span>
                <strong>SQLite</strong> / durable
              </span>
            </span>
            {generatedAt === null ? null : (
              <span>Server snapshot {formatTimestamp(generatedAt)}</span>
            )}
          </>
        }
        title="A clearer view of the next hang"
        titleId="dashboard-page-title"
      />

      <LiveRegion message={liveMessage} />
      {exportState.success === null ? null : (
        <InlineNotice
          onDismiss={() => {
            setExportState((current) => ({ ...current, success: null }));
          }}
          title="CSV ready"
          tone="success"
        >
          {exportState.success}
        </InlineNotice>
      )}
      {exportState.error === null ? null : (
        <InlineNotice title="CSV export failed" tone="error">
          <p>{exportState.error}</p>
          <button
            className="button button--secondary button--small"
            disabled={exportState.pending}
            onClick={() => {
              void handleExport();
            }}
            type="button"
          >
            Try export again
          </button>
        </InlineNotice>
      )}

      {loading ? (
        <LoadingState
          description="Reading durable portfolio totals, readiness, conflicts, and recent change from SQLite."
          label="Loading the gallery overview"
        />
      ) : loadError !== null ? (
        <ErrorState
          message={loadError}
          onRetry={() => {
            setReloadKey((key) => key + 1);
          }}
          title="The gallery overview could not load"
        />
      ) : dashboard === null ? null : (
        <div className="dashboard-stack">
          <ul aria-label="Gallery totals" className="metric-grid">
            {metricDetails(dashboard).map((metric) => {
              const Icon = metric.icon;
              return (
                <li key={metric.label}>
                  <a
                    className="metric-card"
                    href={metric.href}
                    onClick={(event) => {
                      followInternalLink(event, metric.href);
                    }}
                    style={{ color: 'inherit', display: 'block', textDecoration: 'none' }}
                  >
                    <span className="metric-card__label">
                      <Icon
                        aria-hidden="true"
                        focusable="false"
                        size={15}
                        strokeWidth={1.8}
                        style={{ marginRight: '0.35rem', verticalAlign: '-0.12em' }}
                      />
                      {metric.label}
                    </span>
                    <strong className="metric-card__value">{metric.value}</strong>
                    <span className="metric-card__detail">{metric.detail}</span>
                  </a>
                </li>
              );
            })}
          </ul>

          <div className="dashboard-grid">
            <section className="card" aria-labelledby="upcoming-heading">
              <header className="card__header">
                <div className="card__header-copy">
                  <p className="card__eyebrow">Next on the walls</p>
                  <h2 className="card__title" id="upcoming-heading">
                    Upcoming exhibitions
                  </h2>
                  <p className="card__subtitle">
                    The next eight current or upcoming shows, ordered by opening date.
                  </p>
                </div>
                <CalendarDays aria-hidden="true" focusable="false" size={22} strokeWidth={1.6} />
              </header>
              <div className="card__body">
                {dashboard.upcomingExhibitions.length === 0 ? (
                  <EmptyState
                    action={
                      <button
                        className="button button--primary"
                        onClick={() => {
                          navigate('/exhibitions?new=1');
                        }}
                        type="button"
                      >
                        New exhibition
                      </button>
                    }
                    icon={
                      <CalendarDays
                        aria-hidden="true"
                        focusable="false"
                        size={23}
                        strokeWidth={1.6}
                      />
                    }
                    message="No current or upcoming exhibitions are scheduled. Create a draft to start planning the next hang."
                    title="The programme is clear"
                  />
                ) : (
                  <ul className="list-reset stack">
                    {dashboard.upcomingExhibitions.slice(0, 8).map((exhibition) => {
                      const href = `/exhibitions/${encodeURIComponent(exhibition.id)}`;
                      return (
                        <li key={exhibition.id}>
                          <article className="card card--inset">
                            <div className="card__body">
                              <div className="cluster cluster--between">
                                <div>
                                  <h3 className="card__title">
                                    <a
                                      className="text-link"
                                      href={href}
                                      onClick={(event) => {
                                        followInternalLink(event, href);
                                      }}
                                    >
                                      {exhibition.title}
                                      <ArrowRight
                                        aria-hidden="true"
                                        focusable="false"
                                        size={15}
                                        strokeWidth={2}
                                      />
                                    </a>
                                  </h3>
                                  <p className="card__subtitle">{exhibition.space}</p>
                                </div>
                                <StatusBadge status={exhibition.status} />
                              </div>
                              <p className="small muted" style={{ marginTop: '0.5rem' }}>
                                Public {formatDateRange(exhibition.startDate, exhibition.endDate)} ·
                                Install{' '}
                                {formatDateRange(exhibition.installStart, exhibition.installEnd)}
                              </p>
                              <ReadinessMeter
                                compact
                                state={exhibition.readinessState}
                                value={exhibition.readinessPercent}
                              />
                              <p
                                className={
                                  exhibition.conflictCount > 0
                                    ? 'cluster text-warning small'
                                    : 'cluster text-success small'
                                }
                                style={{ marginTop: '0.55rem' }}
                              >
                                {exhibition.conflictCount > 0 ? (
                                  <AlertTriangle
                                    aria-hidden="true"
                                    focusable="false"
                                    size={15}
                                    strokeWidth={2}
                                  />
                                ) : (
                                  <CheckCircle2
                                    aria-hidden="true"
                                    focusable="false"
                                    size={15}
                                    strokeWidth={2}
                                  />
                                )}
                                {exhibition.conflictCount === 0
                                  ? 'No conflicts'
                                  : `${exhibition.conflictCount} conflict${exhibition.conflictCount === 1 ? '' : 's'}`}
                              </p>
                            </div>
                          </article>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>

            <div className="dashboard-stack">
              <section className="card" aria-labelledby="attention-heading">
                <header className="card__header">
                  <div className="card__header-copy">
                    <p className="card__eyebrow">Desk attention</p>
                    <h2 className="card__title" id="attention-heading">
                      Overdue and conflicted
                    </h2>
                  </div>
                </header>
                <div className="card__body dashboard-stack">
                  <InlineNotice
                    title={
                      dashboard.overdueTaskCount === 0
                        ? 'No overdue tasks'
                        : 'Overdue installation work'
                    }
                    tone={dashboard.overdueTaskCount === 0 ? 'success' : 'warning'}
                  >
                    <p>
                      {dashboard.overdueTaskCount === 0
                        ? 'Every open installation task is within its due date.'
                        : `${dashboard.overdueTaskCount} task${dashboard.overdueTaskCount === 1 ? ' is' : 's are'} past due and need attention.`}
                    </p>
                    {dashboard.overdueTaskCount === 0 ? null : (
                      <a
                        className="text-link"
                        href="/exhibitions"
                        onClick={(event) => {
                          followInternalLink(event, '/exhibitions');
                        }}
                      >
                        Review the programme
                        <ArrowRight aria-hidden="true" focusable="false" size={15} />
                      </a>
                    )}
                  </InlineNotice>
                  <InlineNotice
                    title={
                      dashboard.conflictWarningCount === 0
                        ? 'No schedule conflicts'
                        : 'Schedule and artwork conflicts'
                    }
                    tone={dashboard.conflictWarningCount === 0 ? 'success' : 'warning'}
                  >
                    <p>
                      {dashboard.conflictWarningCount === 0
                        ? 'No current space, installation, or artwork double-booking warnings.'
                        : `${dashboard.conflictWarningCount} deduplicated conflict warning${dashboard.conflictWarningCount === 1 ? '' : 's'} involve current or upcoming shows.`}
                    </p>
                    {dashboard.conflictWarningCount === 0 ? null : (
                      <a
                        className="text-link"
                        href="/exhibitions"
                        onClick={(event) => {
                          followInternalLink(event, '/exhibitions');
                        }}
                      >
                        Review exhibition records
                        <ArrowRight aria-hidden="true" focusable="false" size={15} />
                      </a>
                    )}
                  </InlineNotice>
                </div>
              </section>

              <section className="card" aria-labelledby="status-heading">
                <header className="card__header">
                  <div className="card__header-copy">
                    <p className="card__eyebrow">Complete distribution</p>
                    <h2 className="card__title" id="status-heading">
                      Status at a glance
                    </h2>
                    <p className="card__subtitle">
                      Every shared status is listed, including zero-count states.
                    </p>
                  </div>
                </header>
                <div className="card__body dashboard-stack">
                  <StatusDistribution
                    rows={ARTIST_STATUSES.map((status) => ({
                      count: dashboard.statusCounts.artists[status],
                      label: statusLabel(status),
                      status,
                    }))}
                    title="Artist statuses"
                  />
                  <StatusDistribution
                    rows={ARTWORK_STATUSES.map((status) => ({
                      count: dashboard.statusCounts.artworks[status],
                      label: statusLabel(status),
                      status,
                    }))}
                    title="Artwork statuses"
                  />
                  <StatusDistribution
                    rows={EXHIBITION_STATUSES.map((status) => ({
                      count: dashboard.statusCounts.exhibitions[status],
                      label: statusLabel(status),
                      status,
                    }))}
                    title="Exhibition statuses"
                  />
                  <StatusDistribution
                    rows={TASK_STATUSES.map((status) => ({
                      count: dashboard.statusCounts.tasks[status],
                      label: statusLabel(status),
                      status,
                    }))}
                    title="Task statuses"
                  />
                </div>
              </section>
            </div>
          </div>

          <section className="card" aria-labelledby="readiness-heading">
            <header className="card__header">
              <div className="card__header-copy">
                <p className="card__eyebrow">Derived from durable records</p>
                <h2 className="card__title" id="readiness-heading">
                  Readiness across the next hang
                </h2>
                <p className="card__subtitle">
                  Readiness is 50% hang · 35% tasks · 15% clean operations. Overdue work or
                  conflicts block the state without changing the server-calculated percentage.
                </p>
              </div>
            </header>
            {dashboard.readinessRows.length === 0 ? (
              <div className="card__body">
                <p className="muted">
                  No current or upcoming exhibitions are available for a readiness review yet.
                </p>
              </div>
            ) : (
              <div className="table-wrap table-wrap--flush">
                <table className="data-table data-table--stack">
                  <caption>Server-computed readiness for current and upcoming exhibitions.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Exhibition</th>
                      <th scope="col">Artwork</th>
                      <th scope="col">Tasks</th>
                      <th scope="col">Risks</th>
                      <th scope="col">Readiness</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dashboard.readinessRows.map((row) => {
                      const href = `/exhibitions/${encodeURIComponent(row.exhibitionId)}`;
                      return (
                        <tr
                          className={
                            row.overdueTaskCount > 0 || row.conflictCount > 0
                              ? 'data-table__row--attention'
                              : undefined
                          }
                          key={row.exhibitionId}
                        >
                          <th data-label="Exhibition" scope="row">
                            <a
                              className="text-link"
                              href={href}
                              onClick={(event) => {
                                followInternalLink(event, href);
                              }}
                            >
                              {row.title}
                            </a>
                            <span className="data-table__secondary">
                              {row.space} · {formatDateRange(row.startDate, row.endDate)}
                            </span>
                          </th>
                          <td data-label="Artwork">
                            {row.placedArtworkCount} of {row.artworkCount} placed
                          </td>
                          <td data-label="Tasks">
                            {row.completedTaskCount} of {row.taskCount} complete
                            <span className="data-table__secondary">{row.openTaskCount} open</span>
                          </td>
                          <td data-label="Risks">
                            <span>
                              {row.overdueTaskCount} overdue task
                              {row.overdueTaskCount === 1 ? '' : 's'}
                            </span>
                            <span className="data-table__secondary">
                              {row.conflictCount} conflict{row.conflictCount === 1 ? '' : 's'}
                            </span>
                          </td>
                          <td data-label="Readiness">
                            <ReadinessMeter
                              compact
                              state={row.readinessState}
                              value={row.readinessPercent}
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section className="card" aria-labelledby="activity-heading">
            <header className="card__header">
              <div className="card__header-copy">
                <p className="card__eyebrow">Auditable history</p>
                <h2 className="card__title" id="activity-heading">
                  Recent activity
                </h2>
                <p className="card__subtitle">
                  The ten most recent durable changes across the gallery.
                </p>
              </div>
            </header>
            <div className="card__body">
              {dashboard.recentActivity.length === 0 ? (
                <p className="muted">
                  No activity has been recorded yet. Creating an artist, artwork, exhibition, task,
                  or placement will begin the audit trail.
                </p>
              ) : (
                <ol className="activity-list">
                  {dashboard.recentActivity.slice(0, 10).map((entry) => {
                    const exhibitionHref =
                      entry.entityType === 'exhibition'
                        ? `/exhibitions/${encodeURIComponent(entry.entityId)}`
                        : null;
                    return (
                      <li className="activity-item" key={entry.id}>
                        <span aria-hidden="true" className="activity-item__marker" />
                        <div className="activity-item__body">
                          {exhibitionHref === null ? (
                            <p className="activity-item__detail">{entry.detail}</p>
                          ) : (
                            <a
                              className="activity-item__detail text-link"
                              href={exhibitionHref}
                              onClick={(event) => {
                                followInternalLink(event, exhibitionHref);
                              }}
                            >
                              {entry.detail}
                            </a>
                          )}
                          <div className="activity-item__meta">
                            <span>{ENTITY_LABELS[entry.entityType]}</span>
                            <span>{ACTION_LABELS[entry.action]}</span>
                            <time dateTime={entry.createdAt}>
                              {formatTimestamp(entry.createdAt)}
                            </time>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
