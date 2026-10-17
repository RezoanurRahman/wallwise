import {
  EXHIBITION_STATUS_TRANSITIONS,
  ISO_DATE_PATTERN,
  isExhibitionTransitionAllowed,
} from '../../shared/constants';
import type { ExhibitionStatus, IsoDate, ReadinessState, TaskStatus } from '../../shared/types';

export interface IsoDateRange {
  startDate: IsoDate;
  endDate: IsoDate;
}

export interface ReadinessInput {
  artworkCount: number;
  placedArtworkCount: number;
  taskCount: number;
  completedTaskCount: number;
  overdueTaskCount: number;
  conflictCount: number;
}

export interface ReadinessResult {
  readinessPercent: number;
  readinessState: ReadinessState;
}

/** Parses a real `YYYY-MM-DD` calendar date, or returns null. */
export function parseIsoDate(value: string): Date | null {
  if (!ISO_DATE_PATTERN.test(value)) {
    return null;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (year >= 0 && year <= 99) {
    parsed.setUTCFullYear(year);
  }

  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }

  return parsed;
}

export function isRealIsoDate(value: unknown): value is IsoDate {
  return typeof value === 'string' && parseIsoDate(value) !== null;
}

/** Calendar-date comparison with no timezone conversion for already-valid ISO dates. */
export function compareIsoDates(left: IsoDate, right: IsoDate): number {
  return left.localeCompare(right);
}

export function isDateOnOrBefore(left: IsoDate, right: IsoDate): boolean {
  return compareIsoDates(left, right) <= 0;
}

export function isDateBefore(left: IsoDate, right: IsoDate): boolean {
  return compareIsoDates(left, right) < 0;
}

export function isExhibitionDateOrderValid(
  installStart: IsoDate,
  installEnd: IsoDate,
  startDate: IsoDate,
  endDate: IsoDate,
): boolean {
  const dates = [installStart, installEnd, startDate, endDate];
  if (!dates.every(isRealIsoDate)) {
    return false;
  }

  return installStart <= installEnd && installEnd <= startDate && startDate <= endDate;
}

/** Date ranges are inclusive at both endpoints. */
export function dateRangesOverlap(
  firstStart: IsoDate,
  firstEnd: IsoDate,
  secondStart: IsoDate,
  secondEnd: IsoDate,
): boolean {
  return firstStart <= secondEnd && secondStart <= firstEnd;
}

export function inclusiveDateOverlap(first: IsoDateRange, second: IsoDateRange): boolean {
  return dateRangesOverlap(first.startDate, first.endDate, second.startDate, second.endDate);
}

/** Trim, collapse internal whitespace, Unicode-normalize, and case-fold. */
export function normalizeSpace(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

export function isLegalExhibitionTransition(from: ExhibitionStatus, to: ExhibitionStatus): boolean {
  return isExhibitionTransitionAllowed(from, to);
}

export function allowedExhibitionTransitions(from: ExhibitionStatus): readonly ExhibitionStatus[] {
  return EXHIBITION_STATUS_TRANSITIONS[from];
}

function boundedCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * Readiness is intentionally deterministic: 50 points for any placed work,
 * 35 for task completion, and 15 for clean operations. Blocking conditions do
 * not subtract points a second time, but always force the blocked state.
 */
export function calculateReadiness(input: ReadinessInput): ReadinessResult {
  const placedArtworkCount = boundedCount(input.placedArtworkCount);
  const taskCount = boundedCount(input.taskCount);
  const completedTaskCount = Math.min(boundedCount(input.completedTaskCount), taskCount);
  const overdueTaskCount = boundedCount(input.overdueTaskCount);
  const conflictCount = boundedCount(input.conflictCount);

  const artworkComponent = placedArtworkCount > 0 ? 50 : 0;
  const taskComponent = taskCount > 0 ? (35 * completedTaskCount) / taskCount : 0;
  const operationsComponent = overdueTaskCount === 0 && conflictCount === 0 ? 15 : 0;
  const readinessPercent = Math.max(
    0,
    Math.min(100, Math.round(artworkComponent + taskComponent + operationsComponent)),
  );
  const isBlocked = overdueTaskCount > 0 || conflictCount > 0;

  return {
    readinessPercent,
    readinessState: isBlocked ? 'blocked' : readinessPercent === 100 ? 'ready' : 'attention',
  };
}

export function utcCalendarDate(now: Date): IsoDate {
  return now.toISOString().slice(0, 10);
}

export function isTaskOverdue(
  dueDate: IsoDate | null,
  status: TaskStatus,
  today: IsoDate,
): boolean {
  return status !== 'done' && dueDate !== null && isDateBefore(dueDate, today);
}

export type { ExhibitionStatus, ReadinessState };
