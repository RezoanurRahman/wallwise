import {
  AlertTriangle,
  ArrowUpRight,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Download,
  LoaderCircle,
  Plus,
  RotateCcw,
  Search,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent, MouseEvent } from 'react';

import { EXHIBITION_STATUSES, FIELD_LIMITS, ISO_DATE_PATTERN } from '../../shared/constants';
import type {
  ConflictWarning,
  CreateExhibitionInput,
  Exhibition,
  ExhibitionListResponse,
  ExhibitionStatus,
  PaginationMeta,
} from '../../shared/types';
import {
  createExhibition,
  downloadExhibitionsCsv,
  isApiClientError,
  listExhibitions,
  saveCsvDownload,
} from '../api';
import type { ApiClientError } from '../api';
import { PageHeader } from '../components/AppShell';
import {
  EmptyState,
  ErrorState,
  InlineNotice,
  LiveRegion,
  LoadingState,
} from '../components/Feedback';
import {
  FormErrorSummary,
  SelectField,
  TextAreaField,
  TextField,
  DateField,
} from '../components/FormControls';
import RecordModal from '../components/RecordModal';
import { ReadinessMeter, StatusBadge } from '../components/StatusBadge';
import { focusFirstInvalid, formatDateRange, navigate, statusLabel } from '../utils';

const PAGE_SIZE = 25;

const STATUS_FILTER_OPTIONS = [
  { label: 'All statuses', value: '' },
  ...EXHIBITION_STATUSES.map((status) => ({ label: statusLabel(status), value: status })),
];

interface ExhibitionFilters {
  search: string;
  space: string;
  status: '' | ExhibitionStatus;
}

const EMPTY_FILTERS: ExhibitionFilters = { search: '', space: '', status: '' };

interface ExhibitionFormValues {
  curator: string;
  endDate: string;
  installEnd: string;
  installStart: string;
  notes: string;
  space: string;
  startDate: string;
  subtitle: string;
  title: string;
}

interface ExportState {
  error: string | null;
  pending: boolean;
  success: string | null;
}

const EMPTY_EXPORT_STATE: ExportState = { error: null, pending: false, success: null };

interface LoadState<T> {
  data: T | null;
  error: string | null;
  key: string;
  loading: boolean;
}

const CONFLICT_TYPE_LABELS = {
  exhibition_space: 'Exhibition dates',
  installation_space: 'Installation dates',
  artwork_double_booking: 'Artwork booking',
} as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim().length > 0
    ? error.message
    : 'Wallwise could not complete the request. Please try again.';
}

function apiFieldErrors(error: ApiClientError): Record<string, string> {
  const fieldErrors: Record<string, string> = {};

  if (isRecord(error.details) && Array.isArray(error.details.issues)) {
    for (const issue of error.details.issues) {
      if (!isRecord(issue)) {
        continue;
      }
      const field = issue.field;
      const message = issue.message;
      if (
        typeof field === 'string' &&
        field.trim().length > 0 &&
        typeof message === 'string' &&
        message.trim().length > 0
      ) {
        fieldErrors[field] = message;
      }
    }
  }

  if (error.field !== undefined && fieldErrors[error.field] === undefined) {
    fieldErrors[error.field] = error.message;
  }

  return fieldErrors;
}

function isConflictWarning(value: unknown): value is ConflictWarning {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.type === 'string' &&
    typeof value.message === 'string' &&
    typeof value.exhibitionId === 'string' &&
    typeof value.exhibitionTitle === 'string' &&
    typeof value.relatedExhibitionId === 'string' &&
    typeof value.relatedExhibitionTitle === 'string'
  );
}

function conflictWarnings(error: ApiClientError): ConflictWarning[] {
  if (!isRecord(error.details) || !Array.isArray(error.details.conflicts)) {
    return [];
  }
  return error.details.conflicts.filter(isConflictWarning);
}

function requiredDateError(value: string, label: string): string | undefined {
  return ISO_DATE_PATTERN.test(value) ? undefined : `${label} is required.`;
}

function validateExhibition(values: ExhibitionFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = values.title.trim();
  const subtitle = values.subtitle.trim();
  const space = values.space.trim();
  const curator = values.curator.trim();
  const notes = values.notes.trim();

  if (title.length === 0) {
    errors.title = 'Title is required.';
  } else if (title.length > FIELD_LIMITS.exhibitionTitle) {
    errors.title = `Title must be ${FIELD_LIMITS.exhibitionTitle} characters or fewer.`;
  }
  if (subtitle.length > FIELD_LIMITS.subtitle) {
    errors.subtitle = `Subtitle must be ${FIELD_LIMITS.subtitle} characters or fewer.`;
  }
  if (space.length === 0) {
    errors.space = 'Space is required.';
  } else if (space.length > FIELD_LIMITS.space) {
    errors.space = `Space must be ${FIELD_LIMITS.space} characters or fewer.`;
  }
  if (curator.length > FIELD_LIMITS.curator) {
    errors.curator = `Curator must be ${FIELD_LIMITS.curator} characters or fewer.`;
  }
  if (notes.length > FIELD_LIMITS.notes) {
    errors.notes = `Notes must be ${FIELD_LIMITS.notes.toLocaleString('en-US')} characters or fewer.`;
  }

  const installStartError = requiredDateError(values.installStart, 'Installation start');
  const installEndError = requiredDateError(values.installEnd, 'Installation end');
  const startDateError = requiredDateError(values.startDate, 'Public opening');
  const endDateError = requiredDateError(values.endDate, 'Public closing');
  if (installStartError !== undefined) errors.installStart = installStartError;
  if (installEndError !== undefined) errors.installEnd = installEndError;
  if (startDateError !== undefined) errors.startDate = startDateError;
  if (endDateError !== undefined) errors.endDate = endDateError;

  if (
    errors.installStart === undefined &&
    errors.installEnd === undefined &&
    values.installStart > values.installEnd
  ) {
    errors.installEnd = 'Installation end must be on or after installation start.';
  }
  if (
    errors.installEnd === undefined &&
    errors.startDate === undefined &&
    values.installEnd > values.startDate
  ) {
    errors.startDate = 'Public opening must be on or after installation ends.';
  }
  if (
    errors.startDate === undefined &&
    errors.endDate === undefined &&
    values.startDate > values.endDate
  ) {
    errors.endDate = 'Public closing must be on or after public opening.';
  }

  return errors;
}

function wantsNewExhibition(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const value = new URLSearchParams(window.location.search).get('new');
  return value === '1' || value === 'exhibition';
}

function openExhibition(event: MouseEvent<HTMLAnchorElement>, id: string): void {
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
  navigate(`/exhibitions/${encodeURIComponent(id)}`);
}

interface ExhibitionEditorModalProps {
  onClose: () => void;
  onCreated: (exhibition: Exhibition, message: string) => void;
}

function ExhibitionEditorModal({ onClose, onCreated }: ExhibitionEditorModalProps) {
  const formId = `exhibition-form-${useId().replaceAll(':', '')}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ExhibitionFormValues>({
    curator: '',
    endDate: '',
    installEnd: '',
    installStart: '',
    notes: '',
    space: '',
    startDate: '',
    subtitle: '',
    title: '',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictWarning[]>([]);
  const [saving, setSaving] = useState(false);
  const [focusAttempt, setFocusAttempt] = useState(0);

  useEffect(() => {
    if (focusAttempt > 0) {
      focusFirstInvalid(formRef.current);
    }
  }, [focusAttempt]);

  const updateValue = (field: keyof ExhibitionFormValues, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    setSubmitError(null);
    setConflicts([]);
    setFieldErrors((current) => {
      if (current[field] === undefined) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (saving) {
      return;
    }

    const nextErrors = validateExhibition(values);
    setFieldErrors(nextErrors);
    setSubmitError(null);
    setConflicts([]);
    if (Object.keys(nextErrors).length > 0) {
      setFocusAttempt((attempt) => attempt + 1);
      return;
    }

    const input: CreateExhibitionInput = {
      curator: values.curator.trim() || null,
      endDate: values.endDate,
      installEnd: values.installEnd,
      installStart: values.installStart,
      notes: values.notes.trim() || null,
      space: values.space.trim(),
      startDate: values.startDate,
      subtitle: values.subtitle.trim() || null,
      title: values.title.trim(),
    };

    setSaving(true);
    try {
      const response = await createExhibition(input);
      onCreated(response.data, response.message);
    } catch (error: unknown) {
      setSaving(false);
      if (isApiClientError(error)) {
        setSubmitError(error.message);
        setFieldErrors(apiFieldErrors(error));
        setConflicts(conflictWarnings(error));
      } else {
        setSubmitError(errorMessage(error));
      }
      setFocusAttempt((attempt) => attempt + 1);
    }
  };

  return (
    <RecordModal
      closeDisabled={saving}
      description="New exhibitions begin as drafts. Installation dates must finish before the public opening."
      footer={
        <>
          <button
            className="button button--secondary"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button
            aria-busy={saving}
            className="button button--primary"
            disabled={saving}
            form={formId}
            type="submit"
          >
            Create exhibition
          </button>
        </>
      }
      onClose={onClose}
      title="New exhibition"
    >
      <LiveRegion message={saving ? 'Creating exhibition. Please wait.' : ''} />
      <form
        aria-label="Exhibition form"
        aria-busy={saving}
        className="stack"
        id={formId}
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        ref={formRef}
      >
        <FormErrorSummary errors={fieldErrors} message={submitError ?? undefined} />
        {conflicts.length === 0 ? null : (
          <div className="surface stack--tight" style={{ padding: '0.9rem' }}>
            <h3 className="form-error-summary__title">Related exhibition conflicts</h3>
            <ul className="conflict-list">
              {conflicts.map((conflict) => (
                <li
                  className="conflict-item"
                  key={`${conflict.type}-${conflict.relatedExhibitionId}-${conflict.artworkId ?? ''}`}
                >
                  <p className="conflict-item__title">
                    {CONFLICT_TYPE_LABELS[conflict.type]}: {conflict.relatedExhibitionTitle}
                  </p>
                  <p>{conflict.message}</p>
                </li>
              ))}
            </ul>
          </div>
        )}

        <fieldset className="fieldset" disabled={saving}>
          <legend className="fieldset__legend">Exhibition identity</legend>
          <div className="form-grid">
            <TextField
              error={fieldErrors.title}
              hint={`Up to ${FIELD_LIMITS.exhibitionTitle} characters.`}
              label="Title"
              name="title"
              onChange={(value) => updateValue('title', value)}
              required
              value={values.title}
            />
            <TextField
              error={fieldErrors.subtitle}
              hint={`Optional. Up to ${FIELD_LIMITS.subtitle} characters.`}
              label="Subtitle"
              name="subtitle"
              onChange={(value) => updateValue('subtitle', value)}
              value={values.subtitle}
            />
            <TextField
              error={fieldErrors.space}
              hint="The named gallery space. Overlapping occupancy is blocked by the server."
              label="Space"
              name="space"
              onChange={(value) => updateValue('space', value)}
              required
              value={values.space}
            />
            <TextField
              error={fieldErrors.curator}
              hint={`Optional. Up to ${FIELD_LIMITS.curator} characters.`}
              label="Curator"
              name="curator"
              onChange={(value) => updateValue('curator', value)}
              value={values.curator}
            />
          </div>
        </fieldset>

        <fieldset className="fieldset" disabled={saving}>
          <legend className="fieldset__legend">Installation dates</legend>
          <div className="form-grid">
            <DateField
              error={fieldErrors.installStart}
              hint="The first day the space is held for installation."
              label="Installation start"
              name="installStart"
              onChange={(value) => updateValue('installStart', value)}
              required
              value={values.installStart}
            />
            <DateField
              error={fieldErrors.installEnd}
              hint="On or after installation start."
              label="Installation end"
              name="installEnd"
              onChange={(value) => updateValue('installEnd', value)}
              required
              value={values.installEnd}
            />
          </div>
        </fieldset>

        <fieldset className="fieldset" disabled={saving}>
          <legend className="fieldset__legend">Public dates</legend>
          <div className="form-grid">
            <DateField
              error={fieldErrors.startDate}
              hint="On or after installation ends."
              label="Public opening"
              name="startDate"
              onChange={(value) => updateValue('startDate', value)}
              required
              value={values.startDate}
            />
            <DateField
              error={fieldErrors.endDate}
              hint="On or after public opening. Both endpoints are inclusive."
              label="Public closing"
              name="endDate"
              onChange={(value) => updateValue('endDate', value)}
              required
              value={values.endDate}
            />
          </div>
        </fieldset>

        <fieldset className="fieldset" disabled={saving}>
          <legend className="fieldset__legend">Working notes</legend>
          <TextAreaField
            error={fieldErrors.notes}
            hint={`Optional. Up to ${FIELD_LIMITS.notes.toLocaleString('en-US')} characters.`}
            label="Notes"
            name="notes"
            onChange={(value) => updateValue('notes', value)}
            rows={5}
            value={values.notes}
          />
        </fieldset>
      </form>
    </RecordModal>
  );
}

export default function ExhibitionsPage() {
  const [listState, setListState] = useState<LoadState<ExhibitionListResponse>>({
    data: null,
    error: null,
    key: 'initial',
    loading: true,
  });
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState<ExhibitionFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<ExhibitionFilters>(EMPTY_FILTERS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editorOpen, setEditorOpen] = useState(() => wantsNewExhibition());
  const [notice, setNotice] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');
  const [exportState, setExportState] = useState<ExportState>(EMPTY_EXPORT_STATE);
  const exportControllerRef = useRef<AbortController | null>(null);
  const navigationTimerRef = useRef<number | null>(null);

  const requestKey = `exhibitions|${filters.search}|${filters.space}|${filters.status}|${page}|${refreshKey}`;
  const response = listState.key === requestKey ? listState.data : null;
  const loadError = listState.key === requestKey ? listState.error : null;
  const loading = listState.key !== requestKey || listState.loading;

  useEffect(() => {
    if (wantsNewExhibition()) {
      navigate('/exhibitions', { replace: true });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const result = await listExhibitions(
          {
            direction: 'asc',
            page,
            pageSize: PAGE_SIZE,
            search: filters.search || undefined,
            sort: 'startDate',
            space: filters.space || undefined,
            status: filters.status || undefined,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setListState({ data: result, error: null, key: requestKey, loading: false });
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setListState({
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
  }, [filters, page, refreshKey, requestKey]);

  useEffect(() => {
    return () => {
      exportControllerRef.current?.abort();
      if (navigationTimerRef.current !== null) {
        window.clearTimeout(navigationTimerRef.current);
      }
    };
  }, []);

  const submitFilters = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setPage(1);
    setFilters({
      search: draftFilters.search.trim(),
      space: draftFilters.space.trim(),
      status: draftFilters.status,
    });
  };

  const clearFilters = (): void => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

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

  const handleCreated = (exhibition: Exhibition, message: string): void => {
    setEditorOpen(false);
    setNotice(message);
    setLiveMessage(`${exhibition.title}: ${message} Opening the new exhibition workspace.`);
    setRefreshKey((key) => key + 1);
    navigationTimerRef.current = window.setTimeout(() => {
      navigate(`/exhibitions/${encodeURIComponent(exhibition.id)}`);
    }, 300);
  };

  const pagination: PaginationMeta | null = response?.pagination ?? null;
  const isEmpty = response !== null && response.data.length === 0;
  const rangeStart =
    pagination === null || pagination.total === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd =
    pagination === null ? 0 : Math.min(pagination.page * pagination.pageSize, pagination.total);

  return (
    <section
      className="page page--exhibitions"
      aria-busy={loading || exportState.pending}
      aria-labelledby="exhibitions-page-title"
    >
      <PageHeader
        actions={
          <>
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
            {isEmpty ? null : (
              <button
                className="button button--primary"
                onClick={() => {
                  setEditorOpen(true);
                }}
                type="button"
              >
                <Plus aria-hidden="true" focusable="false" size={18} strokeWidth={2} />
                New exhibition
              </button>
            )}
          </>
        }
        description="Plan installations, track show readiness, and keep the gallery programme within its spaces and dates."
        eyebrow="Programme / Calendar"
        title="Exhibitions on the horizon"
        titleId="exhibitions-page-title"
      />

      <LiveRegion message={liveMessage} />
      {notice === null ? null : (
        <InlineNotice
          onDismiss={() => {
            setNotice(null);
          }}
          title="Exhibition created"
          tone="success"
        >
          {notice}
        </InlineNotice>
      )}
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

      <form
        aria-busy={loading}
        aria-label="Filter exhibitions"
        className="toolbar"
        onSubmit={submitFilters}
      >
        <div className="toolbar__group">
          <TextField
            hint="Searches titles, subtitles, spaces, and curators."
            label="Search exhibitions"
            name="search"
            onChange={(value) => {
              setDraftFilters((current) => ({ ...current, search: value }));
            }}
            placeholder="Title, space, or curator"
            type="search"
            value={draftFilters.search}
          />
          <TextField
            hint="Matches the named space exactly, ignoring case."
            label="Space"
            name="space"
            onChange={(value) => {
              setDraftFilters((current) => ({ ...current, space: value }));
            }}
            placeholder="Gallery space"
            value={draftFilters.space}
          />
          <SelectField
            label="Status"
            name="status"
            onChange={(value) => {
              const status: '' | ExhibitionStatus =
                value === 'draft' ||
                value === 'planned' ||
                value === 'installing' ||
                value === 'open' ||
                value === 'closed' ||
                value === 'cancelled'
                  ? value
                  : '';
              setDraftFilters((current) => ({ ...current, status }));
            }}
            options={STATUS_FILTER_OPTIONS}
            value={draftFilters.status}
          />
        </div>
        <div className="toolbar__actions">
          <button
            aria-busy={loading}
            className="button button--primary"
            disabled={loading}
            type="submit"
          >
            <Search aria-hidden="true" focusable="false" size={17} strokeWidth={1.9} />
            Search
          </button>
          <button
            className="button button--ghost"
            disabled={loading}
            onClick={clearFilters}
            type="button"
          >
            <RotateCcw aria-hidden="true" focusable="false" size={16} strokeWidth={1.9} />
            Clear filters
          </button>
        </div>
      </form>

      {loading ? (
        <LoadingState
          description="Loading the exhibition programme, readiness, conflicts, and task counts."
          label="Loading exhibitions"
        />
      ) : loadError !== null ? (
        <ErrorState
          message={loadError}
          onRetry={() => {
            setRefreshKey((key) => key + 1);
          }}
          title="The exhibition programme could not load"
        />
      ) : response === null || pagination === null ? null : response.data.length === 0 ? (
        <EmptyState
          action={
            <button
              className="button button--primary"
              onClick={() => {
                setEditorOpen(true);
              }}
              type="button"
            >
              <Plus aria-hidden="true" focusable="false" size={18} strokeWidth={2} />
              New exhibition
            </button>
          }
          icon={<CalendarDays aria-hidden="true" focusable="false" size={25} strokeWidth={1.6} />}
          message={
            filters.search.length > 0 || filters.space.length > 0 || filters.status !== ''
              ? 'No exhibitions match the current search, space, and status. Clear the filters or add a new show.'
              : 'The programme is empty. Create a draft exhibition to begin planning its hang, tasks, and readiness.'
          }
          title="No exhibitions found"
        />
      ) : (
        <div className="stack">
          <p className="pagination__summary" role="status">
            Showing {rangeStart}–{rangeEnd} of {pagination.total} exhibition
            {pagination.total === 1 ? '' : 's'}
          </p>
          <div className="table-wrap">
            <table className="data-table data-table--stack">
              <caption>Exhibitions matching the current filters, ordered by opening date.</caption>
              <thead>
                <tr>
                  <th scope="col">Exhibition</th>
                  <th scope="col">Space</th>
                  <th scope="col">Dates</th>
                  <th scope="col">Status</th>
                  <th scope="col">Readiness</th>
                  <th scope="col">Hang &amp; tasks</th>
                  <th scope="col">Conflicts</th>
                  <th className="data-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {response.data.map((exhibition) => {
                  const titleId = `exhibition-title-${exhibition.id}`;
                  return (
                    <tr key={exhibition.id}>
                      <th data-label="Exhibition" id={titleId} scope="row">
                        <span className="data-table__primary">{exhibition.title}</span>
                        {exhibition.subtitle === null ? null : (
                          <span className="data-table__secondary">{exhibition.subtitle}</span>
                        )}
                      </th>
                      <td data-label="Space">{exhibition.space}</td>
                      <td data-label="Dates">
                        <span>
                          Public {formatDateRange(exhibition.startDate, exhibition.endDate)}
                        </span>
                        <span className="data-table__secondary">
                          Install {formatDateRange(exhibition.installStart, exhibition.installEnd)}
                        </span>
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={exhibition.status} />
                      </td>
                      <td data-label="Readiness">
                        <ReadinessMeter
                          compact
                          state={exhibition.derived.readinessState}
                          value={exhibition.derived.readinessPercent}
                        />
                      </td>
                      <td data-label="Hang & tasks">
                        <span>
                          {exhibition.derived.placedArtworkCount} of{' '}
                          {exhibition.derived.artworkCount} artworks placed
                        </span>
                        <span className="data-table__secondary">
                          {exhibition.derived.openTaskCount} open of {exhibition.derived.taskCount}{' '}
                          tasks
                        </span>
                      </td>
                      <td data-label="Conflicts">
                        {exhibition.derived.conflictCount === 0 ? (
                          <span className="cluster text-success">
                            <CheckCircle2
                              aria-hidden="true"
                              focusable="false"
                              size={15}
                              strokeWidth={2}
                            />
                            None
                          </span>
                        ) : (
                          <span className="cluster text-warning">
                            <AlertTriangle
                              aria-hidden="true"
                              focusable="false"
                              size={15}
                              strokeWidth={2}
                            />
                            {exhibition.derived.conflictCount} conflict
                            {exhibition.derived.conflictCount === 1 ? '' : 's'}
                          </span>
                        )}
                      </td>
                      <td className="data-table__actions" data-label="Actions">
                        <a
                          aria-describedby={titleId}
                          className="button button--secondary button--small"
                          href={`/exhibitions/${encodeURIComponent(exhibition.id)}`}
                          onClick={(event) => openExhibition(event, exhibition.id)}
                        >
                          Open exhibition
                          <ArrowUpRight
                            aria-hidden="true"
                            focusable="false"
                            size={16}
                            strokeWidth={2}
                          />
                        </a>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <nav aria-label="Exhibition pages" className="pagination">
            <span className="pagination__summary">
              Page {pagination.page} of {Math.max(1, pagination.totalPages)}
            </span>
            <div className="pagination__pages">
              <button
                className="button button--secondary button--small"
                disabled={loading || pagination.page <= 1}
                onClick={() => {
                  setPage((current) => Math.max(1, current - 1));
                }}
                type="button"
              >
                <ChevronLeft aria-hidden="true" focusable="false" size={16} strokeWidth={2} />
                Previous page
              </button>
              <button
                className="button button--secondary button--small"
                disabled={loading || pagination.page >= pagination.totalPages}
                onClick={() => {
                  setPage((current) => current + 1);
                }}
                type="button"
              >
                Next page
                <ChevronRight aria-hidden="true" focusable="false" size={16} strokeWidth={2} />
              </button>
            </div>
          </nav>
        </div>
      )}

      {editorOpen ? (
        <ExhibitionEditorModal
          onClose={() => {
            setEditorOpen(false);
          }}
          onCreated={handleCreated}
        />
      ) : null}
    </section>
  );
}
