import { ChevronLeft, ChevronRight, Frame, Pencil, Plus, RotateCcw, Search } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';

import { ARTWORK_STATUSES, FIELD_LIMITS } from '../../shared/constants';
import type {
  Artist,
  ArtistListResponse,
  Artwork,
  ArtworkListResponse,
  ArtworkStatus,
  PaginationMeta,
} from '../../shared/types';
import { createArtwork, isApiClientError, listArtists, listArtworks, updateArtwork } from '../api';
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
  CheckboxField,
  FormErrorSummary,
  NumberField,
  SelectField,
  TextField,
} from '../components/FormControls';
import RecordModal from '../components/RecordModal';
import { StatusBadge } from '../components/StatusBadge';
import {
  focusFirstInvalid,
  formatDimensions,
  formatTimestamp,
  navigate,
  statusLabel,
} from '../utils';

const PAGE_SIZE = 25;

const STATUS_FILTER_OPTIONS = [
  { label: 'All statuses', value: '' },
  ...ARTWORK_STATUSES.map((status) => ({ label: statusLabel(status), value: status })),
];

const STATUS_OPTIONS = ARTWORK_STATUSES.map((status) => ({
  label: statusLabel(status),
  value: status,
}));

interface ArtworkFilters {
  artistId: string;
  search: string;
  status: '' | ArtworkStatus;
}

const EMPTY_FILTERS: ArtworkFilters = { artistId: '', search: '', status: '' };

interface ArtworkFormValues {
  artistId: string;
  framed: boolean;
  heightCm: string;
  medium: string;
  status: string;
  title: string;
  widthCm: string;
  year: string;
}

type ArtworkEditor = { artwork: Artwork; mode: 'edit' } | { mode: 'create' };

interface LoadState<T> {
  data: T | null;
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

function isArtworkStatus(value: string): value is ArtworkStatus {
  return value === 'available' || value === 'reserved' || value === 'retired';
}

function parseOptionalYear(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function parseOptionalDimension(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function validateArtwork(
  values: ArtworkFormValues,
  artists: readonly Artist[],
  artwork: Artwork | null,
): Record<string, string> {
  const errors: Record<string, string> = {};
  const title = values.title.trim();
  const medium = values.medium.trim();
  const year = parseOptionalYear(values.year);
  const widthCm = parseOptionalDimension(values.widthCm);
  const heightCm = parseOptionalDimension(values.heightCm);
  const artistExists =
    artists.some((artist) => artist.id === values.artistId) ||
    artwork?.artist.id === values.artistId;

  if (values.artistId.length === 0) {
    errors.artistId = 'Select the artist who made this work.';
  } else if (!artistExists) {
    errors.artistId = 'Select an existing artist from the roster.';
  }

  if (title.length === 0) {
    errors.title = 'Title is required.';
  } else if (title.length > FIELD_LIMITS.artworkTitle) {
    errors.title = `Title must be ${FIELD_LIMITS.artworkTitle} characters or fewer.`;
  }

  if (medium.length === 0) {
    errors.medium = 'Medium is required.';
  } else if (medium.length > FIELD_LIMITS.medium) {
    errors.medium = `Medium must be ${FIELD_LIMITS.medium} characters or fewer.`;
  }

  if (year !== null && (!Number.isFinite(year) || !Number.isInteger(year))) {
    errors.year = 'Year must be a whole number.';
  } else if (year !== null && (year < 1000 || year > 2100)) {
    errors.year = 'Year must be between 1000 and 2100.';
  }

  if (widthCm !== null && (!Number.isFinite(widthCm) || widthCm <= 0 || widthCm > 10_000)) {
    errors.widthCm = 'Width must be greater than 0 and at most 10,000 cm.';
  }

  if (heightCm !== null && (!Number.isFinite(heightCm) || heightCm <= 0 || heightCm > 10_000)) {
    errors.heightCm = 'Height must be greater than 0 and at most 10,000 cm.';
  }

  if (!isArtworkStatus(values.status)) {
    errors.status = 'Choose available, reserved, or retired.';
  }

  return errors;
}

function wantsNewArtwork(): boolean {
  if (typeof window === 'undefined') {
    return false;
  }
  const value = new URLSearchParams(window.location.search).get('new');
  return value === '1' || value === 'artwork';
}

function artistName(artist: { name: string; status: Artist['status'] }): string {
  return artist.status === 'archived' ? `${artist.name} (archived)` : artist.name;
}

function formArtistOptions(artists: readonly Artist[], artwork: Artwork | null) {
  const options = artists.map((artist) => ({ label: artistName(artist), value: artist.id }));
  if (artwork !== null && !options.some((option) => option.value === artwork.artist.id)) {
    options.push({ label: artistName(artwork.artist), value: artwork.artist.id });
  }
  return options;
}

interface ArtworkEditorModalProps {
  artists: readonly Artist[];
  artwork: Artwork | null;
  onClose: () => void;
  onSaved: (artwork: Artwork, message: string) => void;
}

function ArtworkEditorModal({ artists, artwork, onClose, onSaved }: ArtworkEditorModalProps) {
  const formId = `artwork-form-${useId().replaceAll(':', '')}`;
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<ArtworkFormValues>({
    artistId: artwork?.artist.id ?? '',
    framed: artwork?.framed ?? false,
    heightCm:
      artwork?.heightCm === null || artwork?.heightCm === undefined ? '' : String(artwork.heightCm),
    medium: artwork?.medium ?? '',
    status: artwork?.status ?? 'available',
    title: artwork?.title ?? '',
    widthCm:
      artwork?.widthCm === null || artwork?.widthCm === undefined ? '' : String(artwork.widthCm),
    year: artwork?.year === null || artwork?.year === undefined ? '' : String(artwork.year),
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

  const updateValue = (field: keyof ArtworkFormValues, value: string): void => {
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

    const nextErrors = validateArtwork(values, artists, artwork);
    setFieldErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) {
      setFocusAttempt((attempt) => attempt + 1);
      return;
    }

    const status: ArtworkStatus = isArtworkStatus(values.status) ? values.status : 'available';
    const input = {
      artistId: values.artistId,
      framed: values.framed,
      heightCm: parseOptionalDimension(values.heightCm),
      medium: values.medium.trim(),
      status,
      title: values.title.trim(),
      widthCm: parseOptionalDimension(values.widthCm),
      year: parseOptionalYear(values.year),
    };

    setSaving(true);
    try {
      const response =
        artwork === null ? await createArtwork(input) : await updateArtwork(artwork.id, input);
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
      description="The artist and title identify the work throughout Wallwise. Numeric fields may be left blank."
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
            Save artwork
          </button>
        </>
      }
      onClose={onClose}
      title={artwork === null ? 'Add artwork' : 'Edit artwork'}
    >
      <LiveRegion message={saving ? 'Saving artwork. Please wait.' : ''} />
      <form
        aria-label="Artwork form"
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
          <legend className="fieldset__legend">Artwork record</legend>
          <div className="form-grid">
            <SelectField
              className="field--full"
              error={fieldErrors.artistId}
              hint={
                artists.length === 0
                  ? 'No artists are available. Add an artist to the roster first.'
                  : 'Archived artists are labeled in the list.'
              }
              label="Artist"
              name="artistId"
              onChange={(value) => updateValue('artistId', value)}
              options={formArtistOptions(artists, artwork)}
              placeholder="Select an artist"
              required
              value={values.artistId}
            />
            <TextField
              error={fieldErrors.title}
              hint={`Up to ${FIELD_LIMITS.artworkTitle} characters.`}
              label="Title"
              name="title"
              onChange={(value) => updateValue('title', value)}
              required
              value={values.title}
            />
            <TextField
              error={fieldErrors.medium}
              hint={`Up to ${FIELD_LIMITS.medium} characters.`}
              label="Medium"
              name="medium"
              onChange={(value) => updateValue('medium', value)}
              required
              value={values.medium}
            />
            <NumberField
              error={fieldErrors.year}
              hint="Optional. Whole year from 1000 to 2100."
              label="Year"
              max={2100}
              min={1000}
              name="year"
              onChange={(value) => updateValue('year', value)}
              step={1}
              value={values.year}
            />
            <SelectField
              error={fieldErrors.status}
              hint="Retired works stay in the catalogue and keep existing placements."
              label="Status"
              name="status"
              onChange={(value) => updateValue('status', value)}
              options={STATUS_OPTIONS}
              required
              value={values.status}
            />
            <NumberField
              error={fieldErrors.widthCm}
              hint="Optional. Greater than 0 and at most 10,000 cm."
              label="Width (cm)"
              min={0.01}
              name="widthCm"
              onChange={(value) => updateValue('widthCm', value)}
              step="any"
              value={values.widthCm}
            />
            <NumberField
              error={fieldErrors.heightCm}
              hint="Optional. Greater than 0 and at most 10,000 cm."
              label="Height (cm)"
              min={0.01}
              name="heightCm"
              onChange={(value) => updateValue('heightCm', value)}
              step="any"
              value={values.heightCm}
            />
            <CheckboxField
              className="field--full"
              hint="Mark when the work is framed for display."
              label="Framed"
              name="framed"
              onChange={(checked) => {
                setValues((current) => ({ ...current, framed: checked }));
              }}
              value={values.framed}
            />
          </div>
        </fieldset>
      </form>
    </RecordModal>
  );
}

export default function ArtworksPage() {
  const [artistState, setArtistState] = useState<LoadState<ArtistListResponse>>({
    data: null,
    error: null,
    key: 'initial-artists',
    loading: true,
  });
  const [artistsRefreshKey, setArtistsRefreshKey] = useState(0);
  const [artworkState, setArtworkState] = useState<LoadState<ArtworkListResponse>>({
    data: null,
    error: null,
    key: 'initial-artworks',
    loading: true,
  });
  const [page, setPage] = useState(1);
  const [draftFilters, setDraftFilters] = useState<ArtworkFilters>(EMPTY_FILTERS);
  const [filters, setFilters] = useState<ArtworkFilters>(EMPTY_FILTERS);
  const [refreshKey, setRefreshKey] = useState(0);
  const [editor, setEditor] = useState<ArtworkEditor | null>(() =>
    wantsNewArtwork() ? { mode: 'create' } : null,
  );
  const [notice, setNotice] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState('');

  const artistRequestKey = `artists|${artistsRefreshKey}`;
  const artworkRequestKey = `artworks|${filters.search}|${filters.artistId}|${filters.status}|${page}|${refreshKey}`;
  const artistResponse = artistState.key === artistRequestKey ? artistState.data : null;
  const artistsError = artistState.key === artistRequestKey ? artistState.error : null;
  const artistsLoading = artistState.key !== artistRequestKey || artistState.loading;
  const response = artworkState.key === artworkRequestKey ? artworkState.data : null;
  const loadError = artworkState.key === artworkRequestKey ? artworkState.error : null;
  const loading = artworkState.key !== artworkRequestKey || artworkState.loading;

  useEffect(() => {
    if (wantsNewArtwork()) {
      navigate('/artworks', { replace: true });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const result = await listArtists({ pageSize: 100, sort: 'name' }, controller.signal);
        if (!controller.signal.aborted) {
          setArtistState({
            data: result,
            error: null,
            key: artistRequestKey,
            loading: false,
          });
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setArtistState({
            data: null,
            error: errorMessage(error),
            key: artistRequestKey,
            loading: false,
          });
        }
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, [artistRequestKey]);

  useEffect(() => {
    const controller = new AbortController();

    const load = async (): Promise<void> => {
      try {
        const result = await listArtworks(
          {
            artistId: filters.artistId || undefined,
            direction: 'asc',
            page,
            pageSize: PAGE_SIZE,
            search: filters.search || undefined,
            sort: 'title',
            status: filters.status || undefined,
          },
          controller.signal,
        );
        if (!controller.signal.aborted) {
          setArtworkState({
            data: result,
            error: null,
            key: artworkRequestKey,
            loading: false,
          });
        }
      } catch (error: unknown) {
        if (!controller.signal.aborted) {
          setArtworkState({
            data: null,
            error: errorMessage(error),
            key: artworkRequestKey,
            loading: false,
          });
        }
      }
    };

    void load();
    return () => {
      controller.abort();
    };
  }, [artworkRequestKey, filters, page, refreshKey]);

  const submitFilters = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    setPage(1);
    setFilters({
      artistId: draftFilters.artistId,
      search: draftFilters.search.trim(),
      status: draftFilters.status,
    });
  };

  const clearFilters = (): void => {
    setDraftFilters(EMPTY_FILTERS);
    setFilters(EMPTY_FILTERS);
    setPage(1);
  };

  const handleSaved = (artwork: Artwork, message: string): void => {
    setEditor(null);
    setNotice(message);
    setLiveMessage(`${message} ${artwork.title} is in the working collection.`);
    setRefreshKey((key) => key + 1);
  };

  const artists = artistResponse?.data ?? [];
  const pagination: PaginationMeta | null = response?.pagination ?? null;
  const pageLoading = loading || artistsLoading;
  const pageError = loadError ?? artistsError;
  const isEmpty = response !== null && response.data.length === 0;
  const rangeStart =
    pagination === null || pagination.total === 0
      ? 0
      : (pagination.page - 1) * pagination.pageSize + 1;
  const rangeEnd =
    pagination === null ? 0 : Math.min(pagination.page * pagination.pageSize, pagination.total);
  const artistFilterOptions = [
    { label: 'All artists', value: '' },
    ...artists.map((artist) => ({ label: artistName(artist), value: artist.id })),
  ];

  return (
    <section
      className="page page--artworks"
      aria-busy={pageLoading}
      aria-labelledby="artworks-page-title"
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
              Add artwork
            </button>
          )
        }
        description="Move between available, reserved, and retired works while keeping each artist, medium, dimension, and framing detail close at hand."
        eyebrow="Collection / Works"
        title="The working collection"
        titleId="artworks-page-title"
      />

      <LiveRegion message={liveMessage} />
      {notice === null ? null : (
        <InlineNotice
          onDismiss={() => {
            setNotice(null);
          }}
          title="Collection updated"
          tone="success"
        >
          {notice}
        </InlineNotice>
      )}

      <form
        aria-busy={pageLoading}
        aria-label="Filter artworks"
        className="toolbar"
        onSubmit={submitFilters}
      >
        <div className="toolbar__group">
          <TextField
            hint="Searches titles, media, and artist names."
            label="Search artworks"
            name="search"
            onChange={(value) => {
              setDraftFilters((current) => ({ ...current, search: value }));
            }}
            placeholder="Title, medium, or artist"
            type="search"
            value={draftFilters.search}
          />
          <SelectField
            label="Artist"
            name="artistId"
            onChange={(value) => {
              setDraftFilters((current) => ({ ...current, artistId: value }));
            }}
            options={artistFilterOptions}
            value={draftFilters.artistId}
          />
          <SelectField
            label="Status"
            name="status"
            onChange={(value) => {
              const status: '' | ArtworkStatus = isArtworkStatus(value) ? value : '';
              setDraftFilters((current) => ({ ...current, status }));
            }}
            options={STATUS_FILTER_OPTIONS}
            value={draftFilters.status}
          />
        </div>
        <div className="toolbar__actions">
          <button
            aria-busy={pageLoading}
            className="button button--primary"
            disabled={pageLoading}
            type="submit"
          >
            <Search aria-hidden="true" focusable="false" size={17} strokeWidth={1.9} />
            Search
          </button>
          <button
            className="button button--ghost"
            disabled={pageLoading}
            onClick={clearFilters}
            type="button"
          >
            <RotateCcw aria-hidden="true" focusable="false" size={16} strokeWidth={1.9} />
            Clear filters
          </button>
        </div>
      </form>

      {pageLoading ? (
        <LoadingState
          description="Loading the artwork catalogue, artist summaries, and matching records."
          label="Loading artworks"
        />
      ) : pageError !== null ? (
        <ErrorState
          message={pageError}
          onRetry={() => {
            setArtistsRefreshKey((key) => key + 1);
            setRefreshKey((key) => key + 1);
          }}
          title="The artwork catalogue could not load"
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
              Add artwork
            </button>
          }
          icon={<Frame aria-hidden="true" focusable="false" size={25} strokeWidth={1.6} />}
          message={
            filters.search.length > 0 || filters.artistId !== '' || filters.status !== ''
              ? 'No artworks match the current search, artist, and status. Clear the filters or add a new work.'
              : artists.length === 0
                ? 'The catalogue is empty. Add an artist to the roster, then catalogue the first artwork.'
                : 'The catalogue is empty. Add the first artwork for an artist in the roster.'
          }
          title="No artworks found"
        />
      ) : (
        <div className="stack">
          <p className="pagination__summary" role="status">
            Showing {rangeStart}–{rangeEnd} of {pagination.total} artwork
            {pagination.total === 1 ? '' : 's'}
          </p>
          <div className="table-wrap">
            <table className="data-table data-table--stack">
              <caption>
                Artworks matching the current filters, ordered alphabetically by title.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Artwork</th>
                  <th scope="col">Artist</th>
                  <th scope="col">Medium</th>
                  <th scope="col">Details</th>
                  <th scope="col">Status</th>
                  <th scope="col">Updated</th>
                  <th className="data-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {response.data.map((artwork) => {
                  const titleId = `artwork-title-${artwork.id}`;
                  return (
                    <tr key={artwork.id}>
                      <th data-label="Artwork" id={titleId} scope="row">
                        <span className="data-table__primary">{artwork.title}</span>
                        {artwork.status === 'retired' ? (
                          <span className="data-table__secondary">
                            Retired from new placements; history is preserved.
                          </span>
                        ) : null}
                      </th>
                      <td data-label="Artist">
                        <span className="cluster">
                          <span>{artwork.artist.name}</span>
                          {artwork.artist.status === 'archived' ? (
                            <StatusBadge compact status="archived" />
                          ) : null}
                        </span>
                      </td>
                      <td className="max-prose" data-label="Medium">
                        {artwork.medium}
                      </td>
                      <td data-label="Details">
                        <span>
                          {artwork.year === null ? 'Year not recorded' : `Year ${artwork.year}`}
                        </span>
                        <span className="data-table__secondary">
                          {formatDimensions(artwork.widthCm, artwork.heightCm)} ·{' '}
                          {artwork.framed ? 'Framed' : 'Unframed'}
                        </span>
                      </td>
                      <td data-label="Status">
                        <StatusBadge status={artwork.status} />
                      </td>
                      <td data-label="Updated">
                        <time dateTime={artwork.updatedAt}>
                          {formatTimestamp(artwork.updatedAt)}
                        </time>
                      </td>
                      <td className="data-table__actions" data-label="Actions">
                        <button
                          aria-describedby={titleId}
                          className="button button--secondary button--small"
                          onClick={() => {
                            setEditor({ artwork, mode: 'edit' });
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

          <nav aria-label="Artwork pages" className="pagination">
            <span className="pagination__summary">
              Page {pagination.page} of {Math.max(1, pagination.totalPages)}
            </span>
            <div className="pagination__pages">
              <button
                className="button button--secondary button--small"
                disabled={pageLoading || pagination.page <= 1}
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
                disabled={pageLoading || pagination.page >= pagination.totalPages}
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
        <ArtworkEditorModal
          artists={artists}
          artwork={editor.mode === 'edit' ? editor.artwork : null}
          key={editor.mode === 'edit' ? editor.artwork.id : 'new-artwork'}
          onClose={() => {
            setEditor(null);
          }}
          onSaved={handleSaved}
        />
      )}
    </section>
  );
}
