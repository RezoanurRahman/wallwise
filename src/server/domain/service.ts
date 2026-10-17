import { randomUUID } from 'node:crypto';

import type Database from 'better-sqlite3';
import type { DomainError } from './errors';

import {
  ARTIST_STATUSES,
  ARTWORK_STATUSES,
  DEFAULT_PAGE_SIZE,
  EXHIBITION_STATUSES,
  FIELD_LIMITS,
  MAX_PAGE_SIZE,
  TASK_CATEGORIES,
  TASK_STATUSES,
} from '../../shared/constants';
import type {
  ActivityEntry,
  ActivityEntityType,
  ActivityListQuery,
  ActivityListResponse,
  Artist,
  ArtistDetailResponse,
  ArtistListQuery,
  ArtistListResponse,
  ArtistMutationResponse,
  ArtistStatus,
  ArtistSummary,
  Artwork,
  ArtworkDetailResponse,
  ArtworkListQuery,
  ArtworkListResponse,
  ArtworkMutationResponse,
  ArtworkStatus,
  ArtworkSummary,
  ConflictWarning,
  CreateArtistInput,
  CreateArtworkInput,
  CreateExhibitionInput,
  CreatePlacementInput,
  CreateTaskInput,
  DashboardResponse,
  DashboardStatusCounts,
  DashboardSummary,
  DashboardTotals,
  DeletedEntity,
  DeleteResponse,
  EntityId,
  Exhibition,
  ExhibitionDetail,
  ExhibitionDetailResponse,
  ExhibitionExportRow,
  ExhibitionListQuery,
  ExhibitionListResponse,
  ExhibitionMutationResponse,
  ExhibitionStatus,
  ExhibitionTransitionRequest,
  HealthResponse,
  InstallationTask,
  IsoDate,
  IsoTimestamp,
  PaginationMeta,
  Placement,
  PlacementMutationResponse,
  ReadinessRow,
  SortDirection,
  TaskCategory,
  TaskListQuery,
  TaskListResponse,
  TaskMutationResponse,
  TaskStatus,
  UpdateArtistInput,
  UpdateArtworkInput,
  UpdateExhibitionInput,
  UpdatePlacementInput,
  UpdateTaskInput,
  UpcomingExhibition,
} from '../../shared/types';
import {
  allowedExhibitionTransitions,
  calculateReadiness,
  dateRangesOverlap,
  isLegalExhibitionTransition,
  normalizeSpace,
  parseIsoDate,
  utcCalendarDate,
} from './rules';
import {
  artworkAssignmentConflictError,
  internalError,
  invalidTransitionError,
  isDomainError,
  notFoundError,
  placementConflictError,
  ruleViolationError,
  scheduleConflictError,
  validationError,
} from './errors';

type SqlParameter = string | number | null;

interface ArtistRow {
  id: string;
  name: string;
  email: string | null;
  bio: string | null;
  status: ArtistStatus;
  created_at: string;
  updated_at: string;
}

interface ArtworkRow {
  id: string;
  artist_id: string;
  title: string;
  medium: string;
  year: number | null;
  width_cm: number | null;
  height_cm: number | null;
  framed: number;
  status: ArtworkStatus;
  created_at: string;
  updated_at: string;
  artist_name: string;
  artist_status: ArtistStatus;
}

interface ExhibitionRow {
  id: string;
  title: string;
  subtitle: string | null;
  space: string;
  start_date: string;
  end_date: string;
  install_start: string;
  install_end: string;
  status: ExhibitionStatus;
  curator: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

interface PlacementRow {
  id: string;
  exhibition_id: string;
  artwork_id: string;
  wall: string;
  position: number;
  label: string | null;
  notes: string | null;
  created_at: string;
  artwork_title: string;
  artwork_medium: string;
  artwork_year: number | null;
  artwork_width_cm: number | null;
  artwork_height_cm: number | null;
  artwork_framed: number;
  artwork_status: ArtworkStatus;
  artist_id: string;
  artist_name: string;
  artist_status: ArtistStatus;
}

interface TaskRow {
  id: string;
  exhibition_id: string;
  title: string;
  category: TaskCategory;
  assignee: string | null;
  due_date: string | null;
  status: TaskStatus;
  created_at: string;
  updated_at: string;
}

interface ActivityRow {
  id: string;
  entity_type: ActivityEntityType;
  entity_id: string;
  action: ActivityEntry['action'];
  detail: string;
  created_at: string;
}

interface CountRow {
  count: number;
}

interface PlacementAggregateRow {
  exhibition_id: string;
  artwork_count: number;
  placed_artwork_count: number;
}

interface TaskAggregateRow {
  exhibition_id: string;
  task_count: number;
  completed_task_count: number;
  overdue_task_count: number;
}

interface DashboardTotalsRow {
  artists: number;
  active_artists: number;
  artworks: number;
  available_artworks: number;
  exhibitions: number;
  scheduled_exhibitions: number;
  placements: number;
  open_tasks: number;
}

interface ConflictPlacementRow {
  artwork_id: string;
  artwork_title: string;
  exhibition_id: string;
  exhibition_title: string;
  install_start: string;
  end_date: string;
}

interface ConflictContext {
  all: ConflictWarning[];
  byExhibition: Map<string, ConflictWarning[]>;
}

interface NormalizedPagination {
  page: number;
  pageSize: number;
  offset: number;
}

const ARTIST_CREATE_KEYS = ['name', 'email', 'bio', 'status'] as const;
const ARTIST_UPDATE_KEYS = ARTIST_CREATE_KEYS;
const ARTWORK_CREATE_KEYS = [
  'artistId',
  'title',
  'medium',
  'year',
  'widthCm',
  'heightCm',
  'framed',
  'status',
] as const;
const ARTWORK_UPDATE_KEYS = ARTWORK_CREATE_KEYS;
const EXHIBITION_CREATE_KEYS = [
  'title',
  'subtitle',
  'space',
  'startDate',
  'endDate',
  'installStart',
  'installEnd',
  'curator',
  'notes',
] as const;
const EXHIBITION_UPDATE_KEYS = EXHIBITION_CREATE_KEYS;
const PLACEMENT_CREATE_KEYS = [
  'exhibitionId',
  'artworkId',
  'wall',
  'position',
  'label',
  'notes',
] as const;
const PLACEMENT_UPDATE_KEYS = ['wall', 'position', 'label', 'notes'] as const;
const TASK_CREATE_KEYS = ['title', 'category', 'assignee', 'dueDate', 'status'] as const;
const TASK_UPDATE_KEYS = TASK_CREATE_KEYS;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_ID_LENGTH = 200;
const MAX_POSITION = 1_000_000;

function normalizePagination(query: { page?: number; pageSize?: number }): NormalizedPagination {
  const requestedPage = Number.isFinite(query.page) ? Math.floor(query.page ?? 1) : 1;
  const requestedPageSize = Number.isFinite(query.pageSize)
    ? Math.floor(query.pageSize ?? DEFAULT_PAGE_SIZE)
    : DEFAULT_PAGE_SIZE;
  const page = Math.max(1, requestedPage);
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, requestedPageSize));

  return { page, pageSize, offset: (page - 1) * pageSize };
}

function paginationMeta(total: number, pagination: NormalizedPagination): PaginationMeta {
  return {
    page: pagination.page,
    pageSize: pagination.pageSize,
    total,
    totalPages: Math.ceil(total / pagination.pageSize),
  };
}

function assertAllowedKeys(input: object, allowed: readonly string[]): void {
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) {
      throw validationError(`Unknown field "${key}".`, key);
    }
  }
}

function assertPatchHasAField(input: object, field = 'body'): void {
  if (Object.keys(input).length === 0) {
    throw validationError('At least one field is required.', field);
  }
}

function requiredText(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string') {
    throw validationError(`${field} is required.`, field);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw validationError(`${field} is required.`, field);
  }
  if (trimmed.length > maxLength) {
    throw validationError(`${field} must be ${maxLength} characters or fewer.`, field);
  }

  return trimmed;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'string') {
    throw validationError(`${field} must be text.`, field);
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  if (trimmed.length > maxLength) {
    throw validationError(`${field} must be ${maxLength} characters or fewer.`, field);
  }

  return trimmed;
}

function requiredId(value: unknown, field: string): EntityId {
  return requiredText(value, field, MAX_ID_LENGTH);
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], field: string): T {
  if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
    throw validationError(`${field} must be one of: ${allowed.join(', ')}.`, field);
  }
  return value as T;
}

function optionalYear(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw validationError(`${field} must be a whole number.`, field);
  }
  if (value < 1000 || value > 2100) {
    throw validationError(`${field} must be between 1000 and 2100.`, field);
  }
  return value;
}

function optionalDimension(value: unknown, field: string): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw validationError(`${field} must be a finite number.`, field);
  }
  if (value <= 0 || value > 10_000) {
    throw validationError(`${field} must be greater than 0 and at most 10000.`, field);
  }
  return value;
}

function optionalBoolean(value: unknown, field: string, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  if (typeof value !== 'boolean') {
    throw validationError(`${field} must be true or false.`, field);
  }
  return value;
}

function requiredIsoDate(value: unknown, field: string): IsoDate {
  if (typeof value !== 'string' || parseIsoDate(value) === null) {
    throw validationError(`${field} must be a real date in YYYY-MM-DD format.`, field);
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  if (year < 1000 || year > 2100) {
    throw validationError(`${field} must use a year between 1000 and 2100.`, field);
  }

  return value;
}

function optionalIsoDate(value: unknown, field: string): IsoDate | null {
  if (value === undefined || value === null) {
    return null;
  }
  return requiredIsoDate(value, field);
}

function assertDateOrder(input: {
  installStart: IsoDate;
  installEnd: IsoDate;
  startDate: IsoDate;
  endDate: IsoDate;
}): void {
  if (input.installStart > input.installEnd) {
    throw validationError('installEnd must be on or after installStart.', 'installEnd');
  }
  if (input.installEnd > input.startDate) {
    throw validationError('startDate must be on or after installEnd.', 'startDate');
  }
  if (input.startDate > input.endDate) {
    throw validationError('endDate must be on or after startDate.', 'endDate');
  }
}

function requiredEmail(value: unknown): string | null {
  const email = optionalText(value, 'email', FIELD_LIMITS.email);
  if (email === null) {
    return null;
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw validationError('email must be a valid email address.', 'email');
  }
  return email;
}

function requiredNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value)) {
    throw validationError(`${field} must be a whole number.`, field);
  }
  if (value < 0 || value > MAX_POSITION) {
    throw validationError(`${field} must be a non-negative integer.`, field);
  }
  return value;
}

function sqlLikePattern(search: string): string {
  const escaped = search.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
  return `%${escaped.toLowerCase()}%`;
}

function mapArtist(row: ArtistRow): Artist {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    bio: row.bio,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtistSummary(row: {
  artist_id: string;
  artist_name: string;
  artist_status: ArtistStatus;
}): ArtistSummary {
  return {
    id: row.artist_id,
    name: row.artist_name,
    status: row.artist_status,
  };
}

function mapArtwork(row: ArtworkRow): Artwork {
  return {
    id: row.id,
    artistId: row.artist_id,
    title: row.title,
    medium: row.medium,
    year: row.year,
    widthCm: row.width_cm,
    heightCm: row.height_cm,
    framed: row.framed === 1,
    status: row.status,
    artist: mapArtistSummary(row),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapArtworkSummary(row: PlacementRow): ArtworkSummary {
  return {
    id: row.artwork_id,
    artistId: row.artist_id,
    title: row.artwork_title,
    medium: row.artwork_medium,
    year: row.artwork_year,
    widthCm: row.artwork_width_cm,
    heightCm: row.artwork_height_cm,
    framed: row.artwork_framed === 1,
    status: row.artwork_status,
    artist: mapArtistSummary(row),
  };
}

function mapPlacement(row: PlacementRow): Placement {
  return {
    id: row.id,
    exhibitionId: row.exhibition_id,
    artworkId: row.artwork_id,
    wall: row.wall,
    position: row.position,
    label: row.label,
    notes: row.notes,
    createdAt: row.created_at,
    artwork: mapArtworkSummary(row),
  };
}

function mapTask(row: TaskRow): InstallationTask {
  return {
    id: row.id,
    exhibitionId: row.exhibition_id,
    title: row.title,
    category: row.category,
    assignee: row.assignee,
    dueDate: row.due_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapActivity(row: ActivityRow): ActivityEntry {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    detail: row.detail,
    createdAt: row.created_at,
  };
}

function directionSql(direction: SortDirection | undefined): 'ASC' | 'DESC' {
  if (direction === undefined || direction === 'asc') {
    return 'ASC';
  }
  if (direction === 'desc') {
    return 'DESC';
  }
  throw validationError('direction must be asc or desc.', 'direction');
}

function sortValue<T extends string>(value: T | undefined, allowed: readonly T[], fallback: T): T {
  if (value === undefined) {
    return fallback;
  }
  if (!(allowed as readonly string[]).includes(value)) {
    throw validationError(`sort must be one of: .`, 'sort');
  }
  return value;
}

function orientConflict(warning: ConflictWarning, exhibitionId: string): ConflictWarning {
  if (warning.exhibitionId === exhibitionId) {
    return warning;
  }
  return {
    ...warning,
    exhibitionId: warning.relatedExhibitionId,
    exhibitionTitle: warning.relatedExhibitionTitle,
    relatedExhibitionId: warning.exhibitionId,
    relatedExhibitionTitle: warning.exhibitionTitle,
  };
}

function buildConflictContext(
  shows: ExhibitionRow[],
  artworkPlacements: ConflictPlacementRow[],
): ConflictContext {
  const all: ConflictWarning[] = [];
  const seen = new Set<string>();
  const orderedShows = [...shows].sort((left, right) => left.id.localeCompare(right.id));

  const addWarning = (warning: ConflictWarning, key: string): void => {
    if (!seen.has(key)) {
      seen.add(key);
      all.push(warning);
    }
  };

  for (let index = 0; index < orderedShows.length; index += 1) {
    const first = orderedShows[index];
    if (!first) {
      continue;
    }
    for (let otherIndex = index + 1; otherIndex < orderedShows.length; otherIndex += 1) {
      const second = orderedShows[otherIndex];
      if (!second || normalizeSpace(first.space) !== normalizeSpace(second.space)) {
        continue;
      }

      if (dateRangesOverlap(first.start_date, first.end_date, second.start_date, second.end_date)) {
        addWarning(
          {
            type: 'exhibition_space',
            message: `${first.space} is double-booked for ${first.title} and ${second.title}.`,
            exhibitionId: first.id,
            exhibitionTitle: first.title,
            relatedExhibitionId: second.id,
            relatedExhibitionTitle: second.title,
          },
          `exhibition:${first.id}:${second.id}`,
        );
      }

      if (
        dateRangesOverlap(
          first.install_start,
          first.install_end,
          second.install_start,
          second.install_end,
        )
      ) {
        addWarning(
          {
            type: 'installation_space',
            message: `Installation windows overlap in ${first.space} for ${first.title} and ${second.title}.`,
            exhibitionId: first.id,
            exhibitionTitle: first.title,
            relatedExhibitionId: second.id,
            relatedExhibitionTitle: second.title,
          },
          `installation:${first.id}:${second.id}`,
        );
      }
    }
  }

  const byArtwork = new Map<string, ConflictPlacementRow[]>();
  for (const placement of artworkPlacements) {
    const existing = byArtwork.get(placement.artwork_id) ?? [];
    existing.push(placement);
    byArtwork.set(placement.artwork_id, existing);
  }

  for (const [artworkId, placements] of byArtwork) {
    const ordered = [...placements].sort((left, right) =>
      left.exhibition_id.localeCompare(right.exhibition_id),
    );
    for (let index = 0; index < ordered.length; index += 1) {
      const first = ordered[index];
      if (!first) {
        continue;
      }
      for (let otherIndex = index + 1; otherIndex < ordered.length; otherIndex += 1) {
        const second = ordered[otherIndex];
        if (!second || first.exhibition_id === second.exhibition_id) {
          continue;
        }
        if (
          !dateRangesOverlap(
            first.install_start,
            first.end_date,
            second.install_start,
            second.end_date,
          )
        ) {
          continue;
        }
        addWarning(
          {
            type: 'artwork_double_booking',
            message: `${first.artwork_title} is placed in both ${first.exhibition_title} and ${second.exhibition_title}.`,
            exhibitionId: first.exhibition_id,
            exhibitionTitle: first.exhibition_title,
            relatedExhibitionId: second.exhibition_id,
            relatedExhibitionTitle: second.exhibition_title,
            artworkId,
            artworkTitle: first.artwork_title,
          },
          `artwork:${artworkId}:${first.exhibition_id}:${second.exhibition_id}`,
        );
      }
    }
  }

  const byExhibition = new Map<string, ConflictWarning[]>();
  for (const warning of all) {
    const left = byExhibition.get(warning.exhibitionId) ?? [];
    left.push(warning);
    byExhibition.set(warning.exhibitionId, left);

    const right = byExhibition.get(warning.relatedExhibitionId) ?? [];
    right.push(orientConflict(warning, warning.relatedExhibitionId));
    byExhibition.set(warning.relatedExhibitionId, right);
  }

  return { all, byExhibition };
}

function isSqliteFailure(error: unknown): error is { code: string; message: string } {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  const candidate = error as { code?: unknown; message?: unknown };
  return typeof candidate.code === 'string' && typeof candidate.message === 'string';
}

/** Inspects constraints privately and returns only safe, actionable domain text. */
function mapWriteFailure(error: unknown): DomainError {
  if (isDomainError(error)) {
    return error;
  }

  if (isSqliteFailure(error)) {
    if (error.code.startsWith('SQLITE_CONSTRAINT')) {
      if (error.message.includes('idx_artists_email_nocase')) {
        return validationError('email is already in use by another artist.', 'email');
      }
      if (error.message.includes('idx_placements_exhibition')) {
        return placementConflictError(
          'That artwork or wall position is already assigned in this exhibition.',
        );
      }
      return ruleViolationError('The requested change violates a data rule.');
    }
  }

  return internalError();
}

/**
 * Domain service. Reads and mutations return the shared response envelopes;
 * getHealth() returns HealthResponse and exportExhibitionsCsv() returns CSV text.
 * All multi-row writes use BEGIN IMMEDIATE and append audit rows atomically.
 */
export class WallwiseService {
  private readonly db: Database.Database;
  private readonly now: () => Date;

  constructor(db: Database.Database, now: () => Date = () => new Date()) {
    this.db = db;
    this.now = now;
  }

  private timestamp(): IsoTimestamp {
    const value = this.now();
    if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
      throw internalError();
    }
    return value.toISOString();
  }

  private today(): IsoDate {
    return utcCalendarDate(this.now());
  }

  /** Serializes conflict checks, the domain write, and its audit row. */
  private transact<T>(operation: () => T): T {
    try {
      return this.db.transaction(operation).immediate();
    } catch (error) {
      throw mapWriteFailure(error);
    }
  }

  private artistRow(id: EntityId, field = 'id'): ArtistRow {
    const row = this.db
      .prepare(
        `
        SELECT id, name, email, bio, status, created_at, updated_at
        FROM artists
        WHERE id = ?
      `,
      )
      .get(id) as ArtistRow | undefined;

    if (!row) {
      throw notFoundError('Artist not found.', field);
    }
    return row;
  }

  private artworkRow(id: EntityId, field = 'id'): ArtworkRow {
    const row = this.db
      .prepare(
        `
        SELECT aw.id, aw.artist_id, aw.title, aw.medium, aw.year, aw.width_cm, aw.height_cm,
               aw.framed, aw.status, aw.created_at, aw.updated_at,
               ar.name AS artist_name, ar.status AS artist_status
        FROM artworks aw
        JOIN artists ar ON ar.id = aw.artist_id
        WHERE aw.id = ?
      `,
      )
      .get(id) as ArtworkRow | undefined;

    if (!row) {
      throw notFoundError('Artwork not found.', field);
    }
    return row;
  }

  private exhibitionRow(id: EntityId, field = 'id'): ExhibitionRow {
    const row = this.db
      .prepare(
        `
        SELECT id, title, subtitle, space, start_date, end_date, install_start, install_end,
               status, curator, notes, created_at, updated_at
        FROM exhibitions
        WHERE id = ?
      `,
      )
      .get(id) as ExhibitionRow | undefined;

    if (!row) {
      throw notFoundError('Exhibition not found.', field);
    }
    return row;
  }

  private placementRow(id: EntityId, field = 'id'): PlacementRow {
    const row = this.db
      .prepare(
        `
        SELECT p.id, p.exhibition_id, p.artwork_id, p.wall, p.position, p.label, p.notes,
               p.created_at, aw.title AS artwork_title, aw.medium AS artwork_medium,
               aw.year AS artwork_year, aw.width_cm AS artwork_width_cm,
               aw.height_cm AS artwork_height_cm, aw.framed AS artwork_framed,
               aw.status AS artwork_status, ar.id AS artist_id, ar.name AS artist_name,
               ar.status AS artist_status
        FROM placements p
        JOIN artworks aw ON aw.id = p.artwork_id
        JOIN artists ar ON ar.id = aw.artist_id
        WHERE p.id = ?
      `,
      )
      .get(id) as PlacementRow | undefined;

    if (!row) {
      throw notFoundError('Placement not found.', field);
    }
    return row;
  }

  private taskRow(id: EntityId, field = 'id'): TaskRow {
    const row = this.db
      .prepare(
        `
        SELECT id, exhibition_id, title, category, assignee, due_date, status, created_at, updated_at
        FROM installation_tasks
        WHERE id = ?
      `,
      )
      .get(id) as TaskRow | undefined;

    if (!row) {
      throw notFoundError('Task not found.', field);
    }
    return row;
  }

  /** Must be called inside the same immediate transaction as its domain write. */
  private insertActivity(
    entityType: ActivityEntityType,
    entityId: EntityId,
    action: ActivityEntry['action'],
    detail: string,
    createdAt: IsoTimestamp,
  ): ActivityEntry {
    const activity: ActivityEntry = {
      id: randomUUID(),
      entityType,
      entityId,
      action,
      detail,
      createdAt,
    };
    this.db
      .prepare(
        `
        INSERT INTO activity_entries (id, entity_type, entity_id, action, detail, created_at)
        VALUES (@id, @entityType, @entityId, @action, @detail, @createdAt)
      `,
      )
      .run(activity);
    return activity;
  }

  getHealth(): HealthResponse {
    const row = this.db.prepare('SELECT 1 AS value').get() as { value: number } | undefined;
    if (!row) {
      throw internalError();
    }

    return {
      status: 'ok',
      database: 'up',
      seedVersion: this.getSeedVersion(),
      timestamp: this.timestamp(),
    };
  }

  getSeedVersion(): number | null {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key = 'seed.version'").get() as
      { value: string } | undefined;
    if (!row) {
      return null;
    }
    const version = Number.parseInt(row.value, 10);
    return Number.isFinite(version) ? version : null;
  }

  listArtists(query: ArtistListQuery = {}): ArtistListResponse {
    const pagination = normalizePagination(query);
    const conditions: string[] = [];
    const params: SqlParameter[] = [];

    if (query.search?.trim()) {
      const pattern = sqlLikePattern(query.search.trim());
      conditions.push(
        "(LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(email, '')) LIKE ? ESCAPE '\\')",
      );
      params.push(pattern, pattern);
    }
    if (query.status !== undefined) {
      const status = enumValue(query.status, ARTIST_STATUSES, 'status');
      conditions.push('status = ?');
      params.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortColumns: Readonly<Record<NonNullable<ArtistListQuery['sort']>, string>> = {
      name: 'name COLLATE NOCASE',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    };
    const sort =
      sortColumns[sortValue(query.sort, ['name', 'createdAt', 'updatedAt'] as const, 'name')];
    const order = directionSql(query.direction);
    const count = this.db
      .prepare(`SELECT COUNT(*) AS count FROM artists ${where}`)
      .get(...params) as CountRow;
    const rows = this.db
      .prepare(
        `
        SELECT id, name, email, bio, status, created_at, updated_at
        FROM artists
        ${where}
        ORDER BY ${sort} ${order}, id ASC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...params, pagination.pageSize, pagination.offset) as ArtistRow[];

    return {
      data: rows.map(mapArtist),
      pagination: paginationMeta(count.count, pagination),
    };
  }

  getArtist(id: EntityId): ArtistDetailResponse {
    return { data: mapArtist(this.artistRow(requiredId(id, 'id'))) };
  }

  createArtist(input: CreateArtistInput): ArtistMutationResponse {
    assertAllowedKeys(input, ARTIST_CREATE_KEYS);
    const name = requiredText(input.name, 'name', FIELD_LIMITS.artistName);
    const email = requiredEmail(input.email);
    const bio = optionalText(input.bio, 'bio', FIELD_LIMITS.bio);
    const status =
      input.status !== undefined
        ? enumValue(input.status, ARTIST_STATUSES, 'status')
        : ('active' satisfies ArtistStatus);
    const createdAt = this.timestamp();
    const id = randomUUID();

    const activity = this.transact(() => {
      if (email !== null) {
        const duplicate = this.db
          .prepare('SELECT id FROM artists WHERE LOWER(email) = LOWER(?)')
          .get(email) as { id: string } | undefined;
        if (duplicate) {
          throw validationError('email is already in use by another artist.', 'email');
        }
      }

      this.db
        .prepare(
          `
          INSERT INTO artists (id, name, email, bio, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(id, name, email, bio, status, createdAt, createdAt);

      return this.insertActivity('artist', id, 'created', `Created artist ${name}.`, createdAt);
    });

    return {
      data: mapArtist(this.artistRow(id)),
      message: 'Artist created.',
      activity,
    };
  }

  updateArtist(id: EntityId, input: UpdateArtistInput): ArtistMutationResponse {
    const artistId = requiredId(id, 'id');
    assertAllowedKeys(input, ARTIST_UPDATE_KEYS);
    assertPatchHasAField(input);
    const updatedAt = this.timestamp();

    const activity = this.transact(() => {
      const current = this.artistRow(artistId);
      const name =
        input.name === undefined
          ? current.name
          : requiredText(input.name, 'name', FIELD_LIMITS.artistName);
      const email = input.email === undefined ? current.email : requiredEmail(input.email);
      const bio =
        input.bio === undefined ? current.bio : optionalText(input.bio, 'bio', FIELD_LIMITS.bio);
      const status =
        input.status === undefined
          ? current.status
          : enumValue(input.status, ARTIST_STATUSES, 'status');

      if (email !== null) {
        const duplicate = this.db
          .prepare('SELECT id FROM artists WHERE LOWER(email) = LOWER(?) AND id <> ?')
          .get(email, artistId) as { id: string } | undefined;
        if (duplicate) {
          throw validationError('email is already in use by another artist.', 'email');
        }
      }

      this.db
        .prepare(
          `
          UPDATE artists
          SET name = ?, email = ?, bio = ?, status = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(name, email, bio, status, updatedAt, artistId);

      const action = status !== current.status ? 'status_changed' : 'updated';
      const detail =
        status !== current.status
          ? `Status changed from ${current.status} to ${status}.`
          : `Updated artist ${name}.`;
      return this.insertActivity('artist', artistId, action, detail, updatedAt);
    });

    return {
      data: mapArtist(this.artistRow(artistId)),
      message: 'Artist updated.',
      activity,
    };
  }

  private ensureArtistReference(artistId: EntityId, field = 'artistId'): ArtistRow {
    const row = this.db
      .prepare(
        `
        SELECT id, name, email, bio, status, created_at, updated_at
        FROM artists WHERE id = ?
      `,
      )
      .get(artistId) as ArtistRow | undefined;
    if (!row) {
      throw notFoundError('Artist not found.', field);
    }
    return row;
  }

  listArtworks(query: ArtworkListQuery = {}): ArtworkListResponse {
    const pagination = normalizePagination(query);
    const conditions: string[] = [];
    const params: SqlParameter[] = [];

    if (query.search?.trim()) {
      const pattern = sqlLikePattern(query.search.trim());
      conditions.push(`(
        LOWER(aw.title) LIKE ? ESCAPE '\\'
        OR LOWER(aw.medium) LIKE ? ESCAPE '\\'
        OR LOWER(ar.name) LIKE ? ESCAPE '\\'
      )`);
      params.push(pattern, pattern, pattern);
    }
    if (query.artistId !== undefined) {
      conditions.push('aw.artist_id = ?');
      params.push(requiredId(query.artistId, 'artistId'));
    }
    if (query.status !== undefined) {
      conditions.push('aw.status = ?');
      params.push(enumValue(query.status, ARTWORK_STATUSES, 'status'));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortColumns: Readonly<Record<NonNullable<ArtworkListQuery['sort']>, string>> = {
      title: 'aw.title COLLATE NOCASE',
      artist: 'ar.name COLLATE NOCASE',
      createdAt: 'aw.created_at',
      updatedAt: 'aw.updated_at',
    };
    const sort =
      sortColumns[
        sortValue(query.sort, ['title', 'artist', 'createdAt', 'updatedAt'] as const, 'title')
      ];
    const order = directionSql(query.direction);
    const count = this.db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM artworks aw JOIN artists ar ON ar.id = aw.artist_id
        ${where}
      `,
      )
      .get(...params) as CountRow;
    const rows = this.db
      .prepare(
        `
        SELECT aw.id, aw.artist_id, aw.title, aw.medium, aw.year, aw.width_cm, aw.height_cm,
               aw.framed, aw.status, aw.created_at, aw.updated_at,
               ar.name AS artist_name, ar.status AS artist_status
        FROM artworks aw
        JOIN artists ar ON ar.id = aw.artist_id
        ${where}
        ORDER BY ${sort} ${order}, aw.id ASC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...params, pagination.pageSize, pagination.offset) as ArtworkRow[];

    return {
      data: rows.map(mapArtwork),
      pagination: paginationMeta(count.count, pagination),
    };
  }

  getArtwork(id: EntityId): ArtworkDetailResponse {
    return { data: mapArtwork(this.artworkRow(requiredId(id, 'id'))) };
  }

  createArtwork(input: CreateArtworkInput): ArtworkMutationResponse {
    assertAllowedKeys(input, ARTWORK_CREATE_KEYS);
    const artistId = requiredId(input.artistId, 'artistId');
    const title = requiredText(input.title, 'title', FIELD_LIMITS.artworkTitle);
    const medium = requiredText(input.medium, 'medium', FIELD_LIMITS.medium);
    const year = optionalYear(input.year, 'year');
    const widthCm = optionalDimension(input.widthCm, 'widthCm');
    const heightCm = optionalDimension(input.heightCm, 'heightCm');
    const framed = optionalBoolean(input.framed, 'framed', false);
    const status =
      input.status !== undefined
        ? enumValue(input.status, ARTWORK_STATUSES, 'status')
        : ('available' satisfies ArtworkStatus);
    const createdAt = this.timestamp();
    const id = randomUUID();

    const activity = this.transact(() => {
      this.ensureArtistReference(artistId);
      this.db
        .prepare(
          `
          INSERT INTO artworks
            (id, artist_id, title, medium, year, width_cm, height_cm, framed, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id,
          artistId,
          title,
          medium,
          year,
          widthCm,
          heightCm,
          framed ? 1 : 0,
          status,
          createdAt,
          createdAt,
        );

      return this.insertActivity('artwork', id, 'created', `Created artwork ${title}.`, createdAt);
    });

    return {
      data: mapArtwork(this.artworkRow(id)),
      message: 'Artwork created.',
      activity,
    };
  }

  updateArtwork(id: EntityId, input: UpdateArtworkInput): ArtworkMutationResponse {
    const artworkId = requiredId(id, 'id');
    assertAllowedKeys(input, ARTWORK_UPDATE_KEYS);
    assertPatchHasAField(input);
    const updatedAt = this.timestamp();

    const activity = this.transact(() => {
      const current = this.artworkRow(artworkId);
      const artistId =
        input.artistId === undefined ? current.artist_id : requiredId(input.artistId, 'artistId');
      const title =
        input.title === undefined
          ? current.title
          : requiredText(input.title, 'title', FIELD_LIMITS.artworkTitle);
      const medium =
        input.medium === undefined
          ? current.medium
          : requiredText(input.medium, 'medium', FIELD_LIMITS.medium);
      const year = input.year === undefined ? current.year : optionalYear(input.year, 'year');
      const widthCm =
        input.widthCm === undefined
          ? current.width_cm
          : optionalDimension(input.widthCm, 'widthCm');
      const heightCm =
        input.heightCm === undefined
          ? current.height_cm
          : optionalDimension(input.heightCm, 'heightCm');
      const framed =
        input.framed === undefined
          ? current.framed === 1
          : optionalBoolean(input.framed, 'framed', false);
      const status =
        input.status === undefined
          ? current.status
          : enumValue(input.status, ARTWORK_STATUSES, 'status');

      this.ensureArtistReference(artistId);

      this.db
        .prepare(
          `
          UPDATE artworks
          SET artist_id = ?, title = ?, medium = ?, year = ?, width_cm = ?, height_cm = ?,
              framed = ?, status = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          artistId,
          title,
          medium,
          year,
          widthCm,
          heightCm,
          framed ? 1 : 0,
          status,
          updatedAt,
          artworkId,
        );

      const action = status !== current.status ? 'status_changed' : 'updated';
      const detail =
        status !== current.status
          ? `Status changed from ${current.status} to ${status} for ${title}.`
          : `Updated artwork ${title}.`;
      return this.insertActivity('artwork', artworkId, action, detail, updatedAt);
    });

    return {
      data: mapArtwork(this.artworkRow(artworkId)),
      message: 'Artwork updated.',
      activity,
    };
  }

  private scheduleConflicts(
    candidate: Pick<
      ExhibitionRow,
      'id' | 'title' | 'space' | 'start_date' | 'end_date' | 'install_start' | 'install_end'
    > & { status?: ExhibitionStatus },
    excludeId?: EntityId,
  ): ConflictWarning[] {
    if (candidate.status === 'cancelled') {
      return [];
    }

    const rows = this.db
      .prepare(
        `
        SELECT id, title, subtitle, space, start_date, end_date, install_start, install_end,
               status, curator, notes, created_at, updated_at
        FROM exhibitions
        WHERE status <> 'cancelled' AND id <> ?
        ORDER BY id ASC
      `,
      )
      .all(excludeId ?? '') as ExhibitionRow[];

    const conflicts: ConflictWarning[] = [];
    const candidateSpace = normalizeSpace(candidate.space);
    for (const row of rows) {
      if (normalizeSpace(row.space) !== candidateSpace) {
        continue;
      }

      if (
        dateRangesOverlap(candidate.start_date, candidate.end_date, row.start_date, row.end_date)
      ) {
        conflicts.push({
          type: 'exhibition_space',
          message: `${candidateSpace} is already booked for ${row.title} on overlapping exhibition dates.`,
          exhibitionId: candidate.id,
          exhibitionTitle: candidate.title,
          relatedExhibitionId: row.id,
          relatedExhibitionTitle: row.title,
        });
      }

      if (
        dateRangesOverlap(
          candidate.install_start,
          candidate.install_end,
          row.install_start,
          row.install_end,
        )
      ) {
        conflicts.push({
          type: 'installation_space',
          message: `The installation window in ${candidateSpace} overlaps ${row.title}.`,
          exhibitionId: candidate.id,
          exhibitionTitle: candidate.title,
          relatedExhibitionId: row.id,
          relatedExhibitionTitle: row.title,
        });
      }
    }

    return conflicts;
  }

  private artworkPlacementConflicts(
    exhibition: Pick<ExhibitionRow, 'id' | 'title' | 'status' | 'install_start' | 'end_date'>,
    artworkId: EntityId,
  ): ConflictWarning[] {
    if (exhibition.status === 'cancelled') {
      return [];
    }

    const rows = this.db
      .prepare(
        `
        SELECT e.id, e.title
        FROM placements p
        JOIN exhibitions e ON e.id = p.exhibition_id
        WHERE p.artwork_id = ? AND e.id <> ? AND e.status <> 'cancelled'
          AND e.install_start <= ? AND ? <= e.end_date
        ORDER BY e.id ASC
      `,
      )
      .all(artworkId, exhibition.id, exhibition.end_date, exhibition.install_start) as {
      id: string;
      title: string;
    }[];

    const artwork = this.artworkRow(artworkId, 'artworkId');
    return rows.map((row) => ({
      type: 'artwork_double_booking',
      message: `${artwork.title} is already assigned to ${row.title} during this exhibition window.`,
      exhibitionId: exhibition.id,
      exhibitionTitle: exhibition.title,
      relatedExhibitionId: row.id,
      relatedExhibitionTitle: row.title,
      artworkId,
      artworkTitle: artwork.title,
    }));
  }

  private existingPlacementConflicts(exhibition: ExhibitionRow): ConflictWarning[] {
    if (exhibition.status === 'cancelled') {
      return [];
    }

    const rows = this.db
      .prepare(
        `
        SELECT cp.artwork_id, aw.title AS artwork_title, oe.id AS exhibition_id,
               oe.title AS exhibition_title
        FROM placements cp
        JOIN artworks aw ON aw.id = cp.artwork_id
        JOIN placements op ON op.artwork_id = cp.artwork_id AND op.id <> cp.id
        JOIN exhibitions oe ON oe.id = op.exhibition_id
        WHERE cp.exhibition_id = ? AND oe.id <> ? AND oe.status <> 'cancelled'
          AND oe.install_start <= ? AND ? <= oe.end_date
        GROUP BY cp.artwork_id, oe.id, aw.title, oe.title
        ORDER BY cp.artwork_id ASC, oe.id ASC
      `,
      )
      .all(exhibition.id, exhibition.id, exhibition.end_date, exhibition.install_start) as {
      artwork_id: string;
      artwork_title: string;
      exhibition_id: string;
      exhibition_title: string;
    }[];

    return rows.map((row) => ({
      type: 'artwork_double_booking',
      message: `${row.artwork_title} is also assigned to ${row.exhibition_title} during this installation and run window.`,
      exhibitionId: exhibition.id,
      exhibitionTitle: exhibition.title,
      relatedExhibitionId: row.exhibition_id,
      relatedExhibitionTitle: row.exhibition_title,
      artworkId: row.artwork_id,
      artworkTitle: row.artwork_title,
    }));
  }

  private loadConflictContext(today: IsoDate): ConflictContext {
    const shows = this.db
      .prepare(
        `
        SELECT id, title, subtitle, space, start_date, end_date, install_start, install_end,
               status, curator, notes, created_at, updated_at
        FROM exhibitions
        WHERE status <> 'cancelled' AND end_date >= ?
        ORDER BY id ASC
      `,
      )
      .all(today) as ExhibitionRow[];
    const artworkPlacements = this.db
      .prepare(
        `
        SELECT p.artwork_id, aw.title AS artwork_title, e.id AS exhibition_id,
               e.title AS exhibition_title, e.install_start, e.end_date
        FROM placements p
        JOIN artworks aw ON aw.id = p.artwork_id
        JOIN exhibitions e ON e.id = p.exhibition_id
        WHERE e.status <> 'cancelled' AND e.end_date >= ?
        ORDER BY p.artwork_id ASC, e.id ASC
      `,
      )
      .all(today) as ConflictPlacementRow[];

    return buildConflictContext(shows, artworkPlacements);
  }

  /** Batches placement and task aggregates so derived reads avoid per-show N+1 queries. */
  private loadDerived(
    rows: ExhibitionRow[],
    today: IsoDate,
    conflictContext?: ConflictContext,
  ): Map<string, Exhibition['derived']> {
    const derived = new Map<string, Exhibition['derived']>();
    if (rows.length === 0) {
      return derived;
    }

    const context = conflictContext ?? this.loadConflictContext(today);
    for (const row of rows) {
      derived.set(row.id, {
        artworkCount: 0,
        placedArtworkCount: 0,
        taskCount: 0,
        completedTaskCount: 0,
        openTaskCount: 0,
        overdueTaskCount: 0,
        conflictCount: context.byExhibition.get(row.id)?.length ?? 0,
        readinessPercent: 0,
        readinessState: 'attention',
      });
    }

    const ids = rows.map((row) => row.id);
    const placeholders = ids.map(() => '?').join(', ');
    const placementRows = this.db
      .prepare(
        `
        SELECT exhibition_id,
               COUNT(DISTINCT artwork_id) AS artwork_count,
               SUM(CASE WHEN length(trim(wall)) > 0 AND position >= 0 THEN 1 ELSE 0 END)
                 AS placed_artwork_count
        FROM placements
        WHERE exhibition_id IN (${placeholders})
        GROUP BY exhibition_id
      `,
      )
      .all(...ids) as PlacementAggregateRow[];
    const taskRows = this.db
      .prepare(
        `
        SELECT exhibition_id,
               COUNT(*) AS task_count,
               SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) AS completed_task_count,
               SUM(CASE WHEN status <> 'done' AND due_date IS NOT NULL AND due_date < ?
                        THEN 1 ELSE 0 END) AS overdue_task_count
        FROM installation_tasks
        WHERE exhibition_id IN (${placeholders})
        GROUP BY exhibition_id
      `,
      )
      .all(today, ...ids) as TaskAggregateRow[];

    const placementById = new Map(placementRows.map((row) => [row.exhibition_id, row]));
    const tasksById = new Map(taskRows.map((row) => [row.exhibition_id, row]));

    for (const row of rows) {
      const current = derived.get(row.id);
      if (!current) {
        continue;
      }
      const placement = placementById.get(row.id);
      const tasks = tasksById.get(row.id);
      const artworkCount = placement?.artwork_count ?? 0;
      const placedArtworkCount = placement?.placed_artwork_count ?? 0;
      const taskCount = tasks?.task_count ?? 0;
      const completedTaskCount = tasks?.completed_task_count ?? 0;
      const openTaskCount = taskCount - completedTaskCount;
      const overdueTaskCount = tasks?.overdue_task_count ?? 0;
      const readiness = calculateReadiness({
        artworkCount,
        placedArtworkCount,
        taskCount,
        completedTaskCount,
        overdueTaskCount,
        conflictCount: current.conflictCount,
      });

      derived.set(row.id, {
        ...current,
        artworkCount,
        placedArtworkCount,
        taskCount,
        completedTaskCount,
        openTaskCount,
        overdueTaskCount,
        ...readiness,
      });
    }

    return derived;
  }

  private mapExhibitionRecord(
    row: ExhibitionRow,
    context: ConflictContext,
    today: IsoDate,
  ): Exhibition {
    const derived = this.loadDerived([row], today, context).get(row.id);
    if (!derived) {
      throw internalError();
    }
    return mapExhibition(row, derived);
  }

  private exhibitionDetail(id: EntityId): ExhibitionDetail {
    const exhibitionId = requiredId(id, 'id');
    const today = this.today();
    const row = this.exhibitionRow(exhibitionId);
    const context = this.loadConflictContext(today);
    const base = this.mapExhibitionRecord(row, context, today);
    const placementRows = this.db
      .prepare(
        `
        SELECT p.id, p.exhibition_id, p.artwork_id, p.wall, p.position, p.label, p.notes,
               p.created_at, aw.title AS artwork_title, aw.medium AS artwork_medium,
               aw.year AS artwork_year, aw.width_cm AS artwork_width_cm,
               aw.height_cm AS artwork_height_cm, aw.framed AS artwork_framed,
               aw.status AS artwork_status, ar.id AS artist_id, ar.name AS artist_name,
               ar.status AS artist_status
        FROM placements p
        JOIN artworks aw ON aw.id = p.artwork_id
        JOIN artists ar ON ar.id = aw.artist_id
        WHERE p.exhibition_id = ?
        ORDER BY p.wall COLLATE NOCASE ASC, p.position ASC, p.id ASC
      `,
      )
      .all(exhibitionId) as PlacementRow[];
    const taskRows = this.db
      .prepare(
        `
        SELECT id, exhibition_id, title, category, assignee, due_date, status, created_at, updated_at
        FROM installation_tasks
        WHERE exhibition_id = ?
        ORDER BY (due_date IS NULL) ASC, due_date ASC, created_at ASC, id ASC
      `,
      )
      .all(exhibitionId) as TaskRow[];
    const activityRows = this.db
      .prepare(
        `
        SELECT id, entity_type, entity_id, action, detail, created_at
        FROM activity_entries
        WHERE entity_type = 'exhibition' AND entity_id = ?
        ORDER BY created_at DESC, id DESC
        LIMIT 50
      `,
      )
      .all(exhibitionId) as ActivityRow[];

    return {
      ...base,
      placements: placementRows.map(mapPlacement),
      tasks: taskRows.map(mapTask),
      activity: activityRows.map(mapActivity),
      conflicts: (context.byExhibition.get(exhibitionId) ?? []).map((warning) =>
        orientConflict(warning, exhibitionId),
      ),
    };
  }

  listExhibitions(query: ExhibitionListQuery = {}): ExhibitionListResponse {
    const pagination = normalizePagination(query);
    const conditions: string[] = [];
    const params: SqlParameter[] = [];

    if (query.search?.trim()) {
      const pattern = sqlLikePattern(query.search.trim());
      conditions.push(`(
        LOWER(title) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(subtitle, '')) LIKE ? ESCAPE '\\'
        OR LOWER(space) LIKE ? ESCAPE '\\'
        OR LOWER(COALESCE(curator, '')) LIKE ? ESCAPE '\\'
      )`);
      params.push(pattern, pattern, pattern, pattern);
    }
    if (query.status !== undefined) {
      conditions.push('status = ?');
      params.push(enumValue(query.status, EXHIBITION_STATUSES, 'status'));
    }
    if (query.space?.trim()) {
      conditions.push('LOWER(space) = ?');
      params.push(normalizeSpace(query.space));
    }
    if (query.from !== undefined) {
      conditions.push('end_date >= ?');
      params.push(requiredIsoDate(query.from, 'from'));
    }
    if (query.to !== undefined) {
      conditions.push('start_date <= ?');
      params.push(requiredIsoDate(query.to, 'to'));
    }

    if (query.from !== undefined && query.to !== undefined && query.from > query.to) {
      throw validationError('from must be on or before to.', 'from');
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortColumns: Readonly<Record<NonNullable<ExhibitionListQuery['sort']>, string>> = {
      startDate: 'start_date',
      endDate: 'end_date',
      title: 'title COLLATE NOCASE',
      updatedAt: 'updated_at',
    };
    const sort =
      sortColumns[
        sortValue(query.sort, ['startDate', 'endDate', 'title', 'updatedAt'] as const, 'startDate')
      ];
    const order = directionSql(query.direction);
    const count = this.db
      .prepare(`SELECT COUNT(*) AS count FROM exhibitions ${where}`)
      .get(...params) as CountRow;
    const rows = this.db
      .prepare(
        `
        SELECT id, title, subtitle, space, start_date, end_date, install_start, install_end,
               status, curator, notes, created_at, updated_at
        FROM exhibitions
        ${where}
        ORDER BY ${sort} ${order}, title COLLATE NOCASE ASC, id ASC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...params, pagination.pageSize, pagination.offset) as ExhibitionRow[];
    const today = this.today();
    const context = this.loadConflictContext(today);
    const derived = this.loadDerived(rows, today, context);

    return {
      data: rows.map((row) => {
        const values = derived.get(row.id);
        if (!values) {
          throw internalError();
        }
        return mapExhibition(row, values);
      }),
      pagination: paginationMeta(count.count, pagination),
    };
  }

  getExhibition(id: EntityId): ExhibitionDetailResponse {
    return { data: this.exhibitionDetail(id) };
  }

  getExhibitionDetail(id: EntityId): ExhibitionDetailResponse {
    return this.getExhibition(id);
  }

  createExhibition(input: CreateExhibitionInput): ExhibitionMutationResponse {
    assertAllowedKeys(input, EXHIBITION_CREATE_KEYS);
    const title = requiredText(input.title, 'title', FIELD_LIMITS.exhibitionTitle);
    const subtitle = optionalText(input.subtitle, 'subtitle', FIELD_LIMITS.subtitle);
    const space = normalizeSpace(requiredText(input.space, 'space', FIELD_LIMITS.space));
    const startDate = requiredIsoDate(input.startDate, 'startDate');
    const endDate = requiredIsoDate(input.endDate, 'endDate');
    const installStart = requiredIsoDate(input.installStart, 'installStart');
    const installEnd = requiredIsoDate(input.installEnd, 'installEnd');
    const curator = optionalText(input.curator, 'curator', FIELD_LIMITS.curator);
    const notes = optionalText(input.notes, 'notes', FIELD_LIMITS.notes);
    assertDateOrder({ installStart, installEnd, startDate, endDate });
    const id = randomUUID();
    const createdAt = this.timestamp();

    const activity = this.transact(() => {
      const conflicts = this.scheduleConflicts({
        id,
        title,
        space,
        start_date: startDate,
        end_date: endDate,
        install_start: installStart,
        install_end: installEnd,
      });
      if (conflicts.length > 0) {
        throw scheduleConflictError(conflicts);
      }

      this.db
        .prepare(
          `
          INSERT INTO exhibitions
            (id, title, subtitle, space, start_date, end_date, install_start, install_end,
             status, curator, notes, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?)
        `,
        )
        .run(
          id,
          title,
          subtitle,
          space,
          startDate,
          endDate,
          installStart,
          installEnd,
          curator,
          notes,
          createdAt,
          createdAt,
        );

      return this.insertActivity(
        'exhibition',
        id,
        'created',
        `Created draft exhibition ${title}.`,
        createdAt,
      );
    });

    const row = this.exhibitionRow(id);
    const today = this.today();
    const context = this.loadConflictContext(today);
    return {
      data: this.mapExhibitionRecord(row, context, today),
      message: 'Exhibition created.',
      activity,
    };
  }

  updateExhibition(id: EntityId, input: UpdateExhibitionInput): ExhibitionMutationResponse {
    const exhibitionId = requiredId(id, 'id');
    assertAllowedKeys(input, EXHIBITION_UPDATE_KEYS);
    assertPatchHasAField(input);
    const updatedAt = this.timestamp();

    const activity = this.transact(() => {
      const current = this.exhibitionRow(exhibitionId);
      const title =
        input.title === undefined
          ? current.title
          : requiredText(input.title, 'title', FIELD_LIMITS.exhibitionTitle);
      const subtitle =
        input.subtitle === undefined
          ? current.subtitle
          : optionalText(input.subtitle, 'subtitle', FIELD_LIMITS.subtitle);
      const space =
        input.space === undefined
          ? current.space
          : normalizeSpace(requiredText(input.space, 'space', FIELD_LIMITS.space));
      const startDate =
        input.startDate === undefined
          ? current.start_date
          : requiredIsoDate(input.startDate, 'startDate');
      const endDate =
        input.endDate === undefined ? current.end_date : requiredIsoDate(input.endDate, 'endDate');
      const installStart =
        input.installStart === undefined
          ? current.install_start
          : requiredIsoDate(input.installStart, 'installStart');
      const installEnd =
        input.installEnd === undefined
          ? current.install_end
          : requiredIsoDate(input.installEnd, 'installEnd');
      const curator =
        input.curator === undefined
          ? current.curator
          : optionalText(input.curator, 'curator', FIELD_LIMITS.curator);
      const notes =
        input.notes === undefined
          ? current.notes
          : optionalText(input.notes, 'notes', FIELD_LIMITS.notes);
      assertDateOrder({ installStart, installEnd, startDate, endDate });

      const candidate: ExhibitionRow = {
        ...current,
        title,
        subtitle,
        space,
        start_date: startDate,
        end_date: endDate,
        install_start: installStart,
        install_end: installEnd,
        curator,
        notes,
        updated_at: updatedAt,
      };
      const conflicts = this.scheduleConflicts(candidate, exhibitionId);
      if (conflicts.length > 0) {
        throw scheduleConflictError(conflicts);
      }
      const assignmentConflicts = this.existingPlacementConflicts(candidate);
      if (assignmentConflicts.length > 0) {
        throw artworkAssignmentConflictError(assignmentConflicts);
      }

      this.db
        .prepare(
          `
          UPDATE exhibitions
          SET title = ?, subtitle = ?, space = ?, start_date = ?, end_date = ?,
              install_start = ?, install_end = ?, curator = ?, notes = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(
          title,
          subtitle,
          space,
          startDate,
          endDate,
          installStart,
          installEnd,
          curator,
          notes,
          updatedAt,
          exhibitionId,
        );

      return this.insertActivity(
        'exhibition',
        exhibitionId,
        'updated',
        `Updated exhibition ${title}.`,
        updatedAt,
      );
    });

    const row = this.exhibitionRow(exhibitionId);
    const today = this.today();
    const context = this.loadConflictContext(today);
    return {
      data: this.mapExhibitionRecord(row, context, today),
      message: 'Exhibition updated.',
      activity,
    };
  }

  transitionExhibition(
    id: EntityId,
    input: ExhibitionTransitionRequest,
  ): ExhibitionMutationResponse {
    const exhibitionId = requiredId(id, 'id');
    assertAllowedKeys(input, ['to', 'note']);
    const targetStatus = enumValue(input.to, EXHIBITION_STATUSES, 'to');
    const note = optionalText(input.note, 'note', FIELD_LIMITS.transitionNote);
    const updatedAt = this.timestamp();

    const activity = this.transact(() => {
      const current = this.exhibitionRow(exhibitionId);
      if (!isLegalExhibitionTransition(current.status, targetStatus)) {
        throw invalidTransitionError(current.status, targetStatus);
      }

      const allowed = allowedExhibitionTransitions(current.status);
      if (!allowed.includes(targetStatus)) {
        throw invalidTransitionError(current.status, targetStatus);
      }

      this.db
        .prepare('UPDATE exhibitions SET status = ?, updated_at = ? WHERE id = ?')
        .run(targetStatus, updatedAt, exhibitionId);
      const noteSuffix = note ? ` Note: ${note}` : '';
      return this.insertActivity(
        'exhibition',
        exhibitionId,
        'status_changed',
        `Status changed from ${current.status} to ${targetStatus}.${noteSuffix}`,
        updatedAt,
      );
    });

    const row = this.exhibitionRow(exhibitionId);
    const today = this.today();
    const context = this.loadConflictContext(today);
    return {
      data: this.mapExhibitionRecord(row, context, today),
      message: `Exhibition moved to ${targetStatus}.`,
      activity,
    };
  }

  private assertPlacementSlotAvailable(
    exhibitionId: EntityId,
    artworkId: EntityId,
    wall: string,
    position: number,
    excludePlacementId?: EntityId,
  ): void {
    const duplicateArtwork = this.db
      .prepare(
        `
        SELECT id FROM placements
        WHERE exhibition_id = ? AND artwork_id = ? AND id <> ?
      `,
      )
      .get(exhibitionId, artworkId, excludePlacementId ?? '') as { id: string } | undefined;
    if (duplicateArtwork) {
      throw placementConflictError('This artwork is already placed in this exhibition.', {
        reason: 'duplicate_artwork',
        existingPlacementId: duplicateArtwork.id,
      });
    }

    const duplicateSlot = this.db
      .prepare(
        `
        SELECT id FROM placements
        WHERE exhibition_id = ? AND LOWER(wall) = LOWER(?) AND position = ? AND id <> ?
      `,
      )
      .get(exhibitionId, wall, position, excludePlacementId ?? '') as { id: string } | undefined;
    if (duplicateSlot) {
      throw placementConflictError('This wall position is already occupied in the exhibition.', {
        reason: 'duplicate_slot',
        existingPlacementId: duplicateSlot.id,
      });
    }
  }

  createPlacement(input: CreatePlacementInput): PlacementMutationResponse {
    assertAllowedKeys(input, PLACEMENT_CREATE_KEYS);
    const exhibitionId = requiredId(input.exhibitionId, 'exhibitionId');
    const artworkId = requiredId(input.artworkId, 'artworkId');
    const wall = requiredText(input.wall, 'wall', FIELD_LIMITS.wall);
    const position = requiredNonNegativeInteger(input.position, 'position');
    const label = optionalText(input.label, 'label', FIELD_LIMITS.placementLabel);
    const notes = optionalText(input.notes, 'notes', FIELD_LIMITS.notes);
    const createdAt = this.timestamp();
    const id = randomUUID();

    const activity = this.transact(() => {
      const exhibition = this.exhibitionRow(exhibitionId, 'exhibitionId');
      const artwork = this.artworkRow(artworkId, 'artworkId');
      if (artwork.status === 'retired') {
        throw ruleViolationError(
          'Retired artwork cannot be placed in a new exhibition.',
          'artworkId',
        );
      }

      this.assertPlacementSlotAvailable(exhibitionId, artworkId, wall, position);
      const conflicts = this.artworkPlacementConflicts(exhibition, artworkId);
      if (conflicts.length > 0) {
        throw artworkAssignmentConflictError(conflicts);
      }

      this.db
        .prepare(
          `
          INSERT INTO placements
            (id, exhibition_id, artwork_id, wall, position, label, notes, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(id, exhibitionId, artworkId, wall, position, label, notes, createdAt);

      return this.insertActivity(
        'placement',
        id,
        'created',
        `Placed ${artwork.title} on ${wall} at position ${position} for ${exhibition.title}.`,
        createdAt,
      );
    });

    return {
      data: mapPlacement(this.placementRow(id)),
      message: 'Placement created.',
      activity,
    };
  }

  updatePlacement(id: EntityId, input: UpdatePlacementInput): PlacementMutationResponse {
    const placementId = requiredId(id, 'id');
    assertAllowedKeys(input, PLACEMENT_UPDATE_KEYS);
    assertPatchHasAField(input);
    const updatedAt = this.timestamp();

    const activity = this.transact(() => {
      const current = this.placementRow(placementId);
      const wall =
        input.wall === undefined
          ? current.wall
          : requiredText(input.wall, 'wall', FIELD_LIMITS.wall);
      const position =
        input.position === undefined
          ? current.position
          : requiredNonNegativeInteger(input.position, 'position');
      const label =
        input.label === undefined
          ? current.label
          : optionalText(input.label, 'label', FIELD_LIMITS.placementLabel);
      const notes =
        input.notes === undefined
          ? current.notes
          : optionalText(input.notes, 'notes', FIELD_LIMITS.notes);
      const exhibition = this.exhibitionRow(current.exhibition_id);

      this.assertPlacementSlotAvailable(
        current.exhibition_id,
        current.artwork_id,
        wall,
        position,
        placementId,
      );
      const conflicts = this.artworkPlacementConflicts(exhibition, current.artwork_id);
      if (conflicts.length > 0) {
        throw artworkAssignmentConflictError(conflicts);
      }

      this.db
        .prepare('UPDATE placements SET wall = ?, position = ?, label = ?, notes = ? WHERE id = ?')
        .run(wall, position, label, notes, placementId);
      return this.insertActivity(
        'placement',
        placementId,
        'updated',
        `Updated ${current.artwork_title} placement on ${wall} at position ${position} for ${exhibition.title}.`,
        updatedAt,
      );
    });

    return {
      data: mapPlacement(this.placementRow(placementId)),
      message: 'Placement updated.',
      activity,
    };
  }

  deletePlacement(id: EntityId): DeleteResponse {
    const placementId = requiredId(id, 'id');
    const deletedAt = this.timestamp();

    const activity = this.transact(() => {
      const current = this.placementRow(placementId);
      const exhibition = this.exhibitionRow(current.exhibition_id);
      const entry = this.insertActivity(
        'placement',
        placementId,
        'deleted',
        `Removed ${current.artwork_title} from ${current.wall} at position ${current.position} in ${exhibition.title}.`,
        deletedAt,
      );
      this.db.prepare('DELETE FROM placements WHERE id = ?').run(placementId);
      return entry;
    });

    const data: DeletedEntity = { id: placementId };
    return { data, message: 'Placement removed.', activity };
  }

  listTasks(query: TaskListQuery = {}): TaskListResponse {
    const pagination = normalizePagination(query);
    const conditions: string[] = [];
    const params: SqlParameter[] = [];

    if (query.exhibitionId !== undefined) {
      conditions.push('exhibition_id = ?');
      params.push(requiredId(query.exhibitionId, 'exhibitionId'));
    }
    if (query.status !== undefined) {
      conditions.push('status = ?');
      params.push(enumValue(query.status, TASK_STATUSES, 'status'));
    }
    if (query.category !== undefined) {
      conditions.push('category = ?');
      params.push(enumValue(query.category, TASK_CATEGORIES, 'category'));
    }
    if (query.overdue !== undefined) {
      if (typeof query.overdue !== 'boolean') {
        throw validationError('overdue must be true or false.', 'overdue');
      }
      const overdueSql = "(status <> 'done' AND due_date IS NOT NULL AND due_date < ?)";
      conditions.push(query.overdue ? overdueSql : `NOT ${overdueSql}`);
      params.push(this.today());
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const sortColumns: Readonly<Record<NonNullable<TaskListQuery['sort']>, string>> = {
      dueDate: '(due_date IS NULL) ASC, due_date',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    };
    const sort =
      sortColumns[sortValue(query.sort, ['dueDate', 'createdAt', 'updatedAt'] as const, 'dueDate')];
    const order = directionSql(query.direction);
    const count = this.db
      .prepare(`SELECT COUNT(*) AS count FROM installation_tasks ${where}`)
      .get(...params) as CountRow;
    const rows = this.db
      .prepare(
        `
        SELECT id, exhibition_id, title, category, assignee, due_date, status, created_at, updated_at
        FROM installation_tasks
        ${where}
        ORDER BY ${sort} ${order}, id ASC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...params, pagination.pageSize, pagination.offset) as TaskRow[];

    return {
      data: rows.map(mapTask),
      pagination: paginationMeta(count.count, pagination),
    };
  }

  createTask(exhibitionId: EntityId, input: CreateTaskInput): TaskMutationResponse {
    const targetExhibitionId = requiredId(exhibitionId, 'exhibitionId');
    assertAllowedKeys(input, TASK_CREATE_KEYS);
    const title = requiredText(input.title, 'title', FIELD_LIMITS.taskTitle);
    const category = enumValue(input.category, TASK_CATEGORIES, 'category');
    const assignee = optionalText(input.assignee, 'assignee', FIELD_LIMITS.assignee);
    const dueDate = optionalIsoDate(input.dueDate, 'dueDate');
    const status =
      input.status !== undefined
        ? enumValue(input.status, TASK_STATUSES, 'status')
        : ('todo' satisfies TaskStatus);
    const createdAt = this.timestamp();
    const id = randomUUID();

    const activity = this.transact(() => {
      const exhibition = this.exhibitionRow(targetExhibitionId, 'exhibitionId');
      this.db
        .prepare(
          `
          INSERT INTO installation_tasks
            (id, exhibition_id, title, category, assignee, due_date, status, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        )
        .run(
          id,
          targetExhibitionId,
          title,
          category,
          assignee,
          dueDate,
          status,
          createdAt,
          createdAt,
        );

      return this.insertActivity(
        'task',
        id,
        'created',
        `Created task ${title} for ${exhibition.title}.`,
        createdAt,
      );
    });

    return {
      data: mapTask(this.taskRow(id)),
      message: 'Task created.',
      activity,
    };
  }

  updateTask(id: EntityId, input: UpdateTaskInput): TaskMutationResponse {
    const taskId = requiredId(id, 'id');
    assertAllowedKeys(input, TASK_UPDATE_KEYS);
    assertPatchHasAField(input);
    const updatedAt = this.timestamp();

    const activity = this.transact(() => {
      const current = this.taskRow(taskId);
      const exhibition = this.exhibitionRow(current.exhibition_id);
      const title =
        input.title === undefined
          ? current.title
          : requiredText(input.title, 'title', FIELD_LIMITS.taskTitle);
      const category =
        input.category === undefined
          ? current.category
          : enumValue(input.category, TASK_CATEGORIES, 'category');
      const assignee =
        input.assignee === undefined
          ? current.assignee
          : optionalText(input.assignee, 'assignee', FIELD_LIMITS.assignee);
      const dueDate =
        input.dueDate === undefined ? current.due_date : optionalIsoDate(input.dueDate, 'dueDate');
      const status =
        input.status === undefined
          ? current.status
          : enumValue(input.status, TASK_STATUSES, 'status');

      this.db
        .prepare(
          `
          UPDATE installation_tasks
          SET title = ?, category = ?, assignee = ?, due_date = ?, status = ?, updated_at = ?
          WHERE id = ?
        `,
        )
        .run(title, category, assignee, dueDate, status, updatedAt, taskId);

      if (status !== current.status) {
        return this.insertActivity(
          'task',
          taskId,
          'status_changed',
          `Status changed from ${current.status} to ${status} for ${title}.`,
          updatedAt,
        );
      }

      return this.insertActivity(
        'task',
        taskId,
        'updated',
        `Updated task ${title} for ${exhibition.title}.`,
        updatedAt,
      );
    });

    return {
      data: mapTask(this.taskRow(taskId)),
      message: input.status === undefined ? 'Task updated.' : 'Task status updated.',
      activity,
    };
  }

  deleteTask(id: EntityId): DeleteResponse {
    const taskId = requiredId(id, 'id');
    const deletedAt = this.timestamp();

    const activity = this.transact(() => {
      const current = this.taskRow(taskId);
      const exhibition = this.exhibitionRow(current.exhibition_id);
      const entry = this.insertActivity(
        'task',
        taskId,
        'deleted',
        `Deleted task ${current.title} from ${exhibition.title}.`,
        deletedAt,
      );
      this.db.prepare('DELETE FROM installation_tasks WHERE id = ?').run(taskId);
      return entry;
    });

    const data: DeletedEntity = { id: taskId };
    return { data, message: 'Task deleted.', activity };
  }

  listActivity(query: ActivityListQuery = {}): ActivityListResponse {
    const pagination = normalizePagination({
      page: query.page,
      pageSize: query.limit ?? query.pageSize,
    });
    const conditions: string[] = [];
    const params: SqlParameter[] = [];

    if (query.entityType !== undefined) {
      const entityType = enumValue(
        query.entityType,
        ['artist', 'artwork', 'exhibition', 'placement', 'task'] as const,
        'entityType',
      );
      conditions.push('entity_type = ?');
      params.push(entityType);
    }
    if (query.entityId !== undefined) {
      conditions.push('entity_id = ?');
      params.push(requiredId(query.entityId, 'entityId'));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const count = this.db
      .prepare(`SELECT COUNT(*) AS count FROM activity_entries ${where}`)
      .get(...params) as CountRow;
    const rows = this.db
      .prepare(
        `
        SELECT id, entity_type, entity_id, action, detail, created_at
        FROM activity_entries
        ${where}
        ORDER BY created_at DESC, id DESC
        LIMIT ? OFFSET ?
      `,
      )
      .all(...params, pagination.pageSize, pagination.offset) as ActivityRow[];

    return {
      data: rows.map(mapActivity),
      pagination: paginationMeta(count.count, pagination),
    };
  }

  private statusCounts(): DashboardStatusCounts {
    const artistRows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM artists GROUP BY status')
      .all() as { status: ArtistStatus; count: number }[];
    const artworkRows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM artworks GROUP BY status')
      .all() as { status: ArtworkStatus; count: number }[];
    const exhibitionRows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM exhibitions GROUP BY status')
      .all() as { status: ExhibitionStatus; count: number }[];
    const taskRows = this.db
      .prepare('SELECT status, COUNT(*) AS count FROM installation_tasks GROUP BY status')
      .all() as { status: TaskStatus; count: number }[];

    const artists: Record<ArtistStatus, number> = { active: 0, archived: 0 };
    const artworks: Record<ArtworkStatus, number> = {
      available: 0,
      reserved: 0,
      retired: 0,
    };
    const exhibitions: Record<ExhibitionStatus, number> = {
      draft: 0,
      planned: 0,
      installing: 0,
      open: 0,
      closed: 0,
      cancelled: 0,
    };
    const tasks: Record<TaskStatus, number> = { todo: 0, in_progress: 0, done: 0 };

    for (const row of artistRows) {
      artists[row.status] = row.count;
    }
    for (const row of artworkRows) {
      artworks[row.status] = row.count;
    }
    for (const row of exhibitionRows) {
      exhibitions[row.status] = row.count;
    }
    for (const row of taskRows) {
      tasks[row.status] = row.count;
    }

    return { artists, artworks, exhibitions, tasks };
  }

  getDashboard(): DashboardResponse {
    const today = this.today();
    const generatedAt = this.timestamp();
    const totalsRow = this.db
      .prepare(
        `
        SELECT
          (SELECT COUNT(*) FROM artists) AS artists,
          (SELECT COUNT(*) FROM artists WHERE status = 'active') AS active_artists,
          (SELECT COUNT(*) FROM artworks) AS artworks,
          (SELECT COUNT(*) FROM artworks WHERE status = 'available') AS available_artworks,
          (SELECT COUNT(*) FROM exhibitions) AS exhibitions,
          (SELECT COUNT(*) FROM exhibitions
            WHERE status NOT IN ('cancelled', 'closed') AND end_date >= ?) AS scheduled_exhibitions,
          (SELECT COUNT(*) FROM placements) AS placements,
          (SELECT COUNT(*) FROM installation_tasks WHERE status <> 'done') AS open_tasks
      `,
      )
      .get(today) as DashboardTotalsRow;
    const totals: DashboardTotals = {
      artists: totalsRow.artists,
      activeArtists: totalsRow.active_artists,
      artworks: totalsRow.artworks,
      availableArtworks: totalsRow.available_artworks,
      exhibitions: totalsRow.exhibitions,
      scheduledExhibitions: totalsRow.scheduled_exhibitions,
      placements: totalsRow.placements,
      openTasks: totalsRow.open_tasks,
    };

    const upcomingRows = this.db
      .prepare(
        `
        SELECT id, title, subtitle, space, start_date, end_date, install_start, install_end,
               status, curator, notes, created_at, updated_at
        FROM exhibitions
        WHERE status <> 'cancelled' AND end_date >= ?
        ORDER BY start_date ASC, title COLLATE NOCASE ASC, id ASC
        LIMIT 8
      `,
      )
      .all(today) as ExhibitionRow[];
    const conflictContext = this.loadConflictContext(today);
    const derived = this.loadDerived(upcomingRows, today, conflictContext);

    const upcomingExhibitions: UpcomingExhibition[] = upcomingRows.map((row) => {
      const values = derived.get(row.id);
      if (!values) {
        throw internalError();
      }
      return {
        id: row.id,
        title: row.title,
        space: row.space,
        startDate: row.start_date,
        endDate: row.end_date,
        installStart: row.install_start,
        installEnd: row.install_end,
        status: row.status,
        readinessPercent: values.readinessPercent,
        readinessState: values.readinessState,
        conflictCount: values.conflictCount,
      };
    });
    const readinessRows: ReadinessRow[] = upcomingRows.map((row) => {
      const values = derived.get(row.id);
      if (!values) {
        throw internalError();
      }
      return {
        exhibitionId: row.id,
        title: row.title,
        space: row.space,
        status: row.status,
        startDate: row.start_date,
        endDate: row.end_date,
        artworkCount: values.artworkCount,
        placedArtworkCount: values.placedArtworkCount,
        taskCount: values.taskCount,
        completedTaskCount: values.completedTaskCount,
        openTaskCount: values.openTaskCount,
        overdueTaskCount: values.overdueTaskCount,
        conflictCount: values.conflictCount,
        readinessPercent: values.readinessPercent,
        readinessState: values.readinessState,
      };
    });

    const overdue = this.db
      .prepare(
        `
        SELECT COUNT(*) AS count
        FROM installation_tasks
        WHERE status <> 'done' AND due_date IS NOT NULL AND due_date < ?
      `,
      )
      .get(today) as CountRow;
    const recentActivity = this.db
      .prepare(
        `
        SELECT id, entity_type, entity_id, action, detail, created_at
        FROM activity_entries
        ORDER BY created_at DESC, id DESC
        LIMIT 10
      `,
      )
      .all() as ActivityRow[];

    const summary: DashboardSummary = {
      totals,
      statusCounts: this.statusCounts(),
      upcomingExhibitions,
      readinessRows,
      overdueTaskCount: overdue.count,
      conflictWarningCount: conflictContext.all.length,
      recentActivity: recentActivity.map(mapActivity),
      generatedAt,
    };

    return { data: summary };
  }

  exportExhibitionsCsv(): string {
    const today = this.today();
    const rows = this.db
      .prepare(
        `
        SELECT id, title, subtitle, space, start_date, end_date, install_start, install_end,
               status, curator, notes, created_at, updated_at
        FROM exhibitions
        ORDER BY start_date ASC, title COLLATE NOCASE ASC, id ASC
      `,
      )
      .all() as ExhibitionRow[];
    const context = this.loadConflictContext(today);
    const derived = this.loadDerived(rows, today, context);
    const headers: readonly (keyof ExhibitionExportRow)[] = [
      'exhibitionId',
      'title',
      'subtitle',
      'status',
      'space',
      'startDate',
      'endDate',
      'installStart',
      'installEnd',
      'curator',
      'artworkCount',
      'placedArtworkCount',
      'taskCount',
      'completedTaskCount',
      'openTaskCount',
      'readinessPercent',
      'conflictCount',
      'updatedAt',
    ];
    const lines = [headers.join(',')];

    for (const row of rows) {
      const values = derived.get(row.id);
      if (!values) {
        throw internalError();
      }
      const exportRow: ExhibitionExportRow = {
        exhibitionId: row.id,
        title: row.title,
        subtitle: row.subtitle,
        status: row.status,
        space: row.space,
        startDate: row.start_date,
        endDate: row.end_date,
        installStart: row.install_start,
        installEnd: row.install_end,
        curator: row.curator,
        artworkCount: values.artworkCount,
        placedArtworkCount: values.placedArtworkCount,
        taskCount: values.taskCount,
        completedTaskCount: values.completedTaskCount,
        openTaskCount: values.openTaskCount,
        readinessPercent: values.readinessPercent,
        conflictCount: values.conflictCount,
        updatedAt: row.updated_at,
      };
      lines.push(headers.map((header) => csvCell(exportRow[header])).join(','));
    }

    return lines.join('\n');
  }
}

function mapExhibition(row: ExhibitionRow, derived: Exhibition['derived']): Exhibition {
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    space: row.space,
    startDate: row.start_date,
    endDate: row.end_date,
    installStart: row.install_start,
    installEnd: row.install_end,
    status: row.status,
    curator: row.curator,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    derived,
  };
}

function csvCell(value: string | number | null): string {
  if (value === null) {
    return '';
  }
  const text = String(value);
  if (/[",\r\n]/u.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
