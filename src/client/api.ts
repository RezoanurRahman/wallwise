import { buildApiPath, createJsonHeaders, normalizeErrorResponse } from '../shared/http';
import type {
  ActivityListQuery,
  ActivityListResponse,
  Artist,
  ArtistDetailResponse,
  ArtistListQuery,
  ArtistListResponse,
  ArtistMutationResponse,
  Artwork,
  ArtworkDetailResponse,
  ArtworkListQuery,
  ArtworkListResponse,
  ArtworkMutationResponse,
  CreateArtistInput,
  CreateArtworkInput,
  CreateExhibitionInput,
  CreatePlacementInput,
  CreateTaskInput,
  DashboardResponse,
  DashboardSummary,
  DeleteResponse,
  EntityId,
  ErrorResponse,
  ExhibitionDetail,
  ExhibitionDetailResponse,
  ExhibitionListQuery,
  ExhibitionListResponse,
  ExhibitionMutationResponse,
  ExhibitionTransitionRequest,
  PlacementMutationResponse,
  TaskListQuery,
  TaskListResponse,
  TaskMutationResponse,
  UpdateArtistInput,
  UpdateArtworkInput,
  UpdateExhibitionInput,
  UpdatePlacementInput,
  UpdateTaskInput,
} from '../shared/types';

export type { ErrorResponse } from '../shared/types';

export interface ApiRequestOptions {
  body?: unknown;
  headers?: Readonly<Record<string, string>>;
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  signal?: AbortSignal;
}

export interface ExhibitionCsvDownload {
  blob: Blob;
  filename: string;
}

interface FetchOptions {
  body?: string;
  headers: Readonly<Record<string, string>>;
  method: string;
  signal?: AbortSignal;
}

type QueryValue = string | number | boolean | undefined;

const NETWORK_ERROR_MESSAGE =
  'Wallwise could not reach the gallery API. Check that the server is running and try again.';
const ABORTED_REQUEST_MESSAGE = 'The request was cancelled.';
const INVALID_RESPONSE_MESSAGE =
  'The server returned an unreadable response. Please retry the request.';
const INVALID_EXPORT_MESSAGE =
  'The exhibition export did not return a CSV file. Please retry the download.';

export class ApiClientError extends Error {
  readonly code: string;
  readonly details: unknown;
  readonly field?: string;
  readonly response: ErrorResponse;
  readonly status: number;

  constructor(response: ErrorResponse, status: number, options: { cause?: unknown } = {}) {
    super(
      response.error.message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = 'ApiClientError';
    this.code = response.error.code;
    this.details = response.error.details;
    this.field = response.error.field;
    this.response = response;
    this.status = status;
  }
}

export function isApiClientError(value: unknown): value is ApiClientError {
  return value instanceof ApiClientError;
}

export function createQueryString(query: object): string {
  const searchParams = new URLSearchParams();

  for (const [key, rawValue] of Object.entries(query)) {
    if (rawValue === undefined) {
      continue;
    }

    const value = rawValue as QueryValue;
    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      throw new TypeError(`Unsupported query value for "${key}".`);
    }

    searchParams.append(key, String(value));
  }

  const queryString = searchParams.toString();
  return queryString.length === 0 ? '' : `?${queryString}`;
}

function idPath(id: EntityId): string {
  const trimmedId = id.trim();
  if (trimmedId.length === 0) {
    throw new TypeError('A record ID is required.');
  }

  return encodeURIComponent(trimmedId);
}

function fallbackForStatus(status: number): { code: string; message: string } {
  if (status === 400) {
    return {
      code: 'HTTP_400',
      message: 'The request was not accepted. Check the form and try again.',
    };
  }

  if (status === 401 || status === 403) {
    return {
      code: `HTTP_${status}`,
      message: 'This action is not available for the current desk session.',
    };
  }

  if (status === 404) {
    return {
      code: 'HTTP_404',
      message: 'The requested Wallwise record could not be found.',
    };
  }

  if (status === 409) {
    return {
      code: 'HTTP_409',
      message: 'This change conflicts with current gallery records. Review the details and retry.',
    };
  }

  if (status === 422) {
    return {
      code: 'HTTP_422',
      message: 'The current gallery records do not allow this change.',
    };
  }

  if (status >= 500) {
    return {
      code: `HTTP_${status}`,
      message:
        'Wallwise could not complete the request. The server may be unavailable; please retry.',
    };
  }

  return {
    code: `HTTP_${status}`,
    message: `Wallwise could not complete the request (HTTP ${status}). Please retry.`,
  };
}

async function apiErrorFromResponse(response: Response): Promise<ApiClientError> {
  let payload: unknown;

  try {
    const bodyText = await response.text();
    if (bodyText.trim().length > 0) {
      try {
        payload = JSON.parse(bodyText) as unknown;
      } catch {
        payload = undefined;
      }
    }
  } catch {
    payload = undefined;
  }

  return new ApiClientError(
    normalizeErrorResponse(payload, fallbackForStatus(response.status)),
    response.status,
  );
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError'
  );
}

function networkError(error: unknown): ApiClientError {
  if (isAbortError(error)) {
    return new ApiClientError(
      normalizeErrorResponse(undefined, {
        code: 'REQUEST_ABORTED',
        message: ABORTED_REQUEST_MESSAGE,
      }),
      0,
      { cause: error },
    );
  }

  return new ApiClientError(
    normalizeErrorResponse(undefined, {
      code: 'NETWORK_ERROR',
      message: NETWORK_ERROR_MESSAGE,
    }),
    0,
    { cause: error },
  );
}

function malformedResponse(status: number): ApiClientError {
  return new ApiClientError(
    normalizeErrorResponse(undefined, {
      code: 'INVALID_RESPONSE',
      message: INVALID_RESPONSE_MESSAGE,
    }),
    status,
  );
}

async function fetchApi(path: string, options: FetchOptions): Promise<Response> {
  try {
    return await fetch(buildApiPath(path), {
      body: options.body,
      cache: 'no-store',
      headers: options.headers,
      method: options.method,
      signal: options.signal,
    });
  } catch (error: unknown) {
    throw networkError(error);
  }
}

/** Sends a JSON request to the API and returns the decoded success payload. */
export async function request<T>(path: string, options: ApiRequestOptions = {}): Promise<T> {
  const headers = createJsonHeaders(options.headers);
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const response = await fetchApi(path, {
    body,
    headers,
    method: options.method ?? 'GET',
    signal: options.signal,
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  let payload: unknown;
  try {
    const bodyText = await response.text();
    if (bodyText.trim().length === 0) {
      throw new SyntaxError('Empty response body.');
    }
    payload = JSON.parse(bodyText) as unknown;
  } catch {
    throw malformedResponse(response.status);
  }

  return payload as T;
}

export async function getDashboard(signal?: AbortSignal): Promise<DashboardSummary> {
  const response = await request<DashboardResponse>('/dashboard', { signal });
  return response.data;
}

export async function listArtists(
  query: ArtistListQuery = {},
  signal?: AbortSignal,
): Promise<ArtistListResponse> {
  return request<ArtistListResponse>(`/artists${createQueryString(query)}`, { signal });
}

export async function getArtist(id: EntityId, signal?: AbortSignal): Promise<Artist> {
  const response = await request<ArtistDetailResponse>(`/artists/${idPath(id)}`, { signal });
  return response.data;
}

export async function createArtist(
  input: CreateArtistInput,
  signal?: AbortSignal,
): Promise<ArtistMutationResponse> {
  return request<ArtistMutationResponse>('/artists', {
    body: input,
    method: 'POST',
    signal,
  });
}

export async function updateArtist(
  id: EntityId,
  input: UpdateArtistInput,
  signal?: AbortSignal,
): Promise<ArtistMutationResponse> {
  return request<ArtistMutationResponse>(`/artists/${idPath(id)}`, {
    body: input,
    method: 'PATCH',
    signal,
  });
}

export async function listArtworks(
  query: ArtworkListQuery = {},
  signal?: AbortSignal,
): Promise<ArtworkListResponse> {
  return request<ArtworkListResponse>(`/artworks${createQueryString(query)}`, { signal });
}

export async function getArtwork(id: EntityId, signal?: AbortSignal): Promise<Artwork> {
  const response = await request<ArtworkDetailResponse>(`/artworks/${idPath(id)}`, { signal });
  return response.data;
}

export async function createArtwork(
  input: CreateArtworkInput,
  signal?: AbortSignal,
): Promise<ArtworkMutationResponse> {
  return request<ArtworkMutationResponse>('/artworks', {
    body: input,
    method: 'POST',
    signal,
  });
}

export async function updateArtwork(
  id: EntityId,
  input: UpdateArtworkInput,
  signal?: AbortSignal,
): Promise<ArtworkMutationResponse> {
  return request<ArtworkMutationResponse>(`/artworks/${idPath(id)}`, {
    body: input,
    method: 'PATCH',
    signal,
  });
}

export async function listExhibitions(
  query: ExhibitionListQuery = {},
  signal?: AbortSignal,
): Promise<ExhibitionListResponse> {
  return request<ExhibitionListResponse>(`/exhibitions${createQueryString(query)}`, { signal });
}

export async function getExhibition(id: EntityId, signal?: AbortSignal): Promise<ExhibitionDetail> {
  const response = await request<ExhibitionDetailResponse>(`/exhibitions/${idPath(id)}`, {
    signal,
  });
  return response.data;
}

export async function createExhibition(
  input: CreateExhibitionInput,
  signal?: AbortSignal,
): Promise<ExhibitionMutationResponse> {
  return request<ExhibitionMutationResponse>('/exhibitions', {
    body: input,
    method: 'POST',
    signal,
  });
}

export async function updateExhibition(
  id: EntityId,
  input: UpdateExhibitionInput,
  signal?: AbortSignal,
): Promise<ExhibitionMutationResponse> {
  return request<ExhibitionMutationResponse>(`/exhibitions/${idPath(id)}`, {
    body: input,
    method: 'PATCH',
    signal,
  });
}

export async function transitionExhibition(
  id: EntityId,
  input: ExhibitionTransitionRequest,
  signal?: AbortSignal,
): Promise<ExhibitionMutationResponse> {
  return request<ExhibitionMutationResponse>(`/exhibitions/${idPath(id)}/transitions`, {
    body: input,
    method: 'POST',
    signal,
  });
}

export async function createPlacement(
  input: CreatePlacementInput,
  signal?: AbortSignal,
): Promise<PlacementMutationResponse> {
  const { exhibitionId, ...body } = input;

  return request<PlacementMutationResponse>(`/exhibitions/${idPath(exhibitionId)}/placements`, {
    body,
    method: 'POST',
    signal,
  });
}

export async function updatePlacement(
  id: EntityId,
  input: UpdatePlacementInput,
  signal?: AbortSignal,
): Promise<PlacementMutationResponse> {
  return request<PlacementMutationResponse>(`/placements/${idPath(id)}`, {
    body: input,
    method: 'PATCH',
    signal,
  });
}

export async function deletePlacement(id: EntityId, signal?: AbortSignal): Promise<DeleteResponse> {
  return request<DeleteResponse>(`/placements/${idPath(id)}`, {
    method: 'DELETE',
    signal,
  });
}

export async function listTasks(
  query: TaskListQuery = {},
  signal?: AbortSignal,
): Promise<TaskListResponse> {
  return request<TaskListResponse>(`/tasks${createQueryString(query)}`, { signal });
}

export async function createTask(
  exhibitionId: EntityId,
  input: CreateTaskInput,
  signal?: AbortSignal,
): Promise<TaskMutationResponse> {
  return request<TaskMutationResponse>(`/exhibitions/${idPath(exhibitionId)}/tasks`, {
    body: input,
    method: 'POST',
    signal,
  });
}

export async function updateTask(
  id: EntityId,
  input: UpdateTaskInput,
  signal?: AbortSignal,
): Promise<TaskMutationResponse> {
  return request<TaskMutationResponse>(`/tasks/${idPath(id)}`, {
    body: input,
    method: 'PATCH',
    signal,
  });
}

export async function deleteTask(id: EntityId, signal?: AbortSignal): Promise<DeleteResponse> {
  return request<DeleteResponse>(`/tasks/${idPath(id)}`, {
    method: 'DELETE',
    signal,
  });
}

export async function listActivity(
  query: ActivityListQuery = {},
  signal?: AbortSignal,
): Promise<ActivityListResponse> {
  return request<ActivityListResponse>(`/activity${createQueryString(query)}`, { signal });
}

function csvFilenameFromDisposition(header: string | null): string {
  if (header === null) {
    return 'wallwise-exhibitions.csv';
  }

  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(header);
  const candidate = match?.[1]?.trim();
  if (candidate === undefined || candidate.length === 0) {
    return 'wallwise-exhibitions.csv';
  }

  try {
    return decodeURIComponent(candidate);
  } catch {
    return 'wallwise-exhibitions.csv';
  }
}

/** Fetches the exhibition portfolio CSV, validating the response before returning it. */
export async function downloadExhibitionsCsv(signal?: AbortSignal): Promise<ExhibitionCsvDownload> {
  const response = await fetchApi('/export/exhibitions.csv', {
    headers: createJsonHeaders({ Accept: 'text/csv' }),
    method: 'GET',
    signal,
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  const contentType = response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.startsWith('text/csv')) {
    throw new ApiClientError(
      normalizeErrorResponse(undefined, {
        code: 'INVALID_RESPONSE',
        message: INVALID_EXPORT_MESSAGE,
      }),
      response.status,
    );
  }

  let blob: Blob;
  try {
    blob = await response.blob();
  } catch (error: unknown) {
    throw networkError(error);
  }

  return {
    blob,
    filename: csvFilenameFromDisposition(response.headers.get('content-disposition')),
  };
}

/** Saves a previously downloaded CSV in the browser without opening a new window. */
export function saveCsvDownload(download: ExhibitionCsvDownload): void {
  if (
    typeof document === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof window === 'undefined'
  ) {
    return;
  }

  const objectUrl = URL.createObjectURL(download.blob);
  const anchor = document.createElement('a');
  anchor.href = objectUrl;
  anchor.download = download.filename;
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => {
    URL.revokeObjectURL(objectUrl);
  }, 0);
}

export const api = {
  createArtist,
  createArtwork,
  createExhibition,
  createPlacement,
  createTask,
  deletePlacement,
  deleteTask,
  downloadExhibitionsCsv,
  getArtist,
  getArtwork,
  getDashboard,
  getExhibition,
  listActivity,
  listArtists,
  listArtworks,
  listExhibitions,
  listTasks,
  saveCsvDownload,
  transitionExhibition,
  updateArtist,
  updateArtwork,
  updateExhibition,
  updatePlacement,
  updateTask,
};
