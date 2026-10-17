import type Database from 'better-sqlite3';

import { SEED_MARKER, SEED_VERSION } from '../../shared/constants';

export { SEED_MARKER, SEED_VERSION } from '../../shared/constants';

const SEED_APPLIED_AT = '2026-09-15T08:00:00.000Z';

interface SeedArtist {
  id: string;
  name: string;
  email: string | null;
  bio: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

interface SeedArtwork {
  id: string;
  artistId: string;
  title: string;
  medium: string;
  year: number | null;
  widthCm: number | null;
  heightCm: number | null;
  framed: boolean;
  status: 'available' | 'reserved' | 'retired';
  createdAt: string;
  updatedAt: string;
}

interface SeedExhibition {
  id: string;
  title: string;
  subtitle: string | null;
  space: string;
  startDate: string;
  endDate: string;
  installStart: string;
  installEnd: string;
  status: 'draft' | 'planned' | 'installing' | 'open' | 'closed' | 'cancelled';
  curator: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

interface SeedPlacement {
  id: string;
  exhibitionId: string;
  artworkId: string;
  wall: string;
  position: number;
  label: string | null;
  notes: string | null;
  createdAt: string;
}

interface SeedTask {
  id: string;
  exhibitionId: string;
  title: string;
  category:
    'wall_prep' | 'lighting' | 'hanging' | 'labeling' | 'condition_check' | 'shipping' | 'other';
  assignee: string | null;
  dueDate: string | null;
  status: 'todo' | 'in_progress' | 'done';
  createdAt: string;
  updatedAt: string;
}

interface SeedActivity {
  id: string;
  entityType: 'artist' | 'artwork' | 'exhibition' | 'placement' | 'task';
  entityId: string;
  action: 'created' | 'updated' | 'deleted' | 'status_changed' | 'seeded';
  detail: string;
  createdAt: string;
}

export const SEED_ARTISTS = [
  {
    id: 'artist-mira-hale',
    name: 'Mira Hale',
    email: 'mira@mirahale.example',
    bio: 'Painter working with coastal light, memory, and shifting horizons.',
    status: 'active',
    createdAt: '2026-01-06T09:00:00.000Z',
    updatedAt: '2026-01-06T09:00:00.000Z',
  },
  {
    id: 'artist-jonah-okafor',
    name: 'Jonah Okafor',
    email: 'jonah@okaforstudio.example',
    bio: 'Mixed-media artist exploring archives, night, and civic space.',
    status: 'active',
    createdAt: '2026-01-06T09:05:00.000Z',
    updatedAt: '2026-01-06T09:05:00.000Z',
  },
  {
    id: 'artist-lin-tsai',
    name: 'Lin Tsai',
    email: 'lin@lintsai.example',
    bio: 'Paper and fibre artist whose folded forms record daily observation.',
    status: 'active',
    createdAt: '2026-01-06T09:10:00.000Z',
    updatedAt: '2026-01-06T09:10:00.000Z',
  },
  {
    id: 'artist-elena-voss',
    name: 'Elena Voss',
    email: 'elena@elenavoss.example',
    bio: 'Drawer and printmaker; archive currently closed to new loans.',
    status: 'archived',
    createdAt: '2026-01-06T09:15:00.000Z',
    updatedAt: '2026-03-01T12:00:00.000Z',
  },
] as const satisfies readonly SeedArtist[];

export const SEED_ARTWORKS = [
  {
    id: 'artwork-tidal-memory',
    artistId: 'artist-mira-hale',
    title: 'Tidal Memory',
    medium: 'Oil and salt on linen',
    year: 2025,
    widthCm: 152.4,
    heightCm: 121.9,
    framed: false,
    status: 'available',
    createdAt: '2026-01-08T10:00:00.000Z',
    updatedAt: '2026-01-08T10:00:00.000Z',
  },
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
    createdAt: '2026-01-08T10:05:00.000Z',
    updatedAt: '2026-01-08T10:05:00.000Z',
  },
  {
    id: 'artwork-night-index',
    artistId: 'artist-jonah-okafor',
    title: 'Night Index',
    medium: 'Archival pigment print',
    year: 2023,
    widthCm: 90,
    heightCm: 60,
    framed: true,
    status: 'reserved',
    createdAt: '2026-01-08T10:10:00.000Z',
    updatedAt: '2026-01-08T10:10:00.000Z',
  },
  {
    id: 'artwork-red-thread',
    artistId: 'artist-jonah-okafor',
    title: 'Red Thread',
    medium: 'Textile, thread, and steel',
    year: 2024,
    widthCm: 180,
    heightCm: 140,
    framed: false,
    status: 'available',
    createdAt: '2026-01-08T10:15:00.000Z',
    updatedAt: '2026-01-08T10:15:00.000Z',
  },
  {
    id: 'artwork-paper-orbit',
    artistId: 'artist-lin-tsai',
    title: 'Paper Orbit',
    medium: 'Handmade paper and thread',
    year: 2022,
    widthCm: 76.2,
    heightCm: 56,
    framed: false,
    status: 'available',
    createdAt: '2026-01-08T10:20:00.000Z',
    updatedAt: '2026-01-08T10:20:00.000Z',
  },
  {
    id: 'artwork-quiet-field',
    artistId: 'artist-lin-tsai',
    title: 'Quiet Field',
    medium: 'Acrylic on panel',
    year: 2021,
    widthCm: 100,
    heightCm: 80,
    framed: true,
    status: 'retired',
    createdAt: '2026-01-08T10:25:00.000Z',
    updatedAt: '2026-02-14T15:00:00.000Z',
  },
  {
    id: 'artwork-archive-study',
    artistId: 'artist-elena-voss',
    title: 'Archive Study',
    medium: 'Charcoal on paper',
    year: 2020,
    widthCm: 60,
    heightCm: 45,
    framed: true,
    status: 'available',
    createdAt: '2026-01-08T10:30:00.000Z',
    updatedAt: '2026-01-08T10:30:00.000Z',
  },
] as const satisfies readonly SeedArtwork[];

export const SEED_EXHIBITIONS = [
  {
    id: 'exh-still-moving',
    title: 'STILL / MOVING',
    subtitle: 'Painting at the edge of the tide',
    space: 'East Gallery',
    startDate: '2026-10-02',
    endDate: '2026-11-15',
    installStart: '2026-09-28',
    installEnd: '2026-10-01',
    status: 'open',
    curator: 'Nadia Bell',
    notes: 'Three artists on pause, motion, and the changing shoreline.',
    createdAt: '2026-02-02T09:00:00.000Z',
    updatedAt: '2026-10-02T08:30:00.000Z',
  },
  {
    id: 'exh-tidal-memory',
    title: 'Tidal Memory',
    subtitle: 'A solo presentation',
    space: 'Project Room',
    startDate: '2026-11-20',
    endDate: '2027-01-10',
    installStart: '2026-11-16',
    installEnd: '2026-11-19',
    status: 'planned',
    curator: 'Nadia Bell',
    notes: 'A focused installation of new and recent work by Mira Hale.',
    createdAt: '2026-02-10T11:00:00.000Z',
    updatedAt: '2026-09-20T14:10:00.000Z',
  },
  {
    id: 'exh-night-index',
    title: 'Night Index',
    subtitle: 'Prints and archival traces',
    space: 'East Gallery',
    startDate: '2027-02-01',
    endDate: '2027-03-15',
    installStart: '2027-01-27',
    installEnd: '2027-01-31',
    status: 'draft',
    curator: 'Iris Chen',
    notes: 'Lighting and wall layout are still under review.',
    createdAt: '2026-03-12T10:00:00.000Z',
    updatedAt: '2026-09-26T09:20:00.000Z',
  },
  {
    id: 'exh-spring-register',
    title: 'Spring Register',
    subtitle: 'Works on paper from the archive',
    space: 'West Gallery',
    startDate: '2026-04-01',
    endDate: '2026-05-10',
    installStart: '2026-03-27',
    installEnd: '2026-03-31',
    status: 'closed',
    curator: 'Iris Chen',
    notes: 'Archived exhibition retained for portfolio history.',
    createdAt: '2025-12-04T13:00:00.000Z',
    updatedAt: '2026-05-11T17:45:00.000Z',
  },
] as const satisfies readonly SeedExhibition[];

export const SEED_PLACEMENTS = [
  {
    id: 'placement-still-soft-geometry',
    exhibitionId: 'exh-still-moving',
    artworkId: 'artwork-soft-geometry',
    wall: 'Wall A',
    position: 1,
    label: 'Soft Geometry',
    notes: 'Centered at 150 cm.',
    createdAt: '2026-09-30T10:00:00.000Z',
  },
  {
    id: 'placement-still-red-thread',
    exhibitionId: 'exh-still-moving',
    artworkId: 'artwork-red-thread',
    wall: 'Wall B',
    position: 1,
    label: 'Red Thread',
    notes: null,
    createdAt: '2026-09-30T10:05:00.000Z',
  },
  {
    id: 'placement-still-paper-orbit',
    exhibitionId: 'exh-still-moving',
    artworkId: 'artwork-paper-orbit',
    wall: 'Wall B',
    position: 2,
    label: 'Paper Orbit',
    notes: 'Allow extra clearance on the right edge.',
    createdAt: '2026-09-30T10:10:00.000Z',
  },
  {
    id: 'placement-tidal-tidal-memory',
    exhibitionId: 'exh-tidal-memory',
    artworkId: 'artwork-tidal-memory',
    wall: 'North Wall',
    position: 1,
    label: 'Tidal Memory',
    notes: 'Anchor into the plaster rail.',
    createdAt: '2026-10-03T11:00:00.000Z',
  },
  {
    id: 'placement-night-night-index',
    exhibitionId: 'exh-night-index',
    artworkId: 'artwork-night-index',
    wall: 'West Wall',
    position: 1,
    label: 'Night Index',
    notes: null,
    createdAt: '2026-10-08T15:00:00.000Z',
  },
  {
    id: 'placement-spring-archive-study',
    exhibitionId: 'exh-spring-register',
    artworkId: 'artwork-archive-study',
    wall: 'Wall A',
    position: 1,
    label: 'Archive Study',
    notes: 'Framed work; install with UV glazing.',
    createdAt: '2026-03-29T12:00:00.000Z',
  },
] as const satisfies readonly SeedPlacement[];

export const SEED_TASKS = [
  {
    id: 'task-still-wall-prep',
    exhibitionId: 'exh-still-moving',
    title: 'Patch and paint walls',
    category: 'wall_prep',
    assignee: 'Rosa Grant',
    dueDate: '2026-09-28',
    status: 'done',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-09-27T16:30:00.000Z',
  },
  {
    id: 'task-still-focus-lights',
    exhibitionId: 'exh-still-moving',
    title: 'Focus track lights',
    category: 'lighting',
    assignee: 'Theo Marsh',
    dueDate: '2026-10-15',
    status: 'in_progress',
    createdAt: '2026-09-02T09:10:00.000Z',
    updatedAt: '2026-10-10T10:20:00.000Z',
  },
  {
    id: 'task-still-title-vinyl',
    exhibitionId: 'exh-still-moving',
    title: 'Print title vinyl',
    category: 'labeling',
    assignee: 'Rosa Grant',
    dueDate: '2026-10-18',
    status: 'todo',
    createdAt: '2026-09-02T09:15:00.000Z',
    updatedAt: '2026-09-02T09:15:00.000Z',
  },
  {
    id: 'task-tidal-loan-crates',
    exhibitionId: 'exh-tidal-memory',
    title: 'Confirm loan crates',
    category: 'shipping',
    assignee: 'Nadia Bell',
    dueDate: '2026-11-10',
    status: 'todo',
    createdAt: '2026-09-20T11:00:00.000Z',
    updatedAt: '2026-09-20T11:00:00.000Z',
  },
  {
    id: 'task-tidal-lighting-plan',
    exhibitionId: 'exh-tidal-memory',
    title: 'Approve lighting plan',
    category: 'lighting',
    assignee: 'Theo Marsh',
    dueDate: '2026-11-17',
    status: 'todo',
    createdAt: '2026-09-20T11:05:00.000Z',
    updatedAt: '2026-09-20T11:05:00.000Z',
  },
  {
    id: 'task-night-wall-layout',
    exhibitionId: 'exh-night-index',
    title: 'Draw wall layout',
    category: 'wall_prep',
    assignee: 'Iris Chen',
    dueDate: '2027-01-10',
    status: 'todo',
    createdAt: '2026-09-26T09:30:00.000Z',
    updatedAt: '2026-09-26T09:30:00.000Z',
  },
  {
    id: 'task-spring-condition-check',
    exhibitionId: 'exh-spring-register',
    title: 'Final condition check',
    category: 'condition_check',
    assignee: 'Nadia Bell',
    dueDate: '2026-04-01',
    status: 'done',
    createdAt: '2026-03-20T10:00:00.000Z',
    updatedAt: '2026-04-02T17:00:00.000Z',
  },
] as const satisfies readonly SeedTask[];

export const SEED_ACTIVITY = [
  {
    id: 'activity-seed-artists-created',
    entityType: 'artist',
    entityId: 'artist-mira-hale',
    action: 'seeded',
    detail: 'Seeded artist Mira Hale and the founding artist roster.',
    createdAt: '2026-09-15T08:01:00.000Z',
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
    id: 'activity-seed-exhibitions-created',
    entityType: 'exhibition',
    entityId: 'exh-still-moving',
    action: 'seeded',
    detail: 'Seeded four exhibitions across three gallery spaces.',
    createdAt: '2026-09-15T08:03:00.000Z',
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
    id: 'activity-seed-placement-orbit',
    entityType: 'placement',
    entityId: 'placement-still-paper-orbit',
    action: 'updated',
    detail: 'Updated Paper Orbit placement notes for STILL / MOVING.',
    createdAt: '2026-10-01T11:15:00.000Z',
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
    id: 'activity-seed-focus-lights',
    entityType: 'task',
    entityId: 'task-still-focus-lights',
    action: 'status_changed',
    detail: 'Status changed from todo to in_progress for Focus track lights.',
    createdAt: '2026-10-10T10:20:00.000Z',
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
    id: 'activity-seed-title-vinyl',
    entityType: 'task',
    entityId: 'task-still-title-vinyl',
    action: 'updated',
    detail: 'Updated the Print title vinyl assignee and due date.',
    createdAt: '2026-10-16T09:10:00.000Z',
  },
] as const satisfies readonly SeedActivity[];

export function getSeedVersion(db: Database.Database): number | null {
  const row = db.prepare("SELECT value FROM app_meta WHERE key = 'seed.version'").get() as
    { value: string } | undefined;

  if (!row) {
    return null;
  }

  const version = Number.parseInt(row.value, 10);
  return Number.isFinite(version) ? version : null;
}

export interface SeedResult {
  applied: boolean;
  seedVersion: number;
}

/**
 * Inserts the fixed demo fixture once. The caller may wrap this in a larger
 * transaction; better-sqlite3 uses nested savepoints when that happens.
 */
export function seedDatabase(db: Database.Database): SeedResult {
  const apply = db.transaction((): SeedResult => {
    const marker = db.prepare("SELECT value FROM app_meta WHERE key = 'seed.marker'").get() as
      { value: string } | undefined;
    const version = db.prepare("SELECT value FROM app_meta WHERE key = 'seed.version'").get() as
      { value: string } | undefined;

    if (marker?.value === SEED_MARKER && version?.value === String(SEED_VERSION)) {
      return { applied: false, seedVersion: SEED_VERSION };
    }

    const insertArtist = db.prepare(`
      INSERT OR IGNORE INTO artists
        (id, name, email, bio, status, created_at, updated_at)
      VALUES
        (@id, @name, @email, @bio, @status, @createdAt, @updatedAt)
    `);
    const insertArtwork = db.prepare(`
      INSERT OR IGNORE INTO artworks
        (id, artist_id, title, medium, year, width_cm, height_cm, framed, status, created_at, updated_at)
      VALUES
        (@id, @artistId, @title, @medium, @year, @widthCm, @heightCm, @framed, @status, @createdAt, @updatedAt)
    `);
    const insertExhibition = db.prepare(`
      INSERT OR IGNORE INTO exhibitions
        (id, title, subtitle, space, start_date, end_date, install_start, install_end, status,
         curator, notes, created_at, updated_at)
      VALUES
        (@id, @title, @subtitle, @space, @startDate, @endDate, @installStart, @installEnd, @status,
         @curator, @notes, @createdAt, @updatedAt)
    `);
    const insertPlacement = db.prepare(`
      INSERT OR IGNORE INTO placements
        (id, exhibition_id, artwork_id, wall, position, label, notes, created_at)
      VALUES
        (@id, @exhibitionId, @artworkId, @wall, @position, @label, @notes, @createdAt)
    `);
    const insertTask = db.prepare(`
      INSERT OR IGNORE INTO installation_tasks
        (id, exhibition_id, title, category, assignee, due_date, status, created_at, updated_at)
      VALUES
        (@id, @exhibitionId, @title, @category, @assignee, @dueDate, @status, @createdAt, @updatedAt)
    `);
    const insertActivity = db.prepare(`
      INSERT OR IGNORE INTO activity_entries
        (id, entity_type, entity_id, action, detail, created_at)
      VALUES
        (@id, @entityType, @entityId, @action, @detail, @createdAt)
    `);

    for (const artist of SEED_ARTISTS) {
      insertArtist.run(artist);
    }
    for (const artwork of SEED_ARTWORKS) {
      insertArtwork.run({ ...artwork, framed: artwork.framed ? 1 : 0 });
    }
    for (const exhibition of SEED_EXHIBITIONS) {
      insertExhibition.run(exhibition);
    }
    for (const placement of SEED_PLACEMENTS) {
      insertPlacement.run(placement);
    }
    for (const task of SEED_TASKS) {
      insertTask.run(task);
    }
    for (const activity of SEED_ACTIVITY) {
      insertActivity.run(activity);
    }

    db.prepare(
      `
      INSERT INTO app_meta (key, value) VALUES ('seed.marker', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    ).run(SEED_MARKER);
    db.prepare(
      `
      INSERT INTO app_meta (key, value) VALUES ('seed.version', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    ).run(String(SEED_VERSION));
    db.prepare(
      `
      INSERT INTO app_meta (key, value) VALUES ('seed.applied_at', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `,
    ).run(SEED_APPLIED_AT);

    return { applied: true, seedVersion: SEED_VERSION };
  });

  return apply.immediate();
}
