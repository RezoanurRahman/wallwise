import {
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  UsersRound,
} from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { ARTIST_STATUSES, FIELD_LIMITS } from '../../shared/constants';
import type { Artist, ArtistListResponse, ArtistStatus, PaginationMeta } from '../../shared/types';
import { createArtist, isApiClientError, listArtists, updateArtist } from '../api';
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
} from '../components/FormControls';
import RecordModal from '../components/RecordModal';
import { StatusBadge } from '../components/StatusBadge';
import { focusFirstInvalid, formatTimestamp, navigate, statusLabel } from '../utils';

const PAGE_SIZE = 25;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS_FILTER_OPTIONS = [
  { label: 'All statuses', value: '' },
  ...ARTIST_STATUSES.map((status) => ({ label: statusLabel(status), value: status })),
];

const STATUS_OPTIONS = ARTIST_STATUSES.map((status) => ({
  label: statusLabel(status),
  value: status,
}));

interface ArtistFilters {
  search: string;
  status: '' | ArtistStatus;
}

const EMPTY_FILTERS: ArtistFilters = { search: '', status: '' };

interface ArtistFormValues {
  bio: string;
  email: string;
  name: string;
  status: string;
}

type ArtistEditor = { mode: 'create' } | { artist: Artist; mode: 'edit' };

interface ArtistListState {
  data: ArtistListResponse | null;
  error: string | null;
  key: string;
  loading: boolean;
}

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

function validateArtist(values: ArtistFormValues): Record<string, string> {
  const errors: Record<string, string> = {};
  const name = values.name.trim();
  const email = values.email.trim();

  if (name.length === 0) {
    errors.name = 'Name is required.';
  } else if (name.length > FIELD_LIMITS.artistName) {
    errors.name = `Name must be ${FIELD_LIMITS.artistName} characters or fewer.`;
  }

  if (email.length > FIELD_LIMITS.email) {
    errors.email = `Email must be ${FIELD_LIMITS.email} characters or fewer.`;
  } else if (email.length > 0 && !EMAIL_PATTERN.test(email)) {
    errors.email = 'Enter a valid email address.';
  }

  if (values.bio.trim().length > FIELD_LIMITS.bio) {
    errors.bio = `Bio must be ${FIELD_LIMITS.bio} characters or fewer.`;
  }

  if (values.status !== 'active' && values.status !== 'archived') {
    errors.status = 'Choose active or archived.';
  }

  return errors;
}

function bioExcerpt(bio: string | null): string {
  if (bio === null || bio.trim().length === 0) {
    return 'No bio recorded yet.';
  }

  const normalized = bio.trim().replace(/\s+/g, ' ');
  return normalized.length > 130 ? `${normalized.slice(0, 127)}…` : normalized;
}

function wantsNewArtist(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const value = new URLSearchParams(window.location.search).get('new');
  return value === '1' || value === 'artist';
}

interface ArtistEditorModalProps {
  artist: Artist | null;
  onClose: () => void;
  onSaved: (artist: Artist, message: string) => void;
}

function ArtistEditorModal({ artist, onClose, onSaved }: ArtistEditorModalProps) {
  const formId = `artist-form-${useId().replaceAll(':', '')}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ArtistFormValues>({
    bio: artist?.bio ?? '',
    email: artist?.email ?? '',
    name: artist?.name ?? '',
    status: artist?.status ?? 'active',
  });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusAttempt, setFocusAttempt] = useState(0);

  useEffect(() => {
    if (focusAttempt > 0) {
      focusFirstInvalid(formRef.current);
    }
  }, [focusAttempt]);

  const updateValue = (field: keyof ArtistFormValues, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    setSubmitError(null);
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

    const nextErrors = validateArtist(values);
    setFieldErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) {
      setFocusAttempt((attempt) => attempt + 1);
      return;
    }

    const status: ArtistStatus = values.status === 'archived' ? 'archived' : 'active';
    const input = {
      bio: values.bio.trim() || null,
      email: values.email.trim() || null,
      name: values.name.trim(),
      status,
    };

    setSaving(true);
    try {
      const response =
        artist === null ? await createArtist(input) : await updateArtist(artist.id, input);
      onSaved(response.data, response.message);
    } catch (error: unknown) {
      setSaving(false);
      if (isApiClientError(error)) {
        setSubmitError(error.message);
        setFieldErrors(apiFieldErrors(error));
      } else {
        setSubmitError(errorMessage(error));
      }
      setFocusAttempt((attempt) => attempt + 1);
    }
  };

  return (
    <RecordModal
      closeDisabled={saving}
      description="Required fields are marked. Optional text is stored only when entered."
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
            Save artist
          </button>
        </>
      }
      onClose={onClose}
      title={artist === null ? 'Add artist' : 'Edit artist'}
    >
      <LiveRegion message={saving ? 'Saving artist. Please wait.' : ''} />
      <form
        aria-label="Artist form"
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
        <fieldset className="fieldset" disabled={saving}>
          <legend className="fieldset__legend">Artist details</legend>
          <div className="form-grid">
            <TextField
              autoComplete="name"
              error={fieldErrors.name}
              hint={`Up to ${FIELD_LIMITS.artistName} characters.`}
              label="Name"
              name="name"
              onChange={(value) => updateValue('name', value)}
              required
              value={values.name}
            />
            <TextField
              autoComplete="email"
              error={fieldErrors.email}
              hint="Optional. Must be a valid address and unique in the roster."
              label="Email"
              name="email"
              onChange={(value) => updateValue('email', value)}
              type="email"
              value={values.email}
            />
            <TextAreaField
              className="field--full"
              error={fieldErrors.bio}
              hint={`Optional. Up to ${FIELD_LIMITS.bio.toLocaleString('en-US')} characters.`}
              label="Bio"
              name="bio"
              onChange={(value) => updateValue('bio', value)}
              rows={5}
              value={values.bio}
            />
            <SelectField
              error={fieldErrors.status}
              hint="Archived artists remain visible and keep their linked artworks."
              label="Status"
              name="status"
              onChange={(value) => updateValue('status', value)}
              options={STATUS_OPTIONS}
              required
              value={values.status}
            />
          </div>
        </fieldset>
      </form>
    </RecordModal>
  );
}

export default function ArtistsPage() {
  const [listState, setListState] = useState<ArtistListState>({
    data: null,
    error: null,
    key: 'initial',
    loading: true,
  });
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState<ArtistFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<ArtistFilters>(EMPTY_FILTERS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editor, setEditor] = useState<ArtistEditor | null>(() =>
    wantsNewArtist() ? { mode: 'create' } : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  const requestKey = `artists|${filters.search}|${filters.status}|${page}|${refreshKey}`;
  const response = listState.key === requestKey ? listState.data : null;
  const loadError = listState.key === requestKey ? listState.error : null;
  const loading = listState.key !== requestKey || listState.loading;

  useEffect(() => {
    if (wantsNewArtist()) {
      navigate('/artists', { replace: true });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const result = await listArtists(
          {
            direction: 'asc',
            page,
            pageSize: PAGE_SIZE,
            search: filters.search || undefined,
            sort: 'name',
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

  const submitFilters = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setPage(1);
    setFilters({ search: draftFilters.search.trim(), status: draftFilters.status });
  };

  const clearFilters = (): void => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const handleSaved = (artist: Artist, message: string): void => {
    const archivedNow =
      editor?.mode === 'edit' &&
      editor.artist.status !== 'archived' &&
      artist.status === 'archived';
    const confirmation = archivedNow
      ? `${artist.name} was archived. Their roster record and linked artworks are preserved.`
      : message;

    setEditor(null);
    setNotice(confirmation);
    setLiveMessage(`${artist.name}: ${confirmation}`);
    setRefreshKey((key) => key + 1);
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
      className="page page--artists"
      aria-busy={loading}
      aria-labelledby="artists-page-title"
    >
      <PageHeader
        actions={
          isEmpty ? undefined : (
            <button
              className="button button--primary"
              onClick={() => {
                setEditor({ mode: 'create' });
              }}
              type="button"
            >
              <Plus aria-hidden="true" focusable="false" size={18} strokeWidth={2} />
              Add artist
            </button>
          )
        }
        description="Maintain a durable, searchable roster of the people behind the work, including archived practices and their linked artworks."
        eyebrow="People / Roster"
        title="Artists & practices"
        titleId="artists-page-title"
      />

      <LiveRegion message={liveMessage} />
      {notice === null ? null : (
        <InlineNotice
          onDismiss={() => {
            setNotice(null);
          }}
          title="Roster updated"
          tone="success"
        >
          {notice}
        </InlineNotice>
      )}

      <form
        aria-busy={loading}
        aria-label="Filter artists"
        className="toolbar"
        onSubmit={submitFilters}
      >
        <div className="toolbar__group">
          <TextField
            hint="Searches names and email addresses."
            label="Search artists"
            name="search"
            onChange={(value) => {
              setDraftFilters((current) => ({ ...current, search: value }));
            }}
            placeholder="Name or email"
            type="search"
            value={draftFilters.search}
          />
          <SelectField
            label="Status"
            name="status"
            onChange={(value) => {
              const status: '' | ArtistStatus =
                value === 'active' || value === 'archived' ? value : '';
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
          description="Loading the durable artist roster and matching records."
          label="Loading artists"
        />
      ) : loadError !== null ? (
        <ErrorState
          message={loadError}
          onRetry={() => {
            setRefreshKey((key) => key + 1);
          }}
          title="The artist roster could not load"
        />
      ) : response === null || pagination === null ? null : response.data.length === 0 ? (
        <EmptyState
          action={
            <button
              className="button button--primary"
              onClick={() => {
                setEditor({ mode: 'create' });
              }}
              type="button"
            >
              <Plus aria-hidden="true" focusable="false" size={18} strokeWidth={2} />
              Add artist
            </button>
          }
          icon={<UsersRound aria-hidden="true" focusable="false" size={25} strokeWidth={1.6} />}
          message={
            filters.search.length > 0 || filters.status !== ''
              ? 'No artists match the current search and status. Clear the filters or add a new artist.'
              : 'The roster is empty. Add the first artist to begin cataloguing artwork and building exhibitions.'
          }
          title="No artists found"
        />
      ) : (
        <div className="stack">
          <p className="pagination__summary" role="status">
            Showing {rangeStart}–{rangeEnd} of {pagination.total} artist
            {pagination.total === 1 ? '' : 's'}
          </p>
          <div className="table-wrap">
            <table className="data-table data-table--stack">
              <caption>
                Artists matching the current filters, ordered alphabetically by name.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Artist</th>
                  <th scope="col">Email</th>
                  <th scope="col">Bio</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th className="data-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {response.data.map((artist) => {
                  const nameId = `artist-name-${artist.id}`;
                  return (
                    <tr key={artist.id}>
                      <th data-label="Artist" id={nameId} scope="row">
                        <span className="data-table__primary">{artist.name}</span>
                        {artist.status === 'archived' ? (
                          <span className="data-table__secondary">
                            Archived and retained with linked artwork.
                          </span>
                        ) : null}
                      </th>
                      <td data-label="Email">{artist.email ?? 'Not provided'}</td>
                      <td className="max-prose" data-label="Bio">
                        {bioExcerpt(artist.bio)}
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={artist.status} />
                      </td>
                      <td data-label="Updated">
                        <time dateTime={artist.updatedAt}>{formatTimestamp(artist.updatedAt)}</time>
                      </td>
                      <td className="data-table__actions" data-label="Actions">
                        <button
                          aria-describedby={nameId}
                          className="button button--secondary button--small"
                          onClick={() => {
                            setEditor({ artist, mode: 'edit' });
                          }}
                          type="button"
                        >
                          <Pencil
                            aria-hidden="true"
                            focusable="false"
                            size={15}
                            strokeWidth={1.9}
                          />
                          Edit
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <nav aria-label="Artist pages" className="pagination">
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

      {editor === null ? null : (
        <ArtistEditorModal
          artist={editor.mode === 'edit' ? editor.artist : null}
          key={editor.mode === 'edit' ? editor.artist.id : 'new-artist'}
          onClose={() => {
            setEditor(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}
