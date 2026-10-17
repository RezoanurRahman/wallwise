import type {
  ActivityAction,
  ArtistStatus,
  ArtworkStatus,
  ExhibitionStatus,
  TaskCategory,
  TaskStatus,
} from './types';

export const ARTIST_STATUSES = ['active', 'archived'] as const satisfies readonly ArtistStatus[];

export const ARTWORK_STATUSES = [
  'available',
  'reserved',
  'retired',
] as const satisfies readonly ArtworkStatus[];

export const EXHIBITION_STATUSES = [
  'draft',
  'planned',
  'installing',
  'open',
  'closed',
  'cancelled',
] as const satisfies readonly ExhibitionStatus[];

export const TASK_STATUSES = [
  'todo',
  'in_progress',
  'done',
] as const satisfies readonly TaskStatus[];

export const TASK_CATEGORIES = [
  'wall_prep',
  'lighting',
  'hanging',
  'labeling',
  'condition_check',
  'shipping',
  'other',
] as const satisfies readonly TaskCategory[];

export const TASK_CATEGORY_LABELS: Readonly<Record<TaskCategory, string>> = {
  wall_prep: 'Wall prep',
  lighting: 'Lighting',
  hanging: 'Hanging',
  labeling: 'Labels',
  condition_check: 'Condition check',
  shipping: 'Shipping',
  other: 'Other',
};

export const ACTIVITY_ACTIONS = [
  'created',
  'updated',
  'deleted',
  'status_changed',
  'seeded',
] as const satisfies readonly ActivityAction[];

/**
 * The only legal exhibition lifecycle moves. The transition endpoint must reject
 * every move not present here and append an audit entry in the same transaction.
 */
export const EXHIBITION_STATUS_TRANSITIONS = {
  draft: ['planned', 'cancelled'],
  planned: ['installing', 'cancelled'],
  installing: ['open', 'cancelled'],
  open: ['closed'],
  closed: [],
  cancelled: [],
} as const satisfies Readonly<Record<ExhibitionStatus, readonly ExhibitionStatus[]>>;

export function isExhibitionTransitionAllowed(
  from: ExhibitionStatus,
  to: ExhibitionStatus,
): boolean {
  const allowed: readonly ExhibitionStatus[] = EXHIBITION_STATUS_TRANSITIONS[from];
  return allowed.includes(to);
}

export const SEED_MARKER = 'wallwise-seed-v1';
export const SEED_VERSION = 1;

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export const ERROR_CODES = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  NOT_FOUND: 'NOT_FOUND',
  SCHEDULE_CONFLICT: 'SCHEDULE_CONFLICT',
  ARTWORK_ASSIGNMENT_CONFLICT: 'ARTWORK_ASSIGNMENT_CONFLICT',
  PLACEMENT_CONFLICT: 'PLACEMENT_CONFLICT',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  RULE_VIOLATION: 'RULE_VIOLATION',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export const FIELD_LIMITS = {
  artistName: 120,
  email: 254,
  bio: 2_000,
  artworkTitle: 160,
  medium: 120,
  exhibitionTitle: 160,
  subtitle: 200,
  space: 120,
  curator: 120,
  notes: 2_000,
  wall: 80,
  placementLabel: 80,
  taskTitle: 160,
  assignee: 120,
  transitionNote: 500,
} as const;

export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
