import { describe, expect, it } from 'vitest';

import { EXHIBITION_STATUSES, EXHIBITION_STATUS_TRANSITIONS } from '../../src/shared/constants';
import { DomainError, toErrorResponse } from '../../src/server/domain/errors';
import type { ExhibitionStatus } from '../../src/shared/types';
import {
  calculateReadiness,
  dateRangesOverlap,
  inclusiveDateOverlap,
  isDateOnOrBefore,
  isExhibitionDateOrderValid,
  isLegalExhibitionTransition,
  isRealIsoDate,
  isTaskOverdue,
  normalizeSpace,
  parseIsoDate,
  utcCalendarDate,
} from '../../src/server/domain/rules';

describe('calendar-date rules', () => {
  it('parses real leap days and rejects impossible or malformed dates', () => {
    expect(parseIsoDate('2024-02-29')?.toISOString()).toBe('2024-02-29T00:00:00.000Z');
    expect(isRealIsoDate('2026-10-17')).toBe(true);

    for (const malformed of [
      '2025-02-29',
      '2026-02-30',
      '2026-13-01',
      '2026-00-10',
      '2026-04-31',
      '2026-4-01',
      ' 2026-04-01',
      '2026-04-01T00:00:00Z',
    ]) {
      expect(isRealIsoDate(malformed), malformed).toBe(false);
    }
  });

  it('checks the SPEC date order without timezone conversion', () => {
    const installStart = '2026-09-28';
    const installEnd = '2026-10-01';
    const startDate = '2026-10-02';
    const endDate = '2026-11-15';

    expect(isDateOnOrBefore(installStart, installEnd)).toBe(true);
    expect(isDateOnOrBefore(installEnd, startDate)).toBe(true);
    expect(isDateOnOrBefore(startDate, endDate)).toBe(true);
    expect(isDateOnOrBefore('2026-10-02', '2026-10-01')).toBe(false);
    expect(isDateOnOrBefore(installStart, endDate)).toBe(true);
    expect(isExhibitionDateOrderValid(installStart, installEnd, startDate, endDate)).toBe(true);
    expect(isExhibitionDateOrderValid(installStart, '2026-09-27', startDate, endDate)).toBe(false);
    expect(isExhibitionDateOrderValid(installStart, installEnd, '2026-12-01', endDate)).toBe(false);
    expect(isExhibitionDateOrderValid('2026-02-30', installEnd, startDate, endDate)).toBe(false);
  });

  it('treats timezones as UTC calendar days, never local clock shifts', () => {
    expect(utcCalendarDate(new Date('2026-10-17T00:00:00.000Z'))).toBe('2026-10-17');
    expect(utcCalendarDate(new Date('2026-10-17T23:59:59.999Z'))).toBe('2026-10-17');
    expect(utcCalendarDate(new Date('2026-10-18T00:00:00.000Z'))).toBe('2026-10-18');
  });
});

describe('inclusive date overlap', () => {
  it('treats shared endpoints and containment as overlaps', () => {
    expect(dateRangesOverlap('2026-10-01', '2026-10-10', '2026-10-10', '2026-10-20')).toBe(true);
    expect(dateRangesOverlap('2026-10-01', '2026-10-10', '2026-10-01', '2026-10-01')).toBe(true);
    expect(dateRangesOverlap('2026-10-01', '2026-10-20', '2026-10-05', '2026-10-07')).toBe(true);
    expect(
      inclusiveDateOverlap(
        { startDate: '2026-11-16', endDate: '2026-11-19' },
        { startDate: '2026-11-19', endDate: '2026-11-30' },
      ),
    ).toBe(true);
  });

  it('allows one-day gaps in either direction', () => {
    expect(dateRangesOverlap('2026-10-01', '2026-10-10', '2026-10-11', '2026-10-20')).toBe(false);
    expect(dateRangesOverlap('2026-10-11', '2026-10-20', '2026-10-01', '2026-10-10')).toBe(false);
  });
});

describe('space normalization', () => {
  it('trims, collapses whitespace, normalizes Unicode, and case-folds', () => {
    expect(normalizeSpace('  EAST   Gallery \t ')).toBe('east gallery');
    expect(normalizeSpace('East\nGallery')).toBe('east gallery');
    expect(normalizeSpace('  Café   Room  ')).toBe('café room');
    expect(normalizeSpace('EAST GALLERY')).toBe(normalizeSpace('east   gallery'));
  });
});

describe('exhibition lifecycle transitions', () => {
  it('accepts every legal transition from the shared map', () => {
    for (const from of EXHIBITION_STATUSES) {
      for (const to of EXHIBITION_STATUS_TRANSITIONS[from]) {
        expect(isLegalExhibitionTransition(from, to), `${from} -> ${to}`).toBe(true);
      }
    }
  });

  it('rejects same-status, backward, skipped, and terminal transitions', () => {
    for (const from of EXHIBITION_STATUSES) {
      for (const to of EXHIBITION_STATUSES) {
        const expected = (
          EXHIBITION_STATUS_TRANSITIONS[from] as readonly ExhibitionStatus[]
        ).includes(to);
        expect(isLegalExhibitionTransition(from, to), `${from} -> ${to}`).toBe(expected);
      }
    }

    expect(isLegalExhibitionTransition('draft', 'draft')).toBe(false);
    expect(isLegalExhibitionTransition('planned', 'draft')).toBe(false);
    expect(isLegalExhibitionTransition('draft', 'open')).toBe(false);
    expect(isLegalExhibitionTransition('closed', 'cancelled')).toBe(false);
    expect(isLegalExhibitionTransition('cancelled', 'draft')).toBe(false);
  });
});

describe('overdue calendar rule', () => {
  it('requires a past due date and a non-done status', () => {
    const today = '2026-10-17';
    expect(isTaskOverdue('2026-10-16', 'todo', today)).toBe(true);
    expect(isTaskOverdue('2026-10-17', 'todo', today)).toBe(false);
    expect(isTaskOverdue('2026-10-16', 'done', today)).toBe(false);
    expect(isTaskOverdue(null, 'in_progress', today)).toBe(false);
  });
});

describe('deterministic readiness', () => {
  it('scores empty shows from operations only', () => {
    expect(
      calculateReadiness({
        artworkCount: 0,
        placedArtworkCount: 0,
        taskCount: 0,
        completedTaskCount: 0,
        overdueTaskCount: 0,
        conflictCount: 0,
      }),
    ).toEqual({ readinessPercent: 15, readinessState: 'attention' });
  });

  it('scores artwork and clean operations when there are no tasks', () => {
    expect(
      calculateReadiness({
        artworkCount: 1,
        placedArtworkCount: 1,
        taskCount: 0,
        completedTaskCount: 0,
        overdueTaskCount: 0,
        conflictCount: 0,
      }),
    ).toEqual({ readinessPercent: 65, readinessState: 'attention' });
  });

  it('scores completed tasks and operations without placed artwork', () => {
    expect(
      calculateReadiness({
        artworkCount: 0,
        placedArtworkCount: 0,
        taskCount: 2,
        completedTaskCount: 2,
        overdueTaskCount: 0,
        conflictCount: 0,
      }),
    ).toEqual({ readinessPercent: 50, readinessState: 'attention' });
  });

  it('reaches ready only with placed work, all tasks done, and clean operations', () => {
    expect(
      calculateReadiness({
        artworkCount: 3,
        placedArtworkCount: 3,
        taskCount: 3,
        completedTaskCount: 3,
        overdueTaskCount: 0,
        conflictCount: 0,
      }),
    ).toEqual({ readinessPercent: 100, readinessState: 'ready' });
  });

  it('blocks overdue work and removes the operations component', () => {
    expect(
      calculateReadiness({
        artworkCount: 1,
        placedArtworkCount: 1,
        taskCount: 2,
        completedTaskCount: 1,
        overdueTaskCount: 1,
        conflictCount: 0,
      }),
    ).toEqual({ readinessPercent: 68, readinessState: 'blocked' });
  });

  it('blocks conflicts even when all planned work is complete', () => {
    expect(
      calculateReadiness({
        artworkCount: 1,
        placedArtworkCount: 1,
        taskCount: 2,
        completedTaskCount: 2,
        overdueTaskCount: 0,
        conflictCount: 1,
      }),
    ).toEqual({ readinessPercent: 85, readinessState: 'blocked' });
  });

  it('clamps malformed counts and never exceeds 100', () => {
    expect(
      calculateReadiness({
        artworkCount: 2,
        placedArtworkCount: 2,
        taskCount: 1,
        completedTaskCount: 99,
        overdueTaskCount: -1,
        conflictCount: 0,
      }),
    ).toEqual({ readinessPercent: 100, readinessState: 'ready' });
  });
});

describe('safe domain errors', () => {
  it('serializes structured field errors without losing conflict detail', () => {
    const error = new DomainError(422, 'RULE_VIOLATION', 'Retired artwork cannot be placed.', {
      field: 'artworkId',
      details: { artworkId: 'artwork-quiet-field' },
    });

    expect(error.toErrorResponse()).toEqual({
      error: {
        code: 'RULE_VIOLATION',
        message: 'Retired artwork cannot be placed.',
        field: 'artworkId',
        details: { artworkId: 'artwork-quiet-field' },
      },
    });
  });

  it('hides unexpected SQL messages and stack details behind INTERNAL_ERROR', () => {
    const response = toErrorResponse(new Error('SQLITE_BUSY: SELECT * FROM secret_table'));

    expect(response.error.code).toBe('INTERNAL_ERROR');
    expect(response.error.message).toBe(
      'The request could not be completed due to an internal error.',
    );
    expect(JSON.stringify(response)).not.toContain('secret_table');
    expect(JSON.stringify(response)).not.toContain('SQLITE_BUSY');
  });
});
