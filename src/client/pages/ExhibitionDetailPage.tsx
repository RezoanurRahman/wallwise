import { ArrowLeft, CalendarDays, MapPin, Pencil } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';

import {
  createPlacement,
  createTask,
  deletePlacement,
  deleteTask,
  getExhibition,
  isApiClientError,
  transitionExhibition,
  updateExhibition,
  updateTask,
} from '../api';
import { ERROR_CODES } from '../../shared/constants';
import { isRecord } from '../../shared/http';
import type {
  ActivityEntry,
  CreatePlacementInput,
  CreateTaskInput,
  ExhibitionDetail,
  ExhibitionStatus,
  UpdateExhibitionInput,
  UpdateTaskInput,
} from '../../shared/types';
import { PageHeader } from '../components/AppShell';
import {
  ActivityTimeline,
  ConflictPanel,
  ExhibitionEditPanel,
  LifecyclePanel,
  PlacementPanel,
  TaskPanel,
} from '../components/ExhibitionDetailPanels';
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  LiveRegion,
  LoadingState,
} from '../components/Feedback';
import { ReadinessMeter, StatusBadge } from '../components/StatusBadge';
import { formatDateRange, formatTimestamp, navigate, statusLabel } from '../utils';

export interface ExhibitionDetailPageProps {
  id: string;
}

type DetailLoadMode = 'initial' | 'refresh';
type DetailRequestResult =
  | { kind: 'success'; detail: ExhibitionDetail }
  | { kind: 'not-found' }
  | { kind: 'error'; message: string };

function isNotFoundError(error: unknown): boolean {
  if (isApiClientError(error)) {
    return error.status === 404 || error.code === ERROR_CODES.NOT_FOUND;
  }

  if (isRecord(error)) {
    if (error.status === 404) {
      return true;
    }
    if (isRecord(error.error) && error.error.code === ERROR_CODES.NOT_FOUND) {
      return true;
    }
  }

  return false;
}

function errorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    return error.message;
  }

  if (isRecord(error)) {
    if (isRecord(error.error) && typeof error.error.message === 'string') {
      return error.error.message;
    }
    if (typeof error.message === 'string' && error.message.trim().length > 0) {
      return error.message;
    }
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return 'Wallwise could not complete the request. Check the gallery API and try again.';
}

function followExhibitionsLink(event: MouseEvent<HTMLAnchorElement>): void {
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
  navigate('/exhibitions');
}

async function requestDetail(id: string, signal: AbortSignal): Promise<DetailRequestResult> {
  try {
    return { kind: 'success', detail: await getExhibition(id, signal) };
  } catch (error: unknown) {
    return isNotFoundError(error)
      ? { kind: 'not-found' }
      : { kind: 'error', message: errorMessage(error) };
  }
}

export default function ExhibitionDetailPage({ id }: ExhibitionDetailPageProps) {
  return <ExhibitionDetailPageContent id={id} key={id} />;
}

function ExhibitionDetailPageContent({ id }: ExhibitionDetailPageProps) {
  const requestRef = useRef<AbortController | null>(null);
  const detailRef = useRef<ExhibitionDetail | null>(null);
  const [detail, setDetail] = useState<ExhibitionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [sessionActivity, setSessionActivity] = useState<ActivityEntry[]>([]);

  const recordActivity = (entry: ActivityEntry | undefined): void => {
    if (entry === undefined) {
      return;
    }

    setSessionActivity((current) =>
      current.some((candidate) => candidate.id === entry.id) ? current : [...current, entry],
    );
  };

  const loadDetail = useCallback(
    async (mode: DetailLoadMode, showLoading = true): Promise<void> => {
      const controller = new AbortController();
      requestRef.current?.abort();
      requestRef.current = controller;

      if (mode === 'initial') {
        if (showLoading) {
          setLoading(true);
          setRefreshing(false);
          setLoadError(null);
          setNotFound(false);
          setRefreshError(null);
        }
      } else {
        setRefreshing(true);
      }

      const result = await requestDetail(id, controller.signal);
      if (controller.signal.aborted) {
        return;
      }

      if (result.kind === 'success') {
        detailRef.current = result.detail;
        setDetail(result.detail);
        setLoadError(null);
        setNotFound(false);
        setRefreshError(null);
      } else if (result.kind === 'not-found') {
        detailRef.current = null;
        setDetail(null);
        setLoadError(null);
        setNotFound(true);
        setRefreshError(null);
      } else if (mode === 'initial' || detailRef.current === null) {
        detailRef.current = null;
        setDetail(null);
        setNotFound(false);
        setLoadError(result.message);
      } else {
        setRefreshError(result.message);
      }

      if (requestRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [id],
  );

  useEffect(() => {
    const controller = new AbortController();
    requestRef.current?.abort();
    requestRef.current = controller;
    void requestDetail(id, controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }

      if (result.kind === 'success') {
        detailRef.current = result.detail;
        setDetail(result.detail);
        setLoadError(null);
        setNotFound(false);
        setRefreshError(null);
      } else if (result.kind === 'not-found') {
        detailRef.current = null;
        setDetail(null);
        setLoadError(null);
        setNotFound(true);
      } else {
        detailRef.current = null;
        setDetail(null);
        setLoadError(result.message);
      }

      if (requestRef.current === controller) {
        setLoading(false);
        setRefreshing(false);
      }
    });

    return () => {
      controller.abort();
    };
  }, [id]);

  const handleEditSave = async (input: UpdateExhibitionInput): Promise<string> => {
    const response = await updateExhibition(id, input);
    recordActivity(response.activity);
    await loadDetail('refresh');
    return response.message;
  };

  const handleTransition = async (
    target: ExhibitionStatus,
    note: string | null,
  ): Promise<string> => {
    const response = await transitionExhibition(id, { to: target, note });
    recordActivity(response.activity);
    await loadDetail('refresh');
    return `${response.message} The show is now ${statusLabel(target)}.`;
  };

  const handleCreatePlacement = async (input: CreatePlacementInput): Promise<string> => {
    const response = await createPlacement(input);
    recordActivity(response.activity);
    await loadDetail('refresh');
    return response.message;
  };

  const handleDeletePlacement = async (placementId: string): Promise<string> => {
    const response = await deletePlacement(placementId);
    recordActivity(response.activity);
    await loadDetail('refresh');
    return response.message;
  };

  const handleCreateTask = async (input: CreateTaskInput): Promise<string> => {
    const response = await createTask(id, input);
    recordActivity(response.activity);
    await loadDetail('refresh');
    return response.message;
  };

  const handleUpdateTask = async (taskId: string, input: UpdateTaskInput): Promise<string> => {
    const response = await updateTask(taskId, input);
    recordActivity(response.activity);
    await loadDetail('refresh');
    return response.message;
  };

  const handleDeleteTask = async (taskId: string): Promise<string> => {
    const response = await deleteTask(taskId);
    recordActivity(response.activity);
    await loadDetail('refresh');
    return response.message;
  };

  const backLink = (
    <div>
      <a className="text-link" href="/exhibitions" onClick={followExhibitionsLink}>
        <ArrowLeft aria-hidden="true" focusable="false" size={17} strokeWidth={1.8} />
        Back to exhibitions
      </a>
    </div>
  );

  if (loading && detail === null) {
    return (
      <section
        aria-labelledby="exhibition-detail-page-title"
        className="page page--exhibition-detail"
      >
        {backLink}
        <PageHeader
          description="Fetching the exhibition record, hang, installation tasks, conflicts, and activity."
          eyebrow="Programme / Exhibition detail"
          title="Loading exhibition"
          titleId="exhibition-detail-page-title"
        />
        <LoadingState
          description={`Reading exhibition ${id} from the gallery API.`}
          label="Loading exhibition detail"
        />
      </section>
    );
  }

  if (notFound && detail === null) {
    return (
      <section
        aria-labelledby="exhibition-detail-page-title"
        className="page page--exhibition-detail"
      >
        {backLink}
        <PageHeader
          description="The requested exhibition is not in the gallery programme."
          eyebrow="Programme / Exhibition detail"
          title="This exhibition is not on the programme"
          titleId="exhibition-detail-page-title"
        />
        <div className="card placeholder-card">
          <EmptyState
            action={
              <a
                className="button button--primary"
                href="/exhibitions"
                onClick={followExhibitionsLink}
              >
                Back to exhibitions
              </a>
            }
            icon={<CalendarDays size={25} strokeWidth={1.6} focusable="false" />}
            message={
              <>
                No exhibition record matches <span className="id-chip">{id}</span>. It may have been
                removed or the link may be incorrect.
              </>
            }
            title="Exhibition not found"
          />
        </div>
      </section>
    );
  }

  if (loadError !== null && detail === null) {
    return (
      <section
        aria-labelledby="exhibition-detail-page-title"
        className="page page--exhibition-detail"
      >
        {backLink}
        <PageHeader
          description="The exhibition desk could not be read from the gallery API."
          eyebrow="Programme / Exhibition detail"
          title="Exhibition detail unavailable"
          titleId="exhibition-detail-page-title"
        />
        <ErrorState
          message={loadError}
          onRetry={() => {
            void loadDetail('initial');
          }}
          retrying={loading}
          title="The exhibition detail could not load"
        >
          <p>
            The record ID <span className="id-chip">{id}</span> is still selected. Retry when the
            gallery API is available.
          </p>
        </ErrorState>
      </section>
    );
  }

  if (detail === null) {
    return (
      <section
        aria-labelledby="exhibition-detail-page-title"
        className="page page--exhibition-detail"
      >
        {backLink}
        <PageHeader
          description="The exhibition record is not available in this desk session."
          eyebrow="Programme / Exhibition detail"
          title="Exhibition detail unavailable"
          titleId="exhibition-detail-page-title"
        />
        <ErrorState
          message="The exhibition record could not be read."
          onRetry={() => {
            void loadDetail('initial');
          }}
          retrying={loading}
        />
      </section>
    );
  }

  const activityById = new Map<string, ActivityEntry>();
  for (const entry of [...detail.activity, ...sessionActivity]) {
    activityById.set(entry.id, entry);
  }
  const activity = [...activityById.values()];
  const statusHistoryCount = activity.filter(
    (entry) => entry.entityType === 'exhibition' && entry.action === 'status_changed',
  ).length;

  return (
    <section
      aria-busy={refreshing}
      aria-labelledby="exhibition-detail-page-title"
      className="page page--exhibition-detail"
    >
      {backLink}

      <PageHeader
        actions={
          <button
            aria-controls="exhibition-edit-panel"
            aria-expanded={editing}
            className="button button--secondary"
            onClick={() => {
              setEditing((current) => !current);
            }}
            type="button"
          >
            <Pencil aria-hidden="true" focusable="false" size={16} strokeWidth={1.8} />
            {editing ? 'Close editor' : 'Edit exhibition'}
          </button>
        }
        description={detail.subtitle ?? 'No subtitle recorded for this exhibition.'}
        eyebrow="Programme / Exhibition detail"
        meta={
          <>
            <StatusBadge status={detail.status} />
            <span className="cluster">
              <MapPin aria-hidden="true" focusable="false" size={15} strokeWidth={1.8} />
              {detail.space}
            </span>
            <span>Public: {formatDateRange(detail.startDate, detail.endDate)}</span>
            <span>Installation: {formatDateRange(detail.installStart, detail.installEnd)}</span>
          </>
        }
        title={detail.title}
        titleId="exhibition-detail-page-title"
      />

      <LiveRegion message={refreshing ? 'Refreshing exhibition detail.' : ''} />

      {refreshError === null ? null : (
        <InlineNotice title="The latest exhibition detail could not load" tone="error">
          <p>{refreshError}</p>
          <p>The last successful exhibition detail remains visible on this page.</p>
          <button
            className="button button--secondary button--small"
            disabled={refreshing}
            onClick={() => {
              void loadDetail('refresh');
            }}
            type="button"
          >
            Retry refresh
          </button>
        </InlineNotice>
      )}

      <div id="exhibition-edit-panel">
        {editing ? (
          <ExhibitionEditPanel
            detail={detail}
            onClose={() => {
              setEditing(false);
            }}
            onSave={handleEditSave}
          />
        ) : null}
      </div>

      <div className="detail-grid">
        <section className="card" aria-labelledby="exhibition-record-heading">
          <header className="card__header">
            <div className="card__header-copy">
              <p className="card__eyebrow">Record / schedule</p>
              <h2 className="card__title" id="exhibition-record-heading">
                Exhibition record
              </h2>
              <p className="card__subtitle">
                Public and installation windows for the current space.
              </p>
            </div>
            <StatusBadge label={detail.space} status={detail.status} />
          </header>
          <div className="card__body">
            <dl className="detail-list">
              <div>
                <dt>Space</dt>
                <dd>{detail.space}</dd>
              </div>
              <div>
                <dt>Public dates</dt>
                <dd>{formatDateRange(detail.startDate, detail.endDate)}</dd>
              </div>
              <div>
                <dt>Installation dates</dt>
                <dd>{formatDateRange(detail.installStart, detail.installEnd)}</dd>
              </div>
              <div>
                <dt>Curator</dt>
                <dd>{detail.curator ?? 'Not recorded'}</dd>
              </div>
              <div>
                <dt>Notes</dt>
                <dd>{detail.notes ?? 'No exhibition notes recorded.'}</dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>
                  <time dateTime={detail.updatedAt}>{formatTimestamp(detail.updatedAt)}</time>
                </dd>
              </div>
            </dl>
          </div>
        </section>

        <section className="card" aria-labelledby="exhibition-readiness-heading">
          <header className="card__header">
            <div className="card__header-copy">
              <p className="card__eyebrow">Readiness / formula</p>
              <h2 className="card__title" id="exhibition-readiness-heading">
                Opening readiness
              </h2>
              <p className="card__subtitle">Calculated from the current hang and task records.</p>
            </div>
          </header>
          <div className="card__body stack--tight">
            <ReadinessMeter
              label="Exhibition readiness"
              state={detail.derived.readinessState}
              value={detail.derived.readinessPercent}
            />
            <p className="small muted">
              Readiness gives 50 points when at least one work is placed, up to 35 points for
              completed tasks, and 15 points when there are no overdue tasks or conflicts. A
              conflict or overdue task always marks the show blocked.
            </p>
          </div>
        </section>
      </div>

      <section aria-labelledby="exhibition-derived-heading">
        <h2 className="visually-hidden" id="exhibition-derived-heading">
          Exhibition derived totals
        </h2>
        <ul className="metric-grid">
          <li className="metric-card">
            <p className="metric-card__label">Artworks hung</p>
            <span className="metric-card__value">{detail.derived.artworkCount}</span>
            <p className="metric-card__detail">
              {detail.derived.placedArtworkCount} with a valid wall and position
            </p>
          </li>
          <li
            className={
              detail.derived.overdueTaskCount > 0
                ? 'metric-card metric-card--accent'
                : 'metric-card'
            }
          >
            <p className="metric-card__label">Open tasks</p>
            <span className="metric-card__value">{detail.derived.openTaskCount}</span>
            <p className="metric-card__detail">
              {detail.derived.completedTaskCount} of {detail.derived.taskCount} complete ·{' '}
              {detail.derived.overdueTaskCount} overdue
            </p>
          </li>
          <li
            className={
              detail.derived.conflictCount > 0 ? 'metric-card metric-card--accent' : 'metric-card'
            }
          >
            <p className="metric-card__label">Active conflicts</p>
            <span className="metric-card__value">{detail.derived.conflictCount}</span>
            <p className="metric-card__detail">
              {detail.derived.conflictCount === 0
                ? 'No active conflicts reported'
                : 'Review the related shows named below'}
            </p>
          </li>
          <li className="metric-card">
            <p className="metric-card__label">Status changes</p>
            <span className="metric-card__value">{statusHistoryCount}</span>
            <p className="metric-card__detail">
              Lifecycle entries in the activity history for this exhibition
            </p>
          </li>
        </ul>
      </section>

      <ConflictPanel conflicts={detail.conflicts} exhibitionStatus={detail.status} />

      <div className="detail-grid">
        <div className="stack">
          <PlacementPanel
            exhibitionId={detail.id}
            exhibitionTitle={detail.title}
            onCreatePlacement={handleCreatePlacement}
            onDeletePlacement={handleDeletePlacement}
            placements={detail.placements}
          />
          <TaskPanel
            derived={detail.derived}
            onCreateTask={handleCreateTask}
            onDeleteTask={handleDeleteTask}
            onUpdateTask={handleUpdateTask}
            tasks={detail.tasks}
          />
        </div>
        <div className="stack">
          <LifecyclePanel
            currentStatus={detail.status}
            exhibitionTitle={detail.title}
            onTransition={handleTransition}
          />
          <ActivityTimeline activity={activity} />
        </div>
      </div>
    </section>
  );
}
