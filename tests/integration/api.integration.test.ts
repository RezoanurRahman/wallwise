import { afterEach, describe, expect, it } from 'vitest';

import type {
  ActivityEntry,
  ActivityListResponse,
  ArtistListResponse,
  ArtistMutationResponse,
  ArtworkListResponse,
  ArtworkMutationResponse,
  ConflictErrorDetails,
  DashboardResponse,
  DeleteResponse,
  ErrorResponse,
  ExhibitionDetailResponse,
  ExhibitionListResponse,
  ExhibitionMutationResponse,
  ExhibitionStatus,
  HealthResponse,
  PlacementMutationResponse,
  TaskListResponse,
  TaskMutationResponse,
} from '../../src/shared/types';
import {
  FROZEN_NOW,
  cleanupAllRuntimes,
  freshPath,
  makeRuntime,
  requestJson,
  requestText,
} from './test-helpers';
import type { JsonResult, TestRuntime, TextResult } from './test-helpers';

const FROZEN_TIMESTAMP = FROZEN_NOW.toISOString();

afterEach(() => {
  cleanupAllRuntimes();
});

interface ResponseWithText {
  response: Response;
  text: string;
}

function expectNoInternalLeak(result: ResponseWithText): void {
  expect(result.response.headers.get('content-type') ?? '').toContain('application/json');
  expect(result.text).not.toMatch(
    /<html|<!doctype|sqlite_|node_modules|\/src\/|stack trace|\n\s+at\s+/iu,
  );
}

function expectApiError(
  result: ResponseWithText & { body: ErrorResponse },
  status: number,
  error: ErrorResponse['error'],
): void {
  expect(result.response.status).toBe(status);
  expect(result.body).toEqual({ error });
  expectNoInternalLeak(result);
}

function requireActivity(body: { activity?: ActivityEntry }, label: string): ActivityEntry {
  if (!body.activity) {
    throw new Error(`Expected ${label} to return an activity entry.`);
  }
  return body.activity;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) {
      continue;
    }

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += character;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  return rows;
}

async function getExhibitionList(runtime: TestRuntime): Promise<ExhibitionListResponse> {
  const result = await requestJson<ExhibitionListResponse>(
    runtime,
    '/api/exhibitions?pageSize=100&sort=startDate&direction=asc',
  );
  expect(result.response.status).toBe(200);
  return result.body;
}

describe('seed dashboard, health, and CSV export', () => {
  it('returns the deterministic health response and seeded dashboard aggregates', async () => {
    const runtime = makeRuntime(freshPath('seed-dashboard'));

    const health = await requestJson<HealthResponse>(runtime, '/api/health');
    expect(health.response.status).toBe(200);
    expect(health.response.headers.get('content-type')).toContain('application/json');
    expect(health.body).toEqual({
      status: 'ok',
      database: 'up',
      seedVersion: 1,
      timestamp: FROZEN_TIMESTAMP,
    });

    const dashboard = await requestJson<DashboardResponse>(runtime, '/api/dashboard');
    expect(dashboard.response.status).toBe(200);
    expect(dashboard.body.data.totals).toEqual({
      artists: 4,
      activeArtists: 3,
      artworks: 7,
      availableArtworks: 5,
      exhibitions: 4,
      scheduledExhibitions: 3,
      placements: 6,
      openTasks: 5,
    });
    expect(dashboard.body.data.statusCounts).toEqual({
      artists: { active: 3, archived: 1 },
      artworks: { available: 5, reserved: 1, retired: 1 },
      exhibitions: { draft: 1, planned: 1, installing: 0, open: 1, closed: 1, cancelled: 0 },
      tasks: { todo: 4, in_progress: 1, done: 2 },
    });
    expect(dashboard.body.data.upcomingExhibitions).toEqual([
      {
        id: 'exh-still-moving',
        title: 'STILL / MOVING',
        space: 'East Gallery',
        startDate: '2026-10-02',
        endDate: '2026-11-15',
        installStart: '2026-09-28',
        installEnd: '2026-10-01',
        status: 'open',
        readinessPercent: 62,
        readinessState: 'blocked',
        conflictCount: 0,
      },
      {
        id: 'exh-tidal-memory',
        title: 'Tidal Memory',
        space: 'Project Room',
        startDate: '2026-11-20',
        endDate: '2027-01-10',
        installStart: '2026-11-16',
        installEnd: '2026-11-19',
        status: 'planned',
        readinessPercent: 65,
        readinessState: 'attention',
        conflictCount: 0,
      },
      {
        id: 'exh-night-index',
        title: 'Night Index',
        space: 'East Gallery',
        startDate: '2027-02-01',
        endDate: '2027-03-15',
        installStart: '2027-01-27',
        installEnd: '2027-01-31',
        status: 'draft',
        readinessPercent: 65,
        readinessState: 'attention',
        conflictCount: 0,
      },
    ]);
    expect(dashboard.body.data.readinessRows).toEqual([
      {
        exhibitionId: 'exh-still-moving',
        title: 'STILL / MOVING',
        space: 'East Gallery',
        status: 'open',
        startDate: '2026-10-02',
        endDate: '2026-11-15',
        artworkCount: 3,
        placedArtworkCount: 3,
        taskCount: 3,
        completedTaskCount: 1,
        openTaskCount: 2,
        overdueTaskCount: 1,
        conflictCount: 0,
        readinessPercent: 62,
        readinessState: 'blocked',
      },
      {
        exhibitionId: 'exh-tidal-memory',
        title: 'Tidal Memory',
        space: 'Project Room',
        status: 'planned',
        startDate: '2026-11-20',
        endDate: '2027-01-10',
        artworkCount: 1,
        placedArtworkCount: 1,
        taskCount: 2,
        completedTaskCount: 0,
        openTaskCount: 2,
        overdueTaskCount: 0,
        conflictCount: 0,
        readinessPercent: 65,
        readinessState: 'attention',
      },
      {
        exhibitionId: 'exh-night-index',
        title: 'Night Index',
        space: 'East Gallery',
        status: 'draft',
        startDate: '2027-02-01',
        endDate: '2027-03-15',
        artworkCount: 1,
        placedArtworkCount: 1,
        taskCount: 1,
        completedTaskCount: 0,
        openTaskCount: 1,
        overdueTaskCount: 0,
        conflictCount: 0,
        readinessPercent: 65,
        readinessState: 'attention',
      },
    ]);
    expect(dashboard.body.data.overdueTaskCount).toBe(1);
    expect(dashboard.body.data.conflictWarningCount).toBe(0);
    expect(dashboard.body.data.generatedAt).toBe(FROZEN_TIMESTAMP);
    expect(dashboard.body.data.recentActivity).toEqual([
      {
        id: 'activity-seed-title-vinyl',
        entityType: 'task',
        entityId: 'task-still-title-vinyl',
        action: 'updated',
        detail: 'Updated the Print title vinyl assignee and due date.',
        createdAt: '2026-10-16T09:10:00.000Z',
      },
      {
        id: 'activity-seed-still-note',
        entityType: 'exhibition',
        entityId: 'exh-still-moving',
        action: 'updated',
        detail: 'Updated STILL / MOVING opening notes.',
        createdAt: '2026-10-14T16:40:00.000Z',
      },
      {
        id: 'activity-seed-focus-lights',
        entityType: 'task',
        entityId: 'task-still-focus-lights',
        action: 'status_changed',
        detail: 'Status changed from todo to in_progress for Focus track lights.',
        createdAt: '2026-10-10T10:20:00.000Z',
      },
      {
        id: 'activity-seed-still-open',
        entityType: 'exhibition',
        entityId: 'exh-still-moving',
        action: 'status_changed',
        detail: 'Status changed from installing to open. Opening preview completed.',
        createdAt: '2026-10-02T08:30:00.000Z',
      },
      {
        id: 'activity-seed-placement-orbit',
        entityType: 'placement',
        entityId: 'placement-still-paper-orbit',
        action: 'updated',
        detail: 'Updated Paper Orbit placement notes for STILL / MOVING.',
        createdAt: '2026-10-01T11:15:00.000Z',
      },
      {
        id: 'activity-seed-placement-soft',
        entityType: 'placement',
        entityId: 'placement-still-soft-geometry',
        action: 'seeded',
        detail: 'Placed Soft Geometry on Wall A at position 1 for STILL / MOVING.',
        createdAt: '2026-09-30T10:00:00.000Z',
      },
      {
        id: 'activity-seed-exhibitions-created',
        entityType: 'exhibition',
        entityId: 'exh-still-moving',
        action: 'seeded',
        detail: 'Seeded four exhibitions across three gallery spaces.',
        createdAt: '2026-09-15T08:03:00.000Z',
      },
      {
        id: 'activity-seed-artworks-created',
        entityType: 'artwork',
        entityId: 'artwork-tidal-memory',
        action: 'seeded',
        detail: 'Seeded seven artworks, including Tidal Memory.',
        createdAt: '2026-09-15T08:02:00.000Z',
      },
      {
        id: 'activity-seed-artists-created',
        entityType: 'artist',
        entityId: 'artist-mira-hale',
        action: 'seeded',
        detail: 'Seeded artist Mira Hale and the founding artist roster.',
        createdAt: '2026-09-15T08:01:00.000Z',
      },
    ]);
  });

  it('exports every exhibition in stable order with RFC-style CSV quoting', async () => {
    const runtime = makeRuntime(freshPath('csv-export'));
    const specialTitle = 'CSV, "Quoted"\nLine';
    const specialSubtitle = 'Subtitle, "second"\nline';
    const specialNotes = 'Notes, with "quotes" and\nnewline';

    const created = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: specialTitle,
        subtitle: specialSubtitle,
        space: 'CSV Room',
        startDate: '2026-12-01',
        endDate: '2026-12-20',
        installStart: '2026-11-25',
        installEnd: '2026-11-30',
        notes: specialNotes,
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.body.data.status).toBe('draft');

    const exported: TextResult = await requestText(runtime, '/api/export/exhibitions.csv');
    expect(exported.response.status).toBe(200);
    expect(exported.response.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(exported.response.headers.get('content-disposition')).toBe(
      'attachment; filename="wallwise-exhibitions.csv"',
    );

    const rows = parseCsv(exported.text);
    const header = rows[0];
    expect(header).toEqual([
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
    ]);
    expect(rows).toHaveLength(6);
    expect(rows.every((row) => row.length === 18)).toBe(true);

    const dataRows = rows.slice(1);
    expect(dataRows.map((row) => row[0])).toEqual([
      'exh-spring-register',
      'exh-still-moving',
      'exh-tidal-memory',
      created.body.data.id,
      'exh-night-index',
    ]);
    expect(exported.text).toContain('"CSV, ""Quoted""\nLine"');
    expect(exported.text).toContain('"Subtitle, ""second""\nline"');

    const createdCells = dataRows.find((row) => row[0] === created.body.data.id);
    expect(createdCells).toBeDefined();
    if (!header || !createdCells) {
      throw new Error('Expected the exported header and created exhibition row.');
    }
    const createdRow = Object.fromEntries(
      header.map((column, index) => [column, createdCells[index] ?? '']),
    );
    expect(createdRow).toMatchObject({
      exhibitionId: created.body.data.id,
      title: specialTitle,
      subtitle: specialSubtitle,
      status: 'draft',
      space: 'csv room',
      startDate: '2026-12-01',
      endDate: '2026-12-20',
      installStart: '2026-11-25',
      installEnd: '2026-11-30',
      curator: '',
      artworkCount: '0',
      placedArtworkCount: '0',
      taskCount: '0',
      completedTaskCount: '0',
      openTaskCount: '0',
      readinessPercent: '15',
      conflictCount: '0',
      updatedAt: FROZEN_TIMESTAMP,
    });
  });
});

describe('SQLite persistence and seed idempotence', () => {
  it('preserves user records and activity across reopen without duplicating seeds', async () => {
    const databasePath = freshPath('persistence');
    const firstRuntime = makeRuntime(databasePath);

    const artistCreated = await requestJson<ArtistMutationResponse>(firstRuntime, '/api/artists', {
      method: 'POST',
      json: {
        name: 'Persistence Artist',
        email: 'persistence@example.test',
        bio: 'Survives a durable reopen.',
      },
    });
    expect(artistCreated.response.status).toBe(201);
    const artistActivity = requireActivity(artistCreated.body, 'artist creation');

    const artworkCreated = await requestJson<ArtworkMutationResponse>(
      firstRuntime,
      '/api/artworks',
      {
        method: 'POST',
        json: {
          artistId: artistCreated.body.data.id,
          title: 'Persistence Work',
          medium: 'Archival ink on paper',
          year: 2026,
          widthCm: 42.5,
          heightCm: 31,
          framed: true,
        },
      },
    );
    expect(artworkCreated.response.status).toBe(201);
    const artworkActivity = requireActivity(artworkCreated.body, 'artwork creation');

    firstRuntime.close();

    const reopened = makeRuntime(databasePath);
    const health = await requestJson<HealthResponse>(reopened, '/api/health');
    expect(health.body.seedVersion).toBe(1);

    const artist = await requestJson<{ data: unknown }>(
      reopened,
      `/api/artists/${artistCreated.body.data.id}`,
    );
    expect(artist.response.status).toBe(200);
    expect(artist.body).toEqual({
      data: {
        id: artistCreated.body.data.id,
        name: 'Persistence Artist',
        email: 'persistence@example.test',
        bio: 'Survives a durable reopen.',
        status: 'active',
        createdAt: FROZEN_TIMESTAMP,
        updatedAt: FROZEN_TIMESTAMP,
      },
    });

    const artwork = await requestJson<{ data: unknown }>(
      reopened,
      `/api/artworks/${artworkCreated.body.data.id}`,
    );
    expect(artwork.body).toEqual({
      data: {
        id: artworkCreated.body.data.id,
        artistId: artistCreated.body.data.id,
        title: 'Persistence Work',
        medium: 'Archival ink on paper',
        year: 2026,
        widthCm: 42.5,
        heightCm: 31,
        framed: true,
        status: 'available',
        artist: {
          id: artistCreated.body.data.id,
          name: 'Persistence Artist',
          status: 'active',
        },
        createdAt: FROZEN_TIMESTAMP,
        updatedAt: FROZEN_TIMESTAMP,
      },
    });

    const artistActivities = await requestJson<ActivityListResponse>(
      reopened,
      `/api/activity?entityType=artist&entityId=${artistCreated.body.data.id}&pageSize=100`,
    );
    expect(artistActivities.body).toEqual({
      data: [artistActivity],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });

    const artworkActivities = await requestJson<ActivityListResponse>(
      reopened,
      `/api/activity?entityType=artwork&entityId=${artworkCreated.body.data.id}&pageSize=100`,
    );
    expect(artworkActivities.body).toEqual({
      data: [artworkActivity],
      pagination: { page: 1, pageSize: 100, total: 1, totalPages: 1 },
    });

    const artists = await requestJson<ArtistListResponse>(reopened, '/api/artists?pageSize=100');
    const artworks = await requestJson<ArtworkListResponse>(reopened, '/api/artworks?pageSize=100');
    const exhibitions = await getExhibitionList(reopened);
    const dashboard = await requestJson<DashboardResponse>(reopened, '/api/dashboard');
    const activity = await requestJson<ActivityListResponse>(
      reopened,
      '/api/activity?pageSize=100',
    );

    expect(artists.body.pagination.total).toBe(5);
    expect(artists.body.data.filter((item) => item.id === 'artist-mira-hale')).toHaveLength(1);
    expect(artworks.body.pagination.total).toBe(8);
    expect(artworks.body.data.filter((item) => item.id === 'artwork-tidal-memory')).toHaveLength(1);
    expect(exhibitions.pagination.total).toBe(4);
    expect(dashboard.body.data.statusCounts.exhibitions).toEqual({
      draft: 1,
      planned: 1,
      installing: 0,
      open: 1,
      closed: 1,
      cancelled: 0,
    });
    expect(dashboard.body.data.totals).toMatchObject({
      artists: 5,
      artworks: 8,
      exhibitions: 4,
      placements: 6,
      openTasks: 5,
    });
    expect(activity.body.pagination.total).toBe(11);
  });
});

describe('strict validation and failure envelopes', () => {
  it('rejects invalid writes and queries with exact JSON errors and no side effects', async () => {
    const runtime = makeRuntime(freshPath('validation'));
    const initialArtists = await requestJson<ArtistListResponse>(
      runtime,
      '/api/artists?pageSize=100',
    );
    const initialArtworks = await requestJson<ArtworkListResponse>(
      runtime,
      '/api/artworks?pageSize=100',
    );
    const initialExhibitions = await getExhibitionList(runtime);
    const initialActivity = await requestJson<ActivityListResponse>(
      runtime,
      '/api/activity?pageSize=1',
    );
    const artistBefore = await requestJson<{ data: unknown }>(
      runtime,
      '/api/artists/artist-mira-hale',
    );

    const unknownBody = await requestJson<ErrorResponse>(runtime, '/api/artists', {
      method: 'POST',
      json: { name: 'Unknown Field Artist', email: 'unknown@example.test', surprise: true },
    });
    expectApiError(unknownBody, 400, {
      code: 'VALIDATION_ERROR',
      message: 'Unknown field "surprise".',
      field: 'surprise',
      details: { issues: [{ field: 'surprise', message: 'Unknown field "surprise".' }] },
    });

    const malformedJson = await requestJson<ErrorResponse>(runtime, '/api/artists', {
      method: 'POST',
      rawBody: '{',
      headers: { 'content-type': 'application/json' },
    });
    expectApiError(malformedJson, 400, {
      code: 'VALIDATION_ERROR',
      message: 'Request body must be valid JSON.',
    });

    const invalidDate = await requestJson<ErrorResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Impossible Date',
        space: 'Validation Room',
        startDate: '2026-02-30',
        endDate: '2026-03-05',
        installStart: '2026-02-20',
        installEnd: '2026-02-25',
      },
    });
    expectApiError(invalidDate, 400, {
      code: 'VALIDATION_ERROR',
      message: 'startDate must be a real date in YYYY-MM-DD format.',
      field: 'startDate',
    });

    const invalidNumber = await requestJson<ErrorResponse>(runtime, '/api/artworks', {
      method: 'POST',
      json: {
        artistId: 'artist-mira-hale',
        title: 'Negative Width',
        medium: 'Test medium',
        widthCm: -1,
      },
    });
    expectApiError(invalidNumber, 400, {
      code: 'VALIDATION_ERROR',
      message: 'widthCm must be greater than 0 and at most 10000.',
      field: 'widthCm',
      details: {
        issues: [
          {
            field: 'widthCm',
            message: 'widthCm must be greater than 0 and at most 10000.',
          },
        ],
      },
    });

    const emptyPatch = await requestJson<ErrorResponse>(runtime, '/api/artists/artist-mira-hale', {
      method: 'PATCH',
      json: {},
    });
    expectApiError(emptyPatch, 400, {
      code: 'VALIDATION_ERROR',
      message: 'At least one field is required.',
      field: 'body',
      details: { issues: [{ field: 'body', message: 'At least one field is required.' }] },
    });

    const invalidQuery = await requestJson<ErrorResponse>(runtime, '/api/artists?page=0');
    expectApiError(invalidQuery, 400, {
      code: 'VALIDATION_ERROR',
      message: 'page must be a positive integer.',
      field: 'page',
      details: { issues: [{ field: 'page', message: 'page must be a positive integer.' }] },
    });

    const unknownQuery = await requestJson<ErrorResponse>(runtime, '/api/artworks?bogus=1');
    expectApiError(unknownQuery, 400, {
      code: 'VALIDATION_ERROR',
      message: 'Unknown query parameter "bogus".',
      field: 'bogus',
      details: {
        issues: [{ field: 'bogus', message: 'Unknown query parameter "bogus".' }],
      },
    });

    const invalidReference = await requestJson<ErrorResponse>(runtime, '/api/artworks', {
      method: 'POST',
      json: {
        artistId: 'artist-does-not-exist',
        title: 'Orphaned Artwork',
        medium: 'Test medium',
      },
    });
    expectApiError(invalidReference, 404, {
      code: 'NOT_FOUND',
      message: 'Artist not found.',
      field: 'artistId',
    });

    const missingRoute = await requestJson<ErrorResponse>(runtime, '/api/not-a-route');
    expectApiError(missingRoute, 404, {
      code: 'NOT_FOUND',
      message: 'Route not found.',
    });

    const artistAfter = await requestJson<{ data: unknown }>(
      runtime,
      '/api/artists/artist-mira-hale',
    );
    expect(artistAfter.body).toEqual(artistBefore.body);
    const finalArtists = await requestJson<ArtistListResponse>(
      runtime,
      '/api/artists?pageSize=100',
    );
    const finalArtworks = await requestJson<ArtworkListResponse>(
      runtime,
      '/api/artworks?pageSize=100',
    );
    const finalExhibitions = await getExhibitionList(runtime);
    const finalActivity = await requestJson<ActivityListResponse>(
      runtime,
      '/api/activity?pageSize=1',
    );
    expect(finalArtists.body.pagination).toEqual(initialArtists.body.pagination);
    expect(finalArtworks.body.pagination).toEqual(initialArtworks.body.pagination);
    expect(finalExhibitions.pagination).toEqual(initialExhibitions.pagination);
    expect(finalActivity.body.pagination).toEqual(initialActivity.body.pagination);
  });

  it('rejects a case-insensitive duplicate artist email without an artist or activity write', async () => {
    const runtime = makeRuntime(freshPath('duplicate-email'));
    const artistsBefore = await requestJson<ArtistListResponse>(
      runtime,
      '/api/artists?pageSize=100',
    );
    const artistActivityBefore = await requestJson<ActivityListResponse>(
      runtime,
      '/api/activity?entityType=artist&pageSize=100',
    );

    const duplicate = await requestJson<ErrorResponse>(runtime, '/api/artists', {
      method: 'POST',
      json: { name: 'Duplicate Mira', email: 'MIRA@MIRAHALE.EXAMPLE' },
    });
    expectApiError(duplicate, 400, {
      code: 'VALIDATION_ERROR',
      message: 'email is already in use by another artist.',
      field: 'email',
    });

    const artistsAfter = await requestJson<ArtistListResponse>(
      runtime,
      '/api/artists?pageSize=100',
    );
    const artistActivityAfter = await requestJson<ActivityListResponse>(
      runtime,
      '/api/activity?entityType=artist&pageSize=100',
    );
    expect(artistsAfter.body).toEqual(artistsBefore.body);
    expect(artistActivityAfter.body).toEqual(artistActivityBefore.body);
  });
});

describe('exhibition scheduling conflicts', () => {
  it('rejects inclusive exhibition and installation-window overlaps in a normalized space', async () => {
    const runtime = makeRuntime(freshPath('schedule-conflicts'));
    const base = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Annex Baseline',
        space: 'South Annex',
        startDate: '2026-11-06',
        endDate: '2026-11-30',
        installStart: '2026-11-01',
        installEnd: '2026-11-05',
      },
    });
    expect(base.response.status).toBe(201);
    expect(base.body.data).toMatchObject({
      title: 'Annex Baseline',
      space: 'south annex',
      status: 'draft',
    });

    const listAfterBase = await getExhibitionList(runtime);
    const activityAfterBase = await requestJson<ActivityListResponse>(
      runtime,
      '/api/activity?entityType=exhibition&pageSize=100',
    );

    const exhibitionOverlap = await requestJson<ErrorResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Endpoint Overlap',
        space: '  SOUTH   ANNEX ',
        startDate: '2026-11-30',
        endDate: '2026-12-15',
        installStart: '2026-11-26',
        installEnd: '2026-11-29',
      },
    });
    expect(exhibitionOverlap.response.status).toBe(409);
    expect(exhibitionOverlap.body.error).toMatchObject({
      code: 'SCHEDULE_CONFLICT',
      message: 'The exhibition schedule conflicts with another show in this space.',
      details: {
        conflicts: [
          {
            type: 'exhibition_space',
            message:
              'south annex is already booked for Annex Baseline on overlapping exhibition dates.',
            exhibitionTitle: 'Endpoint Overlap',
            relatedExhibitionId: base.body.data.id,
            relatedExhibitionTitle: 'Annex Baseline',
          },
        ],
      },
    });
    expectNoInternalLeak(exhibitionOverlap);
    const exhibitionConflictDetails = exhibitionOverlap.body.error.details as ConflictErrorDetails;
    expect(exhibitionConflictDetails.conflicts).toHaveLength(1);
    expect(exhibitionConflictDetails.conflicts[0]?.exhibitionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(await getExhibitionList(runtime)).toEqual(listAfterBase);

    const installationOverlap = await requestJson<ErrorResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Installation Endpoint Overlap',
        space: 'south annex',
        startDate: '2026-12-20',
        endDate: '2026-12-30',
        installStart: '2026-11-05',
        installEnd: '2026-11-10',
      },
    });
    expect(installationOverlap.response.status).toBe(409);
    expect(installationOverlap.body.error).toMatchObject({
      code: 'SCHEDULE_CONFLICT',
      message: 'The exhibition schedule conflicts with another show in this space.',
      details: {
        conflicts: [
          {
            type: 'installation_space',
            message: 'The installation window in south annex overlaps Annex Baseline.',
            exhibitionTitle: 'Installation Endpoint Overlap',
            relatedExhibitionId: base.body.data.id,
            relatedExhibitionTitle: 'Annex Baseline',
          },
        ],
      },
    });
    expectNoInternalLeak(installationOverlap);
    expect(await getExhibitionList(runtime)).toEqual(listAfterBase);
    const activityAfterFailures = await requestJson<ActivityListResponse>(
      runtime,
      '/api/activity?entityType=exhibition&pageSize=100',
    );
    expect(activityAfterFailures.body).toEqual(activityAfterBase.body);
  });

  it('rejects a conflicting update and leaves the prior exhibition and activity unchanged', async () => {
    const runtime = makeRuntime(freshPath('schedule-update-conflict'));
    const base = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Annex Baseline',
        space: 'south annex',
        startDate: '2026-11-06',
        endDate: '2026-11-30',
        installStart: '2026-11-01',
        installEnd: '2026-11-05',
      },
    });
    expect(base.response.status).toBe(201);

    const mobile = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Mobile Show',
        space: 'North Annex',
        startDate: '2026-11-15',
        endDate: '2026-11-25',
        installStart: '2026-11-10',
        installEnd: '2026-11-14',
      },
    });
    expect(mobile.response.status).toBe(201);

    const detailBefore = await requestJson<ExhibitionDetailResponse>(
      runtime,
      `/api/exhibitions/${mobile.body.data.id}`,
    );
    const listBefore = await getExhibitionList(runtime);
    const mobileActivityBefore = await requestJson<ActivityListResponse>(
      runtime,
      `/api/activity?entityType=exhibition&entityId=${mobile.body.data.id}&pageSize=100`,
    );

    const rejectedUpdate = await requestJson<ErrorResponse>(
      runtime,
      `/api/exhibitions/${mobile.body.data.id}`,
      { method: 'PATCH', json: { space: ' south   annex ' } },
    );
    expectApiError(rejectedUpdate, 409, {
      code: 'SCHEDULE_CONFLICT',
      message: 'The exhibition schedule conflicts with another show in this space.',
      details: {
        conflicts: [
          {
            type: 'exhibition_space',
            message:
              'south annex is already booked for Annex Baseline on overlapping exhibition dates.',
            exhibitionId: mobile.body.data.id,
            exhibitionTitle: 'Mobile Show',
            relatedExhibitionId: base.body.data.id,
            relatedExhibitionTitle: 'Annex Baseline',
          },
        ],
      },
    });

    const detailAfter = await requestJson<ExhibitionDetailResponse>(
      runtime,
      `/api/exhibitions/${mobile.body.data.id}`,
    );
    const listAfter = await getExhibitionList(runtime);
    const mobileActivityAfter = await requestJson<ActivityListResponse>(
      runtime,
      `/api/activity?entityType=exhibition&entityId=${mobile.body.data.id}&pageSize=100`,
    );
    expect(detailAfter.body).toEqual(detailBefore.body);
    expect(listAfter).toEqual(listBefore);
    expect(mobileActivityAfter.body).toEqual(mobileActivityBefore.body);
    expect(mobileActivityBefore.body.pagination.total).toBe(1);
  });
});

describe('placement occupancy, rollback, and audit retention', () => {
  it('enforces same-show slots, cross-show artwork windows, and retired-work rules', async () => {
    const runtime = makeRuntime(freshPath('placement-rules'));

    const current = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Placement Current',
        space: 'Placement Current Room',
        startDate: '2026-10-01',
        endDate: '2026-11-30',
        installStart: '2026-09-25',
        installEnd: '2026-09-30',
      },
    });
    const futureA = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Future Placement A',
        space: 'Placement Future Hall',
        startDate: '2027-05-01',
        endDate: '2027-05-31',
        installStart: '2027-04-25',
        installEnd: '2027-04-30',
      },
    });
    const futureB = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Future Placement B',
        space: '  placement   future hall ',
        startDate: '2027-09-01',
        endDate: '2027-09-30',
        installStart: '2027-08-25',
        installEnd: '2027-08-31',
      },
    });
    const overlapping = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Future Placement C',
        space: 'Placement Overlap Room',
        startDate: '2027-05-10',
        endDate: '2027-05-25',
        installStart: '2027-05-06',
        installEnd: '2027-05-09',
      },
    });
    expect(current.response.status).toBe(201);
    expect(futureA.response.status).toBe(201);
    expect(futureB.response.status).toBe(201);
    expect(overlapping.response.status).toBe(201);

    function place<T = PlacementMutationResponse>(
      exhibitionId: string,
      input: {
        artworkId: string;
        wall: string;
        position: number;
        label?: string | null;
        notes?: string | null;
      },
    ): Promise<JsonResult<T>> {
      return requestJson<T>(runtime, `/api/exhibitions/${exhibitionId}/placements`, {
        method: 'POST',
        json: input,
      });
    }

    const currentPlacement = await place(current.body.data.id, {
      artworkId: 'artwork-archive-study',
      wall: 'Wall Z',
      position: 4,
      label: 'Archive Study',
    });
    const futureAPlacement = await place(futureA.body.data.id, {
      artworkId: 'artwork-archive-study',
      wall: 'North Wall',
      position: 1,
    });
    const futureBPlacement = await place(futureB.body.data.id, {
      artworkId: 'artwork-archive-study',
      wall: 'North Wall',
      position: 1,
    });
    expect(currentPlacement.response.status).toBe(201);
    expect(futureAPlacement.response.status).toBe(201);
    expect(futureBPlacement.response.status).toBe(201);
    expect(currentPlacement.body.data.artwork).toMatchObject({
      id: 'artwork-archive-study',
      title: 'Archive Study',
      status: 'available',
      artist: { id: 'artist-elena-voss', name: 'Elena Voss', status: 'archived' },
    });
    const currentActivity = requireActivity(currentPlacement.body, 'current placement');

    const currentDetailBefore = await requestJson<ExhibitionDetailResponse>(
      runtime,
      `/api/exhibitions/${current.body.data.id}`,
    );
    const overlappingDetailBefore = await requestJson<ExhibitionDetailResponse>(
      runtime,
      `/api/exhibitions/${overlapping.body.data.id}`,
    );
    const placementActivityBefore = await requestJson<ActivityListResponse>(
      runtime,
      '/api/activity?entityType=placement&pageSize=100',
    );

    const duplicateSlot = await place<ErrorResponse>(current.body.data.id, {
      artworkId: 'artwork-tidal-memory',
      wall: 'wall z',
      position: 4,
    });
    expectApiError(duplicateSlot, 409, {
      code: 'PLACEMENT_CONFLICT',
      message: 'This wall position is already occupied in the exhibition.',
      details: {
        reason: 'duplicate_slot',
        existingPlacementId: currentPlacement.body.data.id,
      },
    });

    const duplicateArtwork = await place<ErrorResponse>(current.body.data.id, {
      artworkId: 'artwork-archive-study',
      wall: 'Wall Y',
      position: 2,
    });
    expectApiError(duplicateArtwork, 409, {
      code: 'PLACEMENT_CONFLICT',
      message: 'This artwork is already placed in this exhibition.',
      details: {
        reason: 'duplicate_artwork',
        existingPlacementId: currentPlacement.body.data.id,
      },
    });

    const crossShowAssignment = await place<ErrorResponse>(overlapping.body.data.id, {
      artworkId: 'artwork-archive-study',
      wall: 'East Wall',
      position: 1,
    });
    expectApiError(crossShowAssignment, 409, {
      code: 'ARTWORK_ASSIGNMENT_CONFLICT',
      message: 'The artwork is already assigned during this exhibition window.',
      details: {
        conflicts: [
          {
            type: 'artwork_double_booking',
            message:
              'Archive Study is already assigned to Future Placement A during this exhibition window.',
            exhibitionId: overlapping.body.data.id,
            exhibitionTitle: 'Future Placement C',
            relatedExhibitionId: futureA.body.data.id,
            relatedExhibitionTitle: 'Future Placement A',
            artworkId: 'artwork-archive-study',
            artworkTitle: 'Archive Study',
          },
        ],
      },
    });

    const retiredArtwork = await place<ErrorResponse>(current.body.data.id, {
      artworkId: 'artwork-quiet-field',
      wall: 'Retired Wall',
      position: 1,
    });
    expectApiError(retiredArtwork, 422, {
      code: 'RULE_VIOLATION',
      message: 'Retired artwork cannot be placed in a new exhibition.',
      field: 'artworkId',
    });

    const currentDetailAfterFailures = await requestJson<ExhibitionDetailResponse>(
      runtime,
      `/api/exhibitions/${current.body.data.id}`,
    );
    const overlappingDetailAfterFailures = await requestJson<ExhibitionDetailResponse>(
      runtime,
      `/api/exhibitions/${overlapping.body.data.id}`,
    );
    const placementActivityAfterFailures = await requestJson<ActivityListResponse>(
      runtime,
      '/api/activity?entityType=placement&pageSize=100',
    );
    expect(currentDetailAfterFailures.body).toEqual(currentDetailBefore.body);
    expect(overlappingDetailAfterFailures.body).toEqual(overlappingDetailBefore.body);
    expect(placementActivityAfterFailures.body).toEqual(placementActivityBefore.body);

    const removed = await requestJson<DeleteResponse>(
      runtime,
      `/api/placements/${currentPlacement.body.data.id}`,
      { method: 'DELETE' },
    );
    expect(removed.response.status).toBe(200);
    expect(removed.body.data).toEqual({ id: currentPlacement.body.data.id });
    expect(removed.body.message).toBe('Placement removed.');
    const removedActivity = requireActivity(removed.body, 'placement deletion');
    expect(removedActivity).toMatchObject({
      entityType: 'placement',
      entityId: currentPlacement.body.data.id,
      action: 'deleted',
      detail: 'Removed Archive Study from Wall Z at position 4 in Placement Current.',
      createdAt: FROZEN_TIMESTAMP,
    });

    const currentDetailAfterDelete = await requestJson<ExhibitionDetailResponse>(
      runtime,
      `/api/exhibitions/${current.body.data.id}`,
    );
    expect(currentDetailAfterDelete.body.data.placements).toEqual([]);
    expect(currentDetailAfterDelete.body.data.derived).toEqual({
      artworkCount: 0,
      placedArtworkCount: 0,
      taskCount: 0,
      completedTaskCount: 0,
      openTaskCount: 0,
      overdueTaskCount: 0,
      conflictCount: 0,
      readinessPercent: 15,
      readinessState: 'attention',
    });

    const retainedActivity = await requestJson<ActivityListResponse>(
      runtime,
      `/api/activity?entityType=placement&entityId=${currentPlacement.body.data.id}&pageSize=100`,
    );
    expect(retainedActivity.body.pagination).toEqual({
      page: 1,
      pageSize: 100,
      total: 2,
      totalPages: 1,
    });
    expect(retainedActivity.body.data).toHaveLength(2);
    expect(retainedActivity.body.data).toEqual(
      expect.arrayContaining([currentActivity, removedActivity]),
    );
  });
});

describe('auditable exhibition lifecycle', () => {
  it('walks the legal lifecycle, records notes, and leaves state untouched on illegal moves', async () => {
    let clock = new Date(FROZEN_NOW);
    const runtime = makeRuntime(freshPath('lifecycle'), () => new Date(clock.getTime()));

    const created = await requestJson<ExhibitionMutationResponse>(runtime, '/api/exhibitions', {
      method: 'POST',
      json: {
        title: 'Lifecycle Show',
        space: 'Lifecycle Room',
        startDate: '2027-01-06',
        endDate: '2027-01-31',
        installStart: '2027-01-02',
        installEnd: '2027-01-05',
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.body.data.status).toBe('draft');
    expect(created.body.data.updatedAt).toBe(FROZEN_TIMESTAMP);
    const exhibitionId = created.body.data.id;

    const transition = (to: ExhibitionStatus, note: string, at: string) => {
      clock = new Date(at);
      return requestJson<ExhibitionMutationResponse>(
        runtime,
        `/api/exhibitions/${exhibitionId}/transitions`,
        { method: 'POST', json: { to, note } },
      );
    };

    const expectTransition = (
      result: JsonResult<ExhibitionMutationResponse>,
      from: ExhibitionStatus,
      to: ExhibitionStatus,
      note: string,
      at: string,
    ): void => {
      expect(result.response.status).toBe(200);
      expect(result.body.message).toBe(`Exhibition moved to ${to}.`);
      expect(result.body.data.status).toBe(to);
      expect(result.body.data.updatedAt).toBe(at);
      const activity = requireActivity(result.body, `${from} to ${to} transition`);
      expect(activity).toMatchObject({
        entityType: 'exhibition',
        entityId: exhibitionId,
        action: 'status_changed',
        detail: `Status changed from ${from} to ${to}. Note: ${note}`,
        createdAt: at,
      });
      expect(activity.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
      );
    };

    const rejectTransition = async (from: ExhibitionStatus, to: ExhibitionStatus) => {
      const detailBefore = await requestJson<ExhibitionDetailResponse>(
        runtime,
        `/api/exhibitions/${exhibitionId}`,
      );
      const rejected = await requestJson<ErrorResponse>(
        runtime,
        `/api/exhibitions/${exhibitionId}/transitions`,
        { method: 'POST', json: { to, note: 'This must not be recorded.' } },
      );
      expectApiError(rejected, 409, {
        code: 'INVALID_TRANSITION',
        message: `Cannot move an exhibition from ${from} to ${to}.`,
        field: 'to',
        details: { from, to },
      });
      const detailAfter = await requestJson<ExhibitionDetailResponse>(
        runtime,
        `/api/exhibitions/${exhibitionId}`,
      );
      expect(detailAfter.body).toEqual(detailBefore.body);
    };

    await rejectTransition('draft', 'installing');

    expectTransition(
      await transition('planned', 'Plan approved.', '2026-10-17T12:05:00.000Z'),
      'draft',
      'planned',
      'Plan approved.',
      '2026-10-17T12:05:00.000Z',
    );
    await rejectTransition('planned', 'planned');
    await rejectTransition('planned', 'draft');

    expectTransition(
      await transition('installing', 'Prep started.', '2026-10-17T12:10:00.000Z'),
      'planned',
      'installing',
      'Prep started.',
      '2026-10-17T12:10:00.000Z',
    );
    expectTransition(
      await transition('open', 'Opening reception.', '2026-10-17T12:15:00.000Z'),
      'installing',
      'open',
      'Opening reception.',
      '2026-10-17T12:15:00.000Z',
    );
    expectTransition(
      await transition('closed', 'Run complete.', '2026-10-17T12:20:00.000Z'),
      'open',
      'closed',
      'Run complete.',
      '2026-10-17T12:20:00.000Z',
    );
    await rejectTransition('closed', 'open');

    const detail = await requestJson<ExhibitionDetailResponse>(
      runtime,
      `/api/exhibitions/${exhibitionId}`,
    );
    expect(detail.body.data.status).toBe('closed');
    expect(detail.body.data.activity.map((entry) => entry.detail)).toEqual([
      'Status changed from open to closed. Note: Run complete.',
      'Status changed from installing to open. Note: Opening reception.',
      'Status changed from planned to installing. Note: Prep started.',
      'Status changed from draft to planned. Note: Plan approved.',
      'Created draft exhibition Lifecycle Show.',
    ]);
  });
});

describe('installation task workflow', () => {
  it('updates overdue task state, retains deletion audit, and refreshes derived dashboard counts', async () => {
    const runtime = makeRuntime(freshPath('task-workflow'));
    const initialDashboard = await requestJson<DashboardResponse>(runtime, '/api/dashboard');
    const initialTidal = initialDashboard.body.data.readinessRows.find(
      (row) => row.exhibitionId === 'exh-tidal-memory',
    );
    expect(initialTidal).toEqual({
      exhibitionId: 'exh-tidal-memory',
      title: 'Tidal Memory',
      space: 'Project Room',
      status: 'planned',
      startDate: '2026-11-20',
      endDate: '2027-01-10',
      artworkCount: 1,
      placedArtworkCount: 1,
      taskCount: 2,
      completedTaskCount: 0,
      openTaskCount: 2,
      overdueTaskCount: 0,
      conflictCount: 0,
      readinessPercent: 65,
      readinessState: 'attention',
    });
    expect(initialDashboard.body.data.totals.openTasks).toBe(5);
    expect(initialDashboard.body.data.overdueTaskCount).toBe(1);

    const created = await requestJson<TaskMutationResponse>(
      runtime,
      '/api/exhibitions/exh-tidal-memory/tasks',
      {
        method: 'POST',
        json: {
          title: 'Hang borrowed works',
          category: 'hanging',
          assignee: 'Rosa Grant',
          dueDate: '2026-10-16',
          status: 'todo',
        },
      },
    );
    expect(created.response.status).toBe(201);
    expect(created.body.data).toEqual({
      id: created.body.data.id,
      exhibitionId: 'exh-tidal-memory',
      title: 'Hang borrowed works',
      category: 'hanging',
      assignee: 'Rosa Grant',
      dueDate: '2026-10-16',
      status: 'todo',
      createdAt: FROZEN_TIMESTAMP,
      updatedAt: FROZEN_TIMESTAMP,
    });
    const taskId = created.body.data.id;
    const createdActivity = requireActivity(created.body, 'task creation');
    expect(createdActivity).toMatchObject({
      entityType: 'task',
      entityId: taskId,
      action: 'created',
      detail: 'Created task Hang borrowed works for Tidal Memory.',
      createdAt: FROZEN_TIMESTAMP,
    });

    const overdueAfterCreate = await requestJson<TaskListResponse>(
      runtime,
      '/api/tasks?overdue=true&sort=dueDate&direction=asc&pageSize=100',
    );
    expect(overdueAfterCreate.body.pagination).toEqual({
      page: 1,
      pageSize: 100,
      total: 2,
      totalPages: 1,
    });
    expect(overdueAfterCreate.body.data.map((task) => task.id)).toEqual([
      'task-still-focus-lights',
      taskId,
    ]);

    const dashboardAfterCreate = await requestJson<DashboardResponse>(runtime, '/api/dashboard');
    expect(dashboardAfterCreate.body.data.totals.openTasks).toBe(6);
    expect(dashboardAfterCreate.body.data.overdueTaskCount).toBe(2);
    expect(
      dashboardAfterCreate.body.data.readinessRows.find(
        (row) => row.exhibitionId === 'exh-tidal-memory',
      ),
    ).toEqual({
      exhibitionId: 'exh-tidal-memory',
      title: 'Tidal Memory',
      space: 'Project Room',
      status: 'planned',
      startDate: '2026-11-20',
      endDate: '2027-01-10',
      artworkCount: 1,
      placedArtworkCount: 1,
      taskCount: 3,
      completedTaskCount: 0,
      openTaskCount: 3,
      overdueTaskCount: 1,
      conflictCount: 0,
      readinessPercent: 50,
      readinessState: 'blocked',
    });

    const updated = await requestJson<TaskMutationResponse>(runtime, `/api/tasks/${taskId}`, {
      method: 'PATCH',
      json: { title: 'Hang and level borrowed works', status: 'in_progress' },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.body.message).toBe('Task status updated.');
    expect(updated.body.data).toMatchObject({
      id: taskId,
      title: 'Hang and level borrowed works',
      status: 'in_progress',
      dueDate: '2026-10-16',
    });
    const updatedActivity = requireActivity(updated.body, 'task update');
    expect(updatedActivity).toMatchObject({
      entityType: 'task',
      entityId: taskId,
      action: 'status_changed',
      detail: 'Status changed from todo to in_progress for Hang and level borrowed works.',
      createdAt: FROZEN_TIMESTAMP,
    });

    const overdueAfterUpdate = await requestJson<TaskListResponse>(
      runtime,
      '/api/tasks?overdue=true&sort=dueDate&direction=asc&pageSize=100',
    );
    expect(overdueAfterUpdate.body.data.map((task) => task.id)).toEqual([
      'task-still-focus-lights',
      taskId,
    ]);
    expect(overdueAfterUpdate.body.data[1]).toMatchObject({
      id: taskId,
      title: 'Hang and level borrowed works',
      status: 'in_progress',
    });

    const dashboardAfterUpdate = await requestJson<DashboardResponse>(runtime, '/api/dashboard');
    expect(dashboardAfterUpdate.body.data.totals.openTasks).toBe(6);
    expect(dashboardAfterUpdate.body.data.overdueTaskCount).toBe(2);
    expect(
      dashboardAfterUpdate.body.data.readinessRows.find(
        (row) => row.exhibitionId === 'exh-tidal-memory',
      ),
    ).toMatchObject({
      taskCount: 3,
      openTaskCount: 3,
      overdueTaskCount: 1,
      readinessPercent: 50,
      readinessState: 'blocked',
    });

    const removed = await requestJson<DeleteResponse>(runtime, `/api/tasks/${taskId}`, {
      method: 'DELETE',
    });
    expect(removed.response.status).toBe(200);
    expect(removed.body.data).toEqual({ id: taskId });
    expect(removed.body.message).toBe('Task deleted.');
    const removedActivity = requireActivity(removed.body, 'task deletion');
    expect(removedActivity).toMatchObject({
      entityType: 'task',
      entityId: taskId,
      action: 'deleted',
      detail: 'Deleted task Hang and level borrowed works from Tidal Memory.',
      createdAt: FROZEN_TIMESTAMP,
    });

    const overdueAfterDelete = await requestJson<TaskListResponse>(
      runtime,
      '/api/tasks?overdue=true&sort=dueDate&direction=asc&pageSize=100',
    );
    expect(overdueAfterDelete.body.pagination.total).toBe(1);
    expect(overdueAfterDelete.body.data.map((task) => task.id)).toEqual([
      'task-still-focus-lights',
    ]);

    const detailAfterDelete = await requestJson<ExhibitionDetailResponse>(
      runtime,
      '/api/exhibitions/exh-tidal-memory',
    );
    expect(detailAfterDelete.body.data.tasks.map((task) => task.id)).toEqual([
      'task-tidal-loan-crates',
      'task-tidal-lighting-plan',
    ]);
    expect(detailAfterDelete.body.data.derived).toEqual({
      artworkCount: 1,
      placedArtworkCount: 1,
      taskCount: 2,
      completedTaskCount: 0,
      openTaskCount: 2,
      overdueTaskCount: 0,
      conflictCount: 0,
      readinessPercent: 65,
      readinessState: 'attention',
    });

    const dashboardAfterDelete = await requestJson<DashboardResponse>(runtime, '/api/dashboard');
    expect(dashboardAfterDelete.body.data.totals.openTasks).toBe(5);
    expect(dashboardAfterDelete.body.data.overdueTaskCount).toBe(1);
    expect(
      dashboardAfterDelete.body.data.readinessRows.find(
        (row) => row.exhibitionId === 'exh-tidal-memory',
      ),
    ).toEqual(initialTidal);

    const retainedActivity = await requestJson<ActivityListResponse>(
      runtime,
      `/api/activity?entityType=task&entityId=${taskId}&pageSize=100`,
    );
    expect(retainedActivity.body.pagination).toEqual({
      page: 1,
      pageSize: 100,
      total: 3,
      totalPages: 1,
    });
    expect(retainedActivity.body.data).toHaveLength(3);
    expect(retainedActivity.body.data).toEqual(
      expect.arrayContaining([createdActivity, updatedActivity, removedActivity]),
    );
  });
});

describe('missing IDs, empty results, pagination, and joins', () => {
  it('returns structured 404s for missing resources and empty list envelopes for no matches', async () => {
    const runtime = makeRuntime(freshPath('missing-and-empty'));

    const missingArtist = await requestJson<ErrorResponse>(runtime, '/api/artists/missing-artist');
    expectApiError(missingArtist, 404, {
      code: 'NOT_FOUND',
      message: 'Artist not found.',
      field: 'id',
    });

    const missingArtwork = await requestJson<ErrorResponse>(
      runtime,
      '/api/artworks/missing-artwork',
    );
    expectApiError(missingArtwork, 404, {
      code: 'NOT_FOUND',
      message: 'Artwork not found.',
      field: 'id',
    });

    const missingExhibition = await requestJson<ErrorResponse>(
      runtime,
      '/api/exhibitions/missing-exhibition',
    );
    expectApiError(missingExhibition, 404, {
      code: 'NOT_FOUND',
      message: 'Exhibition not found.',
      field: 'id',
    });

    const missingTask = await requestJson<ErrorResponse>(runtime, '/api/tasks/missing-task', {
      method: 'PATCH',
      json: { title: 'Missing task' },
    });
    expectApiError(missingTask, 404, {
      code: 'NOT_FOUND',
      message: 'Task not found.',
      field: 'id',
    });

    const missingPlacement = await requestJson<ErrorResponse>(
      runtime,
      '/api/placements/missing-placement',
      { method: 'DELETE' },
    );
    expectApiError(missingPlacement, 404, {
      code: 'NOT_FOUND',
      message: 'Placement not found.',
      field: 'id',
    });

    const emptySearch = await requestJson<ArtistListResponse>(
      runtime,
      '/api/artists?search=no-such-artist',
    );
    expect(emptySearch.response.status).toBe(200);
    expect(emptySearch.body).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 25, total: 0, totalPages: 0 },
    });
  });

  it('computes stable pagination and joined artwork/exhibition detail payloads', async () => {
    const runtime = makeRuntime(freshPath('pagination-joins'));

    const artistPageOne = await requestJson<ArtistListResponse>(
      runtime,
      '/api/artists?page=1&pageSize=2&sort=name&direction=asc',
    );
    expect(artistPageOne.body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
    });
    expect(artistPageOne.body.data.map((artist) => artist.id)).toEqual([
      'artist-elena-voss',
      'artist-jonah-okafor',
    ]);
    const artistPageTwo = await requestJson<ArtistListResponse>(
      runtime,
      '/api/artists?page=2&pageSize=2&sort=name&direction=asc',
    );
    expect(artistPageTwo.body.data.map((artist) => artist.id)).toEqual([
      'artist-lin-tsai',
      'artist-mira-hale',
    ]);

    const artworkPageOne = await requestJson<ArtworkListResponse>(
      runtime,
      '/api/artworks?artistId=artist-mira-hale&page=1&pageSize=1&sort=title&direction=asc',
    );
    expect(artworkPageOne.body.pagination).toEqual({
      page: 1,
      pageSize: 1,
      total: 2,
      totalPages: 2,
    });
    expect(artworkPageOne.body.data).toEqual([
      {
        id: 'artwork-soft-geometry',
        artistId: 'artist-mira-hale',
        title: 'Soft Geometry',
        medium: 'Pigment and wax on panel',
        year: 2024,
        widthCm: 120,
        heightCm: 90,
        framed: true,
        status: 'available',
        artist: { id: 'artist-mira-hale', name: 'Mira Hale', status: 'active' },
        createdAt: '2026-01-08T10:05:00.000Z',
        updatedAt: '2026-01-08T10:05:00.000Z',
      },
    ]);
    const artworkPageTwo = await requestJson<ArtworkListResponse>(
      runtime,
      '/api/artworks?artistId=artist-mira-hale&page=2&pageSize=1&sort=title&direction=asc',
    );
    expect(artworkPageTwo.body.data.map((artwork) => artwork.id)).toEqual(['artwork-tidal-memory']);

    const exhibitionPageOne = await requestJson<ExhibitionListResponse>(
      runtime,
      '/api/exhibitions?page=1&pageSize=2&sort=startDate&direction=asc',
    );
    expect(exhibitionPageOne.body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      total: 4,
      totalPages: 2,
    });
    expect(exhibitionPageOne.body.data.map((exhibition) => exhibition.id)).toEqual([
      'exh-spring-register',
      'exh-still-moving',
    ]);
    const exhibitionPageTwo = await requestJson<ExhibitionListResponse>(
      runtime,
      '/api/exhibitions?page=2&pageSize=2&sort=startDate&direction=asc',
    );
    expect(exhibitionPageTwo.body.data.map((exhibition) => exhibition.id)).toEqual([
      'exh-tidal-memory',
      'exh-night-index',
    ]);

    const taskPageOne = await requestJson<TaskListResponse>(
      runtime,
      '/api/tasks?exhibitionId=exh-still-moving&page=1&pageSize=2',
    );
    expect(taskPageOne.body.pagination).toEqual({
      page: 1,
      pageSize: 2,
      total: 3,
      totalPages: 2,
    });
    expect(taskPageOne.body.data.map((task) => task.id)).toEqual([
      'task-still-wall-prep',
      'task-still-focus-lights',
    ]);
    const taskPageTwo = await requestJson<TaskListResponse>(
      runtime,
      '/api/tasks?exhibitionId=exh-still-moving&page=2&pageSize=2',
    );
    expect(taskPageTwo.body.data.map((task) => task.id)).toEqual(['task-still-title-vinyl']);

    const detail = await requestJson<ExhibitionDetailResponse>(
      runtime,
      '/api/exhibitions/exh-still-moving',
    );
    expect(detail.body.data.placements.map((placement) => placement.id)).toEqual([
      'placement-still-soft-geometry',
      'placement-still-red-thread',
      'placement-still-paper-orbit',
    ]);
    expect(detail.body.data.placements[0]?.artwork).toEqual({
      id: 'artwork-soft-geometry',
      artistId: 'artist-mira-hale',
      title: 'Soft Geometry',
      medium: 'Pigment and wax on panel',
      year: 2024,
      widthCm: 120,
      heightCm: 90,
      framed: true,
      status: 'available',
      artist: { id: 'artist-mira-hale', name: 'Mira Hale', status: 'active' },
    });
    expect(detail.body.data.tasks.map((task) => task.id)).toEqual([
      'task-still-wall-prep',
      'task-still-focus-lights',
      'task-still-title-vinyl',
    ]);
    expect(detail.body.data.activity.map((entry) => entry.id)).toEqual([
      'activity-seed-still-note',
      'activity-seed-still-open',
      'activity-seed-exhibitions-created',
    ]);
    expect(detail.body.data.conflicts).toEqual([]);
    expect(detail.body.data.derived).toEqual({
      artworkCount: 3,
      placedArtworkCount: 3,
      taskCount: 3,
      completedTaskCount: 1,
      openTaskCount: 2,
      overdueTaskCount: 1,
      conflictCount: 0,
      readinessPercent: 62,
      readinessState: 'blocked',
    });
  });
});
