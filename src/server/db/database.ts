import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Database from 'better-sqlite3';

import { WallwiseService } from '../domain/service';
import { getSeedVersion, seedDatabase } from './seed';

const EMBEDDED_SCHEMA_SQL = String.raw`
-- Wallwise durable SQLite schema. Every statement is safe to run repeatedly.

CREATE TABLE IF NOT EXISTS app_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO app_meta (key, value) VALUES ('schema.version', '1');

CREATE TABLE IF NOT EXISTS artists (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  email TEXT,
  bio TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Case-insensitive uniqueness applies only to non-null email addresses.
CREATE UNIQUE INDEX IF NOT EXISTS idx_artists_email_nocase
  ON artists (email COLLATE NOCASE)
  WHERE email IS NOT NULL;

CREATE TABLE IF NOT EXISTS artworks (
  id TEXT PRIMARY KEY,
  artist_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  medium TEXT NOT NULL CHECK (length(trim(medium)) > 0),
  year INTEGER CHECK (year IS NULL OR (year BETWEEN 1000 AND 2100)),
  width_cm REAL CHECK (width_cm IS NULL OR (width_cm > 0 AND width_cm <= 10000)),
  height_cm REAL CHECK (height_cm IS NULL OR (height_cm > 0 AND height_cm <= 10000)),
  framed INTEGER NOT NULL DEFAULT 0 CHECK (framed IN (0, 1)),
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'reserved', 'retired')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (artist_id) REFERENCES artists (id) ON UPDATE CASCADE ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_artworks_artist_status ON artworks (artist_id, status);
CREATE INDEX IF NOT EXISTS idx_artworks_status ON artworks (status);

CREATE TABLE IF NOT EXISTS exhibitions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  subtitle TEXT,
  space TEXT NOT NULL CHECK (length(trim(space)) > 0),
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  install_start TEXT NOT NULL,
  install_end TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'planned', 'installing', 'open', 'closed', 'cancelled')),
  curator TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (install_start <= install_end),
  CHECK (install_end <= start_date),
  CHECK (start_date <= end_date)
);

CREATE INDEX IF NOT EXISTS idx_exhibitions_status_start ON exhibitions (status, start_date);
CREATE INDEX IF NOT EXISTS idx_exhibitions_end ON exhibitions (end_date);
CREATE INDEX IF NOT EXISTS idx_exhibitions_space ON exhibitions (space);

CREATE TABLE IF NOT EXISTS placements (
  id TEXT PRIMARY KEY,
  exhibition_id TEXT NOT NULL,
  artwork_id TEXT NOT NULL,
  wall TEXT NOT NULL CHECK (length(trim(wall)) > 0),
  position INTEGER NOT NULL CHECK (position >= 0),
  label TEXT,
  notes TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (exhibition_id) REFERENCES exhibitions (id) ON DELETE CASCADE,
  FOREIGN KEY (artwork_id) REFERENCES artworks (id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_placements_exhibition_artwork
  ON placements (exhibition_id, artwork_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_placements_exhibition_slot
  ON placements (exhibition_id, wall, position);
CREATE INDEX IF NOT EXISTS idx_placements_exhibition ON placements (exhibition_id);
CREATE INDEX IF NOT EXISTS idx_placements_artwork ON placements (artwork_id);

CREATE TABLE IF NOT EXISTS installation_tasks (
  id TEXT PRIMARY KEY,
  exhibition_id TEXT NOT NULL,
  title TEXT NOT NULL CHECK (length(trim(title)) > 0),
  category TEXT NOT NULL CHECK (
    category IN ('wall_prep', 'lighting', 'hanging', 'labeling', 'condition_check', 'shipping', 'other')
  ),
  assignee TEXT,
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (exhibition_id) REFERENCES exhibitions (id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_tasks_exhibition_status_due
  ON installation_tasks (exhibition_id, status, due_date);
CREATE INDEX IF NOT EXISTS idx_tasks_status_due ON installation_tasks (status, due_date);

CREATE TABLE IF NOT EXISTS activity_entries (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL CHECK (
    entity_type IN ('artist', 'artwork', 'exhibition', 'placement', 'task')
  ),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (
    action IN ('created', 'updated', 'deleted', 'status_changed', 'seeded')
  ),
  detail TEXT NOT NULL CHECK (length(trim(detail)) > 0),
  created_at TEXT NOT NULL
);

-- entity_id intentionally has no foreign key: activity is polymorphic and must
-- survive deletion of placements and tasks.
CREATE INDEX IF NOT EXISTS idx_activity_entity ON activity_entries (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_activity_created_desc ON activity_entries (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_entity_created
  ON activity_entries (entity_type, entity_id, created_at DESC);
`;

function isMemoryDatabase(databasePath: string): boolean {
  return databasePath === ':memory:' || databasePath.startsWith('file::memory:');
}

function schemaCandidates(): string[] {
  return [
    fileURLToPath(new URL('./schema.sql', import.meta.url)),
    resolve(process.cwd(), 'src/server/db/schema.sql'),
    resolve(process.cwd(), 'dist/server/db/schema.sql'),
  ];
}

/**
 * Source runs read schema.sql so the checked-in SQL remains the visible source
 * of truth. Bundled production builds retain an identical embedded copy because
 * tsup does not copy arbitrary `.sql` assets.
 */
export function loadSchemaSql(): string {
  for (const candidate of schemaCandidates()) {
    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }

  return EMBEDDED_SCHEMA_SQL;
}

/**
 * Initialized durable database handle. `db` is the single better-sqlite3
 * connection used by the application; `service()` wraps that same connection.
 */
export class WallwiseDatabase {
  readonly db: Database.Database;
  readonly databasePath: string;
  private isClosed = false;

  constructor(databasePath: string) {
    if (!databasePath.trim()) {
      throw new Error('A database path is required.');
    }

    this.databasePath = databasePath;

    if (!isMemoryDatabase(databasePath)) {
      mkdirSync(dirname(resolve(databasePath)), { recursive: true });
    }

    this.db = new Database(databasePath);
    this.configureConnection();
    this.applySchemaAndSeed();
  }

  private configureConnection(): void {
    this.db.pragma('foreign_keys = ON');
    this.db.pragma('busy_timeout = 5000');
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
  }

  private applySchemaAndSeed(): void {
    try {
      const initialize = this.db.transaction(() => {
        this.db.exec(loadSchemaSql());
        seedDatabase(this.db);
      });
      initialize.immediate();
    } catch (error) {
      this.db.close();
      this.isClosed = true;
      throw error;
    }
  }

  service(now: () => Date = () => new Date()): WallwiseService {
    return new WallwiseService(this.db, now);
  }

  getSeedVersion(): number | null {
    return getSeedVersion(this.db);
  }

  close(): void {
    if (this.isClosed) {
      return;
    }
    this.db.close();
    this.isClosed = true;
  }
}

/** Opens, configures, migrates, and deterministically seeds a database. */
export function initializeDatabase(databasePath: string): WallwiseDatabase {
  return new WallwiseDatabase(databasePath);
}

/** Primary factory exported for the API/bootstrap layer. */
export function createDatabase(databasePath: string): WallwiseDatabase {
  return initializeDatabase(databasePath);
}

export { getSeedVersion, seedDatabase } from './seed';
