import { z } from 'zod';

import {
  ARTIST_STATUSES,
  ARTWORK_STATUSES,
  EXHIBITION_STATUSES,
  FIELD_LIMITS,
  ISO_DATE_PATTERN,
  TASK_CATEGORIES,
  TASK_STATUSES,
} from '../../shared/constants';
import type { ActivityEntityType } from '../../shared/types';
import { validationError } from '../domain/errors';

const ACTIVITY_ENTITY_TYPES = [
  'artist',
  'artwork',
  'exhibition',
  'placement',
  'task',
] as const satisfies readonly ActivityEntityType[];

const MAX_ID_LENGTH = 200;
const MAX_POSITION = 1_000_000;

type ParseSource = 'body' | 'query';

export interface ParseOptions {
  source?: ParseSource;
  fallbackField?: string;
}

interface ValidationIssue {
  field?: string;
  message: string;
}

function requiredText(field: string, maxLength: number) {
  return z
    .string({ error: `${field} is required.` })
    .min(1, `${field} is required.`)
    .max(maxLength, `${field} must be ${maxLength} characters or fewer.`);
}

function optionalText(field: string, maxLength: number) {
  return z
    .string({ error: `${field} must be text.` })
    .max(maxLength, `${field} must be ${maxLength} characters or fewer.`)
    .nullable()
    .optional();
}

function isoDate(field: string) {
  return z
    .string({ error: `${field} must be a date in YYYY-MM-DD format.` })
    .regex(ISO_DATE_PATTERN, `${field} must be a date in YYYY-MM-DD format.`);
}

function enumSchema<const T extends readonly [string, ...string[]]>(values: T, field: string) {
  return z.enum(values, { error: `${field} must be one of: ${values.join(', ')}.` });
}

function positiveIntegerQuery(field: string) {
  return z
    .string({ error: `${field} must be a positive integer.` })
    .regex(/^\d+$/, `${field} must be a positive integer.`)
    .transform((value) => Number.parseInt(value, 10))
    .pipe(
      z
        .number()
        .int(`${field} must be a positive integer.`)
        .positive(`${field} must be a positive integer.`)
        .max(Number.MAX_SAFE_INTEGER, `${field} must be a positive integer.`),
    );
}

const artistStatus = enumSchema(ARTIST_STATUSES, 'status');
const artworkStatus = enumSchema(ARTWORK_STATUSES, 'status');
const exhibitionStatus = enumSchema(EXHIBITION_STATUSES, 'status');
const taskStatus = enumSchema(TASK_STATUSES, 'status');
const taskCategory = enumSchema(TASK_CATEGORIES, 'category');
const sortDirection = enumSchema(['asc', 'desc'] as const, 'direction');
const booleanQuery = (field: string) =>
  z
    .enum(['true', 'false'], { error: `${field} must be true or false.` })
    .transform((value) => value === 'true');

export const CreateArtistSchema = z.strictObject({
  name: requiredText('name', FIELD_LIMITS.artistName),
  email: optionalText('email', FIELD_LIMITS.email),
  bio: optionalText('bio', FIELD_LIMITS.bio),
  status: artistStatus.optional(),
});

export const UpdateArtistSchema = CreateArtistSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field is required.' },
);

export const CreateArtworkSchema = z.strictObject({
  artistId: requiredText('artistId', MAX_ID_LENGTH),
  title: requiredText('title', FIELD_LIMITS.artworkTitle),
  medium: requiredText('medium', FIELD_LIMITS.medium),
  year: z
    .number({ error: 'year must be a whole number.' })
    .int('year must be a whole number.')
    .min(1000, 'year must be between 1000 and 2100.')
    .max(2100, 'year must be between 1000 and 2100.')
    .nullable()
    .optional(),
  widthCm: z
    .number({ error: 'widthCm must be a finite number.' })
    .finite('widthCm must be a finite number.')
    .gt(0, 'widthCm must be greater than 0 and at most 10000.')
    .max(10_000, 'widthCm must be greater than 0 and at most 10000.')
    .nullable()
    .optional(),
  heightCm: z
    .number({ error: 'heightCm must be a finite number.' })
    .finite('heightCm must be a finite number.')
    .gt(0, 'heightCm must be greater than 0 and at most 10000.')
    .max(10_000, 'heightCm must be greater than 0 and at most 10000.')
    .nullable()
    .optional(),
  framed: z.boolean({ error: 'framed must be true or false.' }).optional(),
  status: artworkStatus.optional(),
});

export const UpdateArtworkSchema = CreateArtworkSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field is required.' },
);

export const CreateExhibitionSchema = z.strictObject({
  title: requiredText('title', FIELD_LIMITS.exhibitionTitle),
  subtitle: optionalText('subtitle', FIELD_LIMITS.subtitle),
  space: requiredText('space', FIELD_LIMITS.space),
  startDate: isoDate('startDate'),
  endDate: isoDate('endDate'),
  installStart: isoDate('installStart'),
  installEnd: isoDate('installEnd'),
  curator: optionalText('curator', FIELD_LIMITS.curator),
  notes: optionalText('notes', FIELD_LIMITS.notes),
});

export const UpdateExhibitionSchema = CreateExhibitionSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field is required.' },
);

/** Request body for POST /exhibitions/:id/placements; the path supplies the exhibition ID. */
export const CreatePlacementSchema = z.strictObject({
  exhibitionId: requiredText('exhibitionId', MAX_ID_LENGTH).optional(),
  artworkId: requiredText('artworkId', MAX_ID_LENGTH),
  wall: requiredText('wall', FIELD_LIMITS.wall),
  position: z
    .number({ error: 'position must be a non-negative whole number.' })
    .int('position must be a non-negative whole number.')
    .min(0, 'position must be a non-negative whole number.')
    .max(MAX_POSITION, 'position must be a non-negative whole number.'),
  label: optionalText('label', FIELD_LIMITS.placementLabel),
  notes: optionalText('notes', FIELD_LIMITS.notes),
});

export const UpdatePlacementSchema = z
  .strictObject({
    wall: requiredText('wall', FIELD_LIMITS.wall).optional(),
    position: z
      .number({ error: 'position must be a non-negative whole number.' })
      .int('position must be a non-negative whole number.')
      .min(0, 'position must be a non-negative whole number.')
      .max(MAX_POSITION, 'position must be a non-negative whole number.')
      .optional(),
    label: optionalText('label', FIELD_LIMITS.placementLabel),
    notes: optionalText('notes', FIELD_LIMITS.notes),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one field is required.',
  });

export const CreateTaskSchema = z.strictObject({
  title: requiredText('title', FIELD_LIMITS.taskTitle),
  category: taskCategory,
  assignee: optionalText('assignee', FIELD_LIMITS.assignee),
  dueDate: isoDate('dueDate').nullable().optional(),
  status: taskStatus.optional(),
});

export const UpdateTaskSchema = CreateTaskSchema.partial().refine(
  (value) => Object.keys(value).length > 0,
  { message: 'At least one field is required.' },
);

export const ExhibitionTransitionSchema = z.strictObject({
  to: exhibitionStatus,
  note: optionalText('note', FIELD_LIMITS.transitionNote),
});

export const ArtistListQuerySchema = z.strictObject({
  search: z.string({ error: 'search must be text.' }).optional(),
  status: artistStatus.optional(),
  sort: enumSchema(['name', 'createdAt', 'updatedAt'] as const, 'sort').optional(),
  direction: sortDirection.optional(),
  page: positiveIntegerQuery('page').optional(),
  pageSize: positiveIntegerQuery('pageSize').optional(),
});

export const ArtworkListQuerySchema = z.strictObject({
  search: z.string({ error: 'search must be text.' }).optional(),
  artistId: z.string({ error: 'artistId must be text.' }).optional(),
  status: artworkStatus.optional(),
  sort: enumSchema(['title', 'artist', 'createdAt', 'updatedAt'] as const, 'sort').optional(),
  direction: sortDirection.optional(),
  page: positiveIntegerQuery('page').optional(),
  pageSize: positiveIntegerQuery('pageSize').optional(),
});

export const ExhibitionListQuerySchema = z.strictObject({
  search: z.string({ error: 'search must be text.' }).optional(),
  status: exhibitionStatus.optional(),
  space: z.string({ error: 'space must be text.' }).optional(),
  from: isoDate('from').optional(),
  to: isoDate('to').optional(),
  sort: enumSchema(['startDate', 'endDate', 'title', 'updatedAt'] as const, 'sort').optional(),
  direction: sortDirection.optional(),
  page: positiveIntegerQuery('page').optional(),
  pageSize: positiveIntegerQuery('pageSize').optional(),
});

export const TaskListQuerySchema = z.strictObject({
  exhibitionId: z.string({ error: 'exhibitionId must be text.' }).optional(),
  status: taskStatus.optional(),
  category: taskCategory.optional(),
  overdue: booleanQuery('overdue').optional(),
  sort: enumSchema(['dueDate', 'createdAt', 'updatedAt'] as const, 'sort').optional(),
  direction: sortDirection.optional(),
  page: positiveIntegerQuery('page').optional(),
  pageSize: positiveIntegerQuery('pageSize').optional(),
});

export const ActivityListQuerySchema = z.strictObject({
  entityType: enumSchema(ACTIVITY_ENTITY_TYPES, 'entityType').optional(),
  entityId: z.string({ error: 'entityId must be text.' }).optional(),
  limit: positiveIntegerQuery('limit').optional(),
  page: positiveIntegerQuery('page').optional(),
  pageSize: positiveIntegerQuery('pageSize').optional(),
});

function issueField(issue: z.core.$ZodIssue): string | undefined {
  return issue.path.length > 0 ? issue.path.map((part) => String(part)).join('.') : undefined;
}

function formatIssue(
  issue: z.core.$ZodIssue,
  source: ParseSource,
  fallbackField?: string,
): ValidationIssue {
  const field = issueField(issue);

  if (issue.code === 'unrecognized_keys') {
    const key = issue.keys[0];
    return {
      field: key ?? fallbackField,
      message:
        source === 'query'
          ? `Unknown query parameter${key ? ` "${key}"` : ''}.`
          : `Unknown field${key ? ` "${key}"` : ''}.`,
    };
  }

  if (field !== undefined) {
    if (issue.code === 'invalid_type' && issue.input === undefined) {
      return { field, message: `${field} is required.` };
    }
    return { field, message: issue.message };
  }

  if (issue.code === 'custom') {
    return {
      ...(fallbackField === undefined ? {} : { field: fallbackField }),
      message: issue.message,
    };
  }

  return {
    ...(fallbackField === undefined ? {} : { field: fallbackField }),
    message:
      source === 'query'
        ? 'Query parameters are invalid.'
        : 'Request body must be a JSON object with valid fields.',
  };
}

function validationIssues(error: z.ZodError, options: ParseOptions): ValidationIssue[] {
  const source = options.source ?? 'body';
  return error.issues.map((issue) => formatIssue(issue, source, options.fallbackField));
}

export function parseOrThrow<S extends z.ZodType>(
  schema: S,
  value: unknown,
  options: ParseOptions = {},
): z.output<S> {
  const result = schema.safeParse(value);
  if (result.success) {
    return result.data;
  }

  const issues = validationIssues(result.error, options);
  const first = issues[0];

  throw validationError(
    first?.message ?? 'The request is invalid.',
    first?.field ?? options.fallbackField,
    { issues },
  );
}

/** Converts URL search parameters into a strict query object and parses it. */
export function parseQuery<S extends z.ZodType>(
  schema: S,
  searchParams: URLSearchParams,
): z.output<S> {
  const value: Record<string, string> = {};

  for (const [key, entry] of searchParams.entries()) {
    if (Object.hasOwn(value, key)) {
      throw validationError(`Query parameter "${key}" may only be provided once.`, key);
    }
    value[key] = entry;
  }

  return parseOrThrow(schema, value, { source: 'query' });
}
