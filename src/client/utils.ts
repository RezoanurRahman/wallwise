import { TASK_CATEGORY_LABELS } from '../shared/constants';
import type {
  ArtistStatus,
  ArtworkStatus,
  ExhibitionStatus,
  ReadinessState,
  TaskCategory,
  TaskStatus,
} from '../shared/types';

export type StatusLabel =
  ArtistStatus | ArtworkStatus | ExhibitionStatus | TaskStatus | ReadinessState;

export interface NavigateOptions {
  replace?: boolean;
  state?: unknown;
}

const MONTH_NAMES = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const STATUS_LABELS: Readonly<Record<StatusLabel, string>> = {
  active: 'Active',
  archived: 'Archived',
  available: 'Available',
  reserved: 'Reserved',
  retired: 'Retired',
  draft: 'Draft',
  planned: 'Planned',
  installing: 'Installing',
  open: 'Open',
  closed: 'Closed',
  cancelled: 'Cancelled',
  todo: 'To do',
  in_progress: 'In progress',
  done: 'Done',
  ready: 'Ready',
  attention: 'Needs attention',
  blocked: 'Blocked',
};

const READINESS_LABELS: Readonly<Record<ReadinessState, string>> = {
  ready: 'Ready to open',
  attention: 'Needs attention',
  blocked: 'Blocked',
};

const MAX_DIMENSION_FRACTION_DIGITS = 2;

const timestampFormatter = new Intl.DateTimeFormat('en-US', {
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  month: 'short',
  timeZone: 'UTC',
  timeZoneName: 'short',
  year: 'numeric',
});

const dimensionFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: MAX_DIMENSION_FRACTION_DIGITS,
});

interface CalendarDate {
  day: number;
  month: number;
  year: number;
}

function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}

function parseCalendarDate(value: string | null | undefined): CalendarDate | null {
  if (value === null || value === undefined) {
    return null;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (match === null) {
    return null;
  }

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return null;
  }

  const year = Number.parseInt(yearText, 10);
  const month = Number.parseInt(monthText, 10);
  const day = Number.parseInt(dayText, 10);

  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
    return null;
  }

  return { year, month, day };
}

function calendarMonthLabel(calendarDate: CalendarDate): string {
  return MONTH_NAMES[calendarDate.month - 1] ?? '';
}

function formatCalendarDate(calendarDate: CalendarDate): string {
  return `${calendarMonthLabel(calendarDate)} ${calendarDate.day}, ${calendarDate.year}`;
}

/** Formats a date-only API value without passing through a timezone-sensitive Date. */
export function formatDate(value: string | null | undefined, fallback = 'Not set'): string {
  const calendarDate = parseCalendarDate(value);
  return calendarDate === null ? fallback : formatCalendarDate(calendarDate);
}

/** Formats an inclusive calendar-date range, collapsing shared months and years. */
export function formatDateRange(
  start: string | null | undefined,
  end: string | null | undefined,
  fallback = 'Dates not set',
): string {
  const startDate = parseCalendarDate(start);
  const endDate = parseCalendarDate(end);

  if (startDate === null && endDate === null) {
    return fallback;
  }

  if (startDate === null) {
    return endDate === null ? fallback : formatCalendarDate(endDate);
  }

  if (endDate === null) {
    return formatCalendarDate(startDate);
  }

  if (
    startDate.year === endDate.year &&
    startDate.month === endDate.month &&
    startDate.day === endDate.day
  ) {
    return formatCalendarDate(startDate);
  }

  if (startDate.year === endDate.year && startDate.month === endDate.month) {
    return `${calendarMonthLabel(startDate)} ${startDate.day} – ${endDate.day}, ${startDate.year}`;
  }

  if (startDate.year === endDate.year) {
    return `${calendarMonthLabel(startDate)} ${startDate.day} – ${calendarMonthLabel(endDate)} ${endDate.day}, ${startDate.year}`;
  }

  return `${formatCalendarDate(startDate)} – ${formatCalendarDate(endDate)}`;
}

/** Formats a UTC API timestamp consistently regardless of the browser's locale. */
export function formatTimestamp(
  value: string | null | undefined,
  fallback = 'Not recorded',
): string {
  if (value === null || value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const timestamp = new Date(value);
  return Number.isNaN(timestamp.getTime()) ? fallback : timestampFormatter.format(timestamp);
}

export function statusLabel(status: StatusLabel): string {
  const label: string | undefined = STATUS_LABELS[status];
  return label ?? 'Unknown status';
}

export function taskCategoryLabel(category: TaskCategory): string {
  return TASK_CATEGORY_LABELS[category];
}

export function readinessLabel(state: ReadinessState): string {
  return READINESS_LABELS[state];
}

function formatDimension(value: number): string {
  return dimensionFormatter.format(value);
}

export function formatDimensions(
  widthCm: number | null | undefined,
  heightCm: number | null | undefined,
  fallback = 'Dimensions not recorded',
): string {
  const hasWidth = widthCm !== null && widthCm !== undefined && Number.isFinite(widthCm);
  const hasHeight = heightCm !== null && heightCm !== undefined && Number.isFinite(heightCm);

  if (hasWidth && hasHeight) {
    return `${formatDimension(widthCm)} × ${formatDimension(heightCm)} cm`;
  }

  if (hasWidth) {
    return `${formatDimension(widthCm)} cm wide`;
  }

  if (hasHeight) {
    return `${formatDimension(heightCm)} cm high`;
  }

  return fallback;
}

export function escape(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      case "'":
        return '&#39;';
      default:
        return character;
    }
  });
}

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter((value): value is string => Boolean(value)).join(' ');
}

function elementForField(container: ParentNode, field: string): HTMLElement | null {
  const elements = container.querySelectorAll<HTMLElement>('[name], [id]');

  for (const element of elements) {
    if (element.getAttribute('name') === field || element.id === field) {
      return element;
    }
  }

  return null;
}

/**
 * Moves focus to a server-named field, then the first invalid control, then a form
 * error summary. The helper is safe to call after the triggering state has rendered.
 */
export function focusFirstInvalid(
  container: ParentNode | null = typeof document === 'undefined' ? null : document,
  field?: string | null,
): HTMLElement | null {
  if (container === null) {
    return null;
  }

  const namedField =
    field === null || field === undefined ? null : elementForField(container, field);
  const invalidField = container.querySelector<HTMLElement>('[aria-invalid="true"]');
  const errorSummary = container.querySelector<HTMLElement>(
    '[data-error-summary], .form-error-summary, [role="alert"]',
  );
  const target = namedField ?? invalidField ?? errorSummary;

  if (target === null) {
    return null;
  }

  if (!target.hasAttribute('tabindex') && !target.matches('input, select, textarea, button, a')) {
    target.setAttribute('tabindex', '-1');
  }

  target.focus();
  return target;
}

/** Navigates without reloading the document and notifies the App history listener. */
export function navigate(path: string, options: NavigateOptions = {}): void {
  if (typeof window === 'undefined') {
    return;
  }

  const target = new URL(path, window.location.href);
  if (target.origin !== window.location.origin) {
    window.location.assign(target.href);
    return;
  }

  const nextLocation = `${target.pathname}${target.search}${target.hash}`;
  const currentLocation = `${window.location.pathname}${window.location.search}${window.location.hash}`;

  if (nextLocation !== currentLocation) {
    const state = options.state ?? null;
    if (options.replace === true) {
      window.history.replaceState(state, '', nextLocation);
    } else {
      window.history.pushState(state, '', nextLocation);
    }
  }

  window.dispatchEvent(new PopStateEvent('popstate', { state: options.state ?? null }));
}
