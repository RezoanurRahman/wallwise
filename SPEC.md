# Wallwise Product Specification

Wallwise is a durable exhibition planning desk for independent galleries. A gallery director
maintains artists and artworks, assembles conflict-free exhibitions, tracks installation work,
reviews an auditable history, and exports a portfolio view without maintaining parallel
spreadsheets.

This document is the behavior contract for the frontend, API, storage layer, seeds, and tests.
The HTTP shapes live in `src/shared/types.ts`; shared status values, transition rules, task
categories, seed metadata, limits, and error codes live in `src/shared/constants.ts`.

## 1. Product principles

- SQLite is the source of truth. Data survives process restarts and is never held only in memory.
- The server validates every write and makes domain decisions. The browser never fabricates totals,
  readiness, conflicts, or audit rows.
- Schedule and artwork conflicts are rejected before a conflicting write commits.
- Every successful domain mutation and every exhibition status transition is auditable.
- Seed data is deterministic, useful on first launch, and explicitly marked so it can be upgraded
  safely.
- The interface is calm, dense enough for daily desk work, responsive from 360 px upward, and fully
  keyboard accessible.
- Empty, loading, error, pending, and success states are designed states, not afterthoughts.

## 2. Contract conventions

- API JSON is UTF-8 under `/api`. CSV is the only non-JSON success response.
- IDs are opaque strings. Seeded records use stable readable IDs; new records use UUIDs.
- Calendar dates use `YYYY-MM-DD` (`IsoDate`) and are validated as real UTC calendar dates.
- Timestamps use ISO 8601 UTC strings with a `Z` suffix (`IsoTimestamp`). The server clock supplies
  timestamps.
- API records use camelCase. Nullable database columns map to `null`, not omitted properties.
- Missing create/update fields are handled separately from explicit `null`: omission means "leave
  unchanged" on PATCH; `null` clears a nullable field.
- Every JSON success uses one of the shared envelopes: `ListResponse<T>`, `DetailResponse<T>`, or
  `MutationResponse<T>`.
- Every failure uses `ErrorResponse`: `{ "error": { "code", "message", "field?", "details?" } }`.
  `field` is the first relevant form field path. `details` is structured only with the matching
  shared type, such as `ConflictErrorDetails` for conflict errors.
- Lists default to page 1 and 25 rows. `pageSize` is clamped to 1-100, counts and page counts are
  computed from the full filtered set, and default ordering is deterministic.
- Search is trimmed, case-insensitive, and searches the user-facing fields named below. Unknown
  query keys and unknown request-body keys are rejected with a validation error.
- Date ranges are inclusive everywhere. An exhibition ending November 15 still occupies its space
  on November 15.

### Entity summary

| Entity            | Required API contract behavior                                                                                                          |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Artist            | Active or archived records with optional email and bio. Artwork list/detail responses include an artist summary.                        |
| Artwork           | Artist-owned work with optional year and dimensions, framed state, and available/reserved/retired status.                               |
| Exhibition        | Scheduled show in a named space, with exhibition and installation date ranges, lifecycle status, and derived readiness/conflict counts. |
| Placement         | One artwork hung on one wall at one position within an exhibition. Detail payloads include the artwork and artist summary.              |
| Installation task | Exhibition task with a category, optional assignee and due date, and todo/in-progress/done status.                                      |
| Activity          | Append-only audit row naming the entity, action, detail, and timestamp.                                                                 |

## 3. Workflow acceptance criteria

### 3.1 Dashboard and navigation

1. `GET /api/dashboard` returns `DashboardResponse` computed directly from SQLite.
2. The dashboard shows totals for all artists, active artists, all artworks, available artworks,
   all exhibitions, scheduled exhibitions, placements, and open tasks. Scheduled exhibitions are
   non-cancelled and non-closed shows whose `endDate` is today or later.
3. Status counts include every key in `ArtistStatus`, `ArtworkStatus`, `ExhibitionStatus`, and
   `TaskStatus`, including zero values.
4. Upcoming exhibitions include non-cancelled shows whose `endDate` is today or later, sorted by
   `startDate`, then title, limited to eight. Each row shows readiness and conflict warnings.
5. Readiness rows cover the same upcoming window, sorted by start date, then title, limited to eight.
6. Overdue tasks are non-done tasks with a non-null due date before today in UTC. The dashboard count
   matches the number of overdue tasks represented by the API data.
7. Conflict warning count is the deduplicated count of current space, installation-window, and
   artwork double-booking warnings involving non-cancelled shows that have not ended.
8. Recently changed activity shows at most ten entries, newest first, with an entity label and
   human-readable action detail.
9. The page exposes primary navigation to Dashboard, Artists, Artworks, and Exhibitions. It has
   accessible loading, empty, error-with-retry, and success states. Empty counts link to the relevant
   creation flow rather than looking like broken content.
10. After returning from a mutation, dashboard values reflect the durable database state without a
    page reload requirement.

### 3.2 Artist management

1. The artist list supports paginated search by name/email, status filtering, alphabetical order,
   and a visible empty result message.
2. A director can create an artist with a trimmed name. Email is optional and must be a valid address
   of at most 254 characters. Bio is optional and at most 2,000 characters. Status defaults to
   active. Blank optional text is normalized to `null`.
3. Duplicate non-null emails are rejected case-insensitively with a field-level validation error.
4. A director can edit name, email, bio, and status. Archiving preserves the artist and every linked
   artwork; it never cascades a delete.
5. Archived artists are clearly labeled in lists and embedded artwork artist summaries. Archived
   artists remain searchable and their records remain visible.
6. Every successful create or update returns the complete `Artist` and appends one activity row.
   Failed writes append no activity row.
7. The create/edit panels use persistent visible labels, inline field errors tied with
   `aria-describedby`, a summary error for server failures, a pending state, and a success message.

### 3.3 Artwork management

1. The artwork list supports search by title/medium/artist, artist filtering, status filtering,
   pagination, and both list and compact card presentations on small screens.
2. Each list/detail artwork includes `artist: ArtistSummary`. Archived artist summaries are visibly
   marked, and retired artworks are visibly distinct without relying on color alone.
3. A director can create and edit an artwork only for an existing artist. Required fields are title
   and medium. Year, width, and height are optional; when present, year is 1000-2100, dimensions are
   greater than zero and at most 10,000 cm, and numbers are finite. `framed` defaults to false and
   status defaults to available.
4. Retiring an artwork preserves its history and existing placements. A retired artwork cannot be
   added to a new placement.
5. If an artist identifier does not exist, the API returns 404. Invalid references never create an
   artwork.
6. Every successful mutation returns the joined artwork record and appends one activity row.
7. Form validation is announced, failed submissions preserve entered values, and successful
   submissions reset the form and announce confirmation.

### 3.4 Exhibition creation and detail

1. A director can create a draft exhibition with title, optional subtitle, space, exhibition dates,
   installation dates, optional curator, and optional notes. Title and space are required; all text is
   trimmed.
2. Valid date order is `installStart <= installEnd <= startDate <= endDate`. Missing, malformed, or
   impossible dates are rejected. `startDate <= endDate` and both installation dates are required.
3. The same normalized space cannot host two non-cancelled exhibitions whose exhibition ranges
   overlap, nor can their installation ranges overlap. Space comparison is case-insensitive after
   trimming and collapsing internal whitespace.
4. A conflicting create returns HTTP 409 with code `SCHEDULE_CONFLICT`, a useful message, and
   `details.conflicts: ConflictWarning[]`. It must not partially insert the exhibition.
5. A date/space change on PATCH performs the same conflict check, excluding the exhibition itself.
   A conflict returns 409 and leaves the prior row unchanged.
6. Details show status, dates, space, curator, notes, derived counts, readiness, placements, tasks,
   conflicts, and recent entity activity. A missing ID returns `NOT_FOUND`.
7. The detail header offers only transitions allowed by
   `EXHIBITION_STATUS_TRANSITIONS`; unavailable actions are absent or disabled with an explanation.
8. The page includes an accessible empty hang state, task empty state, loading state, retryable error
   state, and conflict banners that name the related show.

### 3.5 Hang and placement workflow

1. A director adds an artwork to an exhibition with a wall label, integer position, optional label,
   and optional notes. Wall is required and positions are non-negative integers.
2. One artwork may appear at most once per exhibition. One wall/position slot may hold at most one
   placement. Duplicate combinations return 409 `PLACEMENT_CONFLICT` without a write.
3. A retired artwork cannot be newly placed and returns 422 `RULE_VIOLATION` with `field: "artworkId"`.
4. An artwork cannot be assigned to overlapping exhibitions. Occupancy for this rule runs from an
   exhibition's `installStart` through its `endDate`, inclusive. The check covers every placement in
   a non-cancelled exhibition other than the target and compares inclusive ranges.
5. A double booking returns 409 `ARTWORK_ASSIGNMENT_CONFLICT` with details identifying the artwork
   and related exhibition. No placement or activity row is written.
6. A director can edit wall, position, label, and notes. The same slot and artwork conflict rules
   apply. Removing a placement frees the slot and artwork immediately and writes an audit row.
7. The hang list shows artwork title, artist, wall, position, label, and notes. Actions are keyboard
   reachable and confirm destructive removal.

### 3.6 Auditable exhibition lifecycle

1. New exhibitions always begin in `draft`; status cannot be set in create or update bodies.
2. Only `POST /api/exhibitions/:id/transitions` changes exhibition status. It accepts
   `ExhibitionTransitionRequest` and uses the non-linear map:

   | From       | Allowed to            |
   | ---------- | --------------------- |
   | draft      | planned, cancelled    |
   | planned    | installing, cancelled |
   | installing | open, cancelled       |
   | open       | closed                |
   | closed     | none                  |
   | cancelled  | none                  |

3. An illegal transition, including a transition to the current status, returns HTTP 409
   `INVALID_TRANSITION` and writes nothing.
4. A valid transition updates the exhibition, increments `updatedAt`, and appends one activity row
   with `entityType: "exhibition"`, `action: "status_changed"`, and a detail containing both the old
   and new status. An optional note, at most 500 characters, is preserved in the detail.
5. The transition and audit insert are atomic. A failed audit insert rolls back the status change.
   A concurrent second transition re-reads the current status inside the transaction and cannot skip
   a lifecycle state.
6. The UI asks for confirmation before `open`, `closed`, or `cancelled`, announces success and new
   status, and refreshes derived data and activity. Invalid options cannot be selected manually.

### 3.7 Installation task tracking

1. A director can add tasks to an exhibition with title, category from `TASK_CATEGORIES`, optional
   assignee, optional due date, and optional initial status. Title is required.
2. The task list can filter by exhibition, status, category, and overdue flag, and can sort by due
   date or update time. Due dates use `YYYY-MM-DD`.
3. A director can edit task fields, move status through todo/in-progress/done, and delete a task.
   Every successful mutation writes an activity row. Deleting a task preserves its audit history.
4. Tasks with no due date are never overdue. Overdue requires a due date before today and a status
   other than done.
5. Exhibition detail shows completion counts, open tasks, and overdue emphasis. Task rows identify
   category, assignee, due date, and status with text, not only icons or color.
6. Empty, loading, error, and saving states are present. Status changes cannot be double-submitted.

### 3.8 Analytics and CSV export

1. The dashboard is the portfolio analytics view: totals, status distribution, upcoming schedule,
   readiness, conflicts, overdue work, and recent change are all server-computed from durable data.
2. `GET /api/export/exhibitions.csv` returns every exhibition as UTF-8 CSV with the stable header and
   row fields from `ExhibitionExportRow`. Rows are ordered by `startDate`, then title.
3. CSV values containing commas, quotes, CR, or LF are quoted and embedded quotes are doubled. Null
   values export as empty cells. The response has `Content-Type: text/csv; charset=utf-8` and an
   attachment filename such as `wallwise-exhibitions.csv`.
4. A failed export shows an error with retry; it does not navigate away or silently download HTML.
5. Frontend analytics never derive status totals from only the current page. They use
   `DashboardSummary` or complete list responses.

## 4. Advanced capability decisions

### 4.1 Conflict detection

- **Space and exhibition dates:** For a proposed exhibition, compare its inclusive exhibition range
  with every other non-cancelled exhibition in the same normalized space. Overlap is
  `a.startDate <= b.endDate && b.startDate <= a.endDate`.
- **Space and installation dates:** Apply the same comparison to `installStart`/`installEnd`. Both
  checks run because an install and a public run are separate occupancy periods.
- **Artworks:** Treat `installStart` through `endDate` as the artwork's physical availability window.
  Compare the proposed/edited placement's exhibition window with placements in overlapping,
  non-cancelled exhibitions. Ignore the placement's own current row when editing.
- Conflict checks and the mutation use one immediate SQLite transaction. The API returns all detected
  warnings rather than a generic failure. There is no "force" bypass in the documented API.
- A change of space, exhibition dates, or installation dates is revalidated for both existing
  placements and schedule shape because it changes every occupancy window.
- Cancelling an exhibition removes it from future conflict checks while retaining its historical
  rows, placements, tasks, and audit trail.

### 4.2 Readiness and derived analytics

Derived values are calculated on read and never stored as user-editable counters.

- `artworkCount` is the number of distinct artworks placed in the exhibition.
- `placedArtworkCount` is the number of those placements with a valid wall and position. It is kept as
  a separate contract field for dashboard clarity.
- `taskCount`, `completedTaskCount`, and `openTaskCount` count all tasks, done tasks, and non-done
  tasks respectively. `overdueTaskCount` uses the UTC-day rule above.
- `conflictCount` counts conflict warnings involving this show and another non-cancelled show.
- `readinessPercent` is deterministic and rounded to the nearest integer:
  - artwork component: 50 points when at least one artwork is placed, otherwise 0;
  - task component: 35 points multiplied by completed tasks divided by all tasks, otherwise 0 when
    there are no tasks;
  - operations component: 15 points only when there are no overdue tasks and no conflicts;
  - clamp the result to 0-100.
- `readinessState` is `blocked` when there is a conflict or overdue task, `ready` when
  `readinessPercent` is 100, and `attention` otherwise.

This formula is intentionally visible to users in a short readiness explanation so the dashboard is
not a mysterious score.

### 4.3 Auditable state changes

- Activity is append-only through API behavior. There is no update or delete activity endpoint.
- Create, update, delete, archive, retirement, task movement, placement changes, and lifecycle
  transitions each produce one concise activity entry in the same transaction as the domain write.
- Status entries must include old and new status in `detail`.
- Activity stores a polymorphic `entityType`/`entityId` pair. `entityId` is deliberately not a SQLite
  foreign key because one column references several tables; detail is self-contained so history
  remains meaningful after child deletion.
- Seeded creates use `seed`-related stable history but are not presented as real user actions. The
  seed marker/version are stored in `app_meta`.

### 4.4 Computed performance

- Dashboard counts use aggregate SQL, not loading every row into JavaScript.
- List endpoints paginate in SQL and fetch joined display data in a bounded query.
- Database indexes cover filters and joins. Derived readiness for a detail or schedule page may batch
  task and placement aggregates to avoid per-row N+1 API queries.

## 5. SQLite and transaction specification

The default database is the durable file `data/wallwise.sqlite`. `DATABASE_PATH` overrides it for
local use, CI, and tests. There is no in-memory production mode. Tests may point at files under
`.tmp/`; those files are disposable and reset explicitly.

### Tables and constraints

| Table                | Key columns and decisions                                                                                                                                                   |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `app_meta`           | `key TEXT PRIMARY KEY`, `value TEXT NOT NULL`. Stores schema version and seed marker/version.                                                                               |
| `artists`            | String ID primary key; trimmed name; nullable email/bio; status check; UTC timestamps. Unique case-insensitive non-null email.                                              |
| `artworks`           | String ID; `artist_id` foreign key; title/medium; nullable year/dimensions; framed integer 0/1; artifact status check; timestamps.                                          |
| `exhibitions`        | String ID; title/subtitle/space; four date-only text columns; status check; nullable curator/notes; timestamps. Check date order.                                           |
| `placements`         | String ID; exhibition and artwork foreign keys; wall; integer position; label/notes; timestamp. Unique `(exhibition_id, artwork_id)` and `(exhibition_id, wall, position)`. |
| `installation_tasks` | String ID; exhibition foreign key; title; category/status checks; nullable assignee/due date; timestamps.                                                                   |
| `activity_entries`   | String ID; entity type/ID; action; non-empty detail; timestamp. No foreign key to the polymorphic entity.                                                                   |

Foreign-key decisions:

- `artworks.artist_id -> artists.id` uses `ON UPDATE CASCADE ON DELETE RESTRICT`. The API archives,
  never deletes, artists.
- `placements.exhibition_id -> exhibitions.id` and `installation_tasks.exhibition_id ->
exhibitions.id` use `ON DELETE CASCADE`, although the API does not delete exhibitions.
- `placements.artwork_id -> artworks.id` uses `ON DELETE RESTRICT`. The API retires artworks.
- `PRAGMA foreign_keys = ON` is applied to every connection, then WAL mode, `busy_timeout` of at least
  5,000 ms, and `synchronous = NORMAL` are configured for this single-process desk application.

Required indexes include artwork artist/status, exhibition status/start/end/space, placement
exhibition/artwork, task exhibition/status/due date, activity entity/timestamp, and activity created
time descending.

All multi-row writes use `better-sqlite3` transactions. Conflict validation, domain writes, and
activity insertion execute in an immediate transaction. The server maps constraints and thrown domain
errors to the public envelope and never exposes a raw SQLite message or stack trace. Startup applies
idempotent schema migration and seed logic in its own transaction.

## 6. HTTP API

All routes are relative to `/api`. List responses return `{ data, pagination }`; detail responses
return `{ data }`; mutation responses return `{ data, message, activity? }`.

| Method | Path                           | Request / query               | Success response                   | Important behavior                                                       |
| ------ | ------------------------------ | ----------------------------- | ---------------------------------- | ------------------------------------------------------------------------ |
| GET    | `/health`                      | none                          | `HealthResponse`                   | Database is open; deterministic readiness target for Playwright.         |
| GET    | `/dashboard`                   | none                          | `DashboardResponse`                | All aggregates, upcoming data, overdue/conflict counts, recent activity. |
| GET    | `/artists`                     | `ArtistListQuery`             | `ArtistListResponse`               | Search, status filter, paging, deterministic sort.                       |
| POST   | `/artists`                     | `CreateArtistInput`           | `ArtistMutationResponse` (201)     | Validate and audit atomically.                                           |
| GET    | `/artists/:id`                 | path ID                       | `ArtistDetailResponse`             | 404 when absent.                                                         |
| PATCH  | `/artists/:id`                 | `UpdateArtistInput`           | `ArtistMutationResponse`           | At least one field; archive-aware.                                       |
| GET    | `/artworks`                    | `ArtworkListQuery`            | `ArtworkListResponse`              | Joined artist summary; filters and paging.                               |
| POST   | `/artworks`                    | `CreateArtworkInput`          | `ArtworkMutationResponse` (201)    | Existing artist required.                                                |
| GET    | `/artworks/:id`                | path ID                       | `ArtworkDetailResponse`            | Joined artist summary.                                                   |
| PATCH  | `/artworks/:id`                | `UpdateArtworkInput`          | `ArtworkMutationResponse`          | Validate status and references.                                          |
| GET    | `/exhibitions`                 | `ExhibitionListQuery`         | `ExhibitionListResponse`           | Includes derived readiness and conflict counts.                          |
| POST   | `/exhibitions`                 | `CreateExhibitionInput`       | `ExhibitionMutationResponse` (201) | Starts draft; 409 on schedule conflict.                                  |
| GET    | `/exhibitions/:id`             | path ID                       | `ExhibitionDetailResponse`         | Placements, tasks, conflicts, and activity.                              |
| PATCH  | `/exhibitions/:id`             | `UpdateExhibitionInput`       | `ExhibitionMutationResponse`       | Rechecks schedule and assignment validity. Status is rejected here.      |
| POST   | `/exhibitions/:id/transitions` | `ExhibitionTransitionRequest` | `ExhibitionMutationResponse`       | Map-enforced, atomic audit.                                              |
| POST   | `/exhibitions/:id/placements`  | `CreatePlacementInput`        | `PlacementMutationResponse` (201)  | 409 for slot/artwork conflicts; 422 for retired artwork.                 |
| PATCH  | `/placements/:id`              | `UpdatePlacementInput`        | `PlacementMutationResponse`        | Rechecks slot and artwork occupancy.                                     |
| DELETE | `/placements/:id`              | none                          | `DeleteResponse`                   | Frees the slot/artwork; audit preserved.                                 |
| GET    | `/tasks`                       | `TaskListQuery`               | `TaskListResponse`                 | Filter by exhibition/status/category/overdue.                            |
| POST   | `/exhibitions/:id/tasks`       | `CreateTaskInput`             | `TaskMutationResponse` (201)       | Validate category and date.                                              |
| PATCH  | `/tasks/:id`                   | `UpdateTaskInput`             | `TaskMutationResponse`             | Status changes audited.                                                  |
| DELETE | `/tasks/:id`                   | none                          | `DeleteResponse`                   | Audit retained.                                                          |
| GET    | `/activity`                    | `ActivityListQuery`           | `ActivityListResponse`             | Newest first; bounded limit.                                             |
| GET    | `/export/exhibitions.csv`      | none                          | `text/csv`                         | Stable headers, ordering, quoting, and attachment name.                  |

The built Node server also serves the built React client and SPA fallback for non-API GET routes.
Unknown `/api` routes return the JSON 404 envelope; API errors never fall back to HTML.

## 7. Validation and error conventions

Request bodies are parsed with strict schemas. The server checks field types, lengths, allowed enum
values, real calendar dates, numeric ranges, required references, unknown keys, body size limits, and
that PATCH contains at least one recognized field.

| Status | Code                          | Use                                                                     |
| ------ | ----------------------------- | ----------------------------------------------------------------------- |
| 400    | `VALIDATION_ERROR`            | Malformed JSON, invalid query/body, unknown field, failed field rule.   |
| 404    | `NOT_FOUND`                   | Missing route entity or reference.                                      |
| 409    | `SCHEDULE_CONFLICT`           | Same-space exhibition or installation overlap.                          |
| 409    | `ARTWORK_ASSIGNMENT_CONFLICT` | Artwork occupied by an overlapping show.                                |
| 409    | `PLACEMENT_CONFLICT`          | Duplicate artwork or wall/position in an exhibition.                    |
| 409    | `INVALID_TRANSITION`          | Lifecycle move not allowed from the current status.                     |
| 422    | `RULE_VIOLATION`              | Valid shape but prohibited domain action, such as placing retired work. |
| 500    | `INTERNAL_ERROR`              | Unexpected failure. Log internally without leaking SQL or stack traces. |

The error `message` is safe for direct display and actionable where possible. Field-level UI uses
`field`; conflict UI may render names from `details.conflicts`. Elysia's default error payload is
mapped to this envelope so malformed requests do not break the frontend error parser.

Shared validation limits are exported in `FIELD_LIMITS`. Empty optional strings are normalized to
`null`; required text is trimmed and cannot become empty. Emails are trimmed, length checked, and
checked case-insensitively for uniqueness. Numeric inputs reject `NaN`, infinity, and coercion from
blank strings.

## 8. Deterministic seed data

Seeding is idempotent, runs in one transaction, and writes `SEED_MARKER` and `SEED_VERSION` from
`src/shared/constants.ts` into `app_meta`. A database that already carries the current marker is not
reseeded. Delete the database file in local/test environments to rebuild it. Seed timestamps are fixed;
the demo is not regenerated with random IDs.

The required demo baseline is:

- **Artists:** Mira Hale and Jonah Okafor and Lin Tsai active; Elena Voss archived. Use stable IDs
  `artist-mira-hale`, `artist-jonah-okafor`, `artist-lin-tsai`, and `artist-elena-voss`.
- **Artworks:** exactly seven records with mixed dimensions, years, and framed values:
  - `artwork-tidal-memory`, Tidal Memory, Mira, available;
  - `artwork-soft-geometry`, Soft Geometry, Mira, available;
  - `artwork-night-index`, Night Index, Jonah, reserved;
  - `artwork-red-thread`, Red Thread, Jonah, available;
  - `artwork-paper-orbit`, Paper Orbit, Lin, available;
  - `artwork-quiet-field`, Quiet Field, Lin, retired;
  - `artwork-archive-study`, Archive Study, Elena, available.
- **Exhibitions:** four records:
  - `exh-still-moving`, **STILL / MOVING**, East Gallery, 2026-10-02 to 2026-11-15, install
    2026-09-28 to 2026-10-01, status `open`;
  - `exh-tidal-memory`, **Tidal Memory**, Project Room, 2026-11-20 to 2027-01-10, install
    2026-11-16 to 2026-11-19, status `planned`;
  - `exh-night-index`, **Night Index**, East Gallery, 2027-02-01 to 2027-03-15, install
    2027-01-27 to 2027-01-31, status `draft`;
  - `exh-spring-register`, **Spring Register**, West Gallery, 2026-04-01 to 2026-05-10, install
    2026-03-27 to 2026-03-31, status `closed`.
- **Placements:** exactly six, with no initial cross-show artwork conflicts:
  - STILL / MOVING: Soft Geometry on Wall A position 1, Red Thread on Wall B position 1, Paper Orbit
    on Wall B position 2;
  - Tidal Memory: Tidal Memory on North Wall position 1;
  - Night Index: Night Index on West Wall position 1;
  - Spring Register: Archive Study on Wall A position 1.
- **Tasks:** exactly seven tasks:
  - STILL / MOVING: Patch and paint walls (wall_prep, done), Focus track lights (lighting,
    in_progress, due 2026-10-15), Print title vinyl (labeling, todo, due 2026-10-18);
  - Tidal Memory: Confirm loan crates (shipping, todo, due 2026-11-10), Approve lighting plan
    (lighting, todo, due 2026-11-17);
  - Night Index: Draw wall layout (wall_prep, todo, due 2027-01-10);
  - Spring Register: Final condition check (condition_check, done).
- **Activity:** at least six entries with fixed timestamps, including the STILL / MOVING opening
  transition, placement changes, and task updates. It must make the activity panel non-empty on first
  launch and must exercise more than one `entityType`.

Dashboard tests may freeze the system date or inject a clock, but seeds stay fixed so data comparison
is reproducible. Seed content is demo data and must never be described as live gallery data.

## 9. UI, accessibility, and state requirements

- Use semantic landmarks and a skip link. The primary navigation is keyboard reachable and marks the
  current section with `aria-current="page"`.
- Every input has a visible, persistent label. Helper and error text use stable IDs referenced by
  `aria-describedby`. Validation summaries and mutation success use an appropriate live region.
- Required fields are identified in text. Focus moves to the first invalid field or error summary
  after failed submission. Error text does not rely on color alone.
- Dialogs/menus support Escape, return focus to their trigger, and trap focus while modal. Native
  disclosure elements are preferred where possible.
- Tables have captions or labeled regions, real header cells, and horizontal-safe wrappers. At narrow
  widths information becomes stacked cards rather than clipping.
- Loading state uses text and `aria-busy`; do not render fake rows as if they were data. Empty state
  explains why it is empty and offers the next action. Error state exposes retry. Pending actions are
  disabled and announce progress.
- Status, readiness, conflicts, and overdue state always include readable text or a text alternative.
  Decorative lucide icons are `aria-hidden`.
- Layout is usable at 360 px, tablet, and desktop widths. Touch targets are at least 44 px in
  interactive rows. Respect reduced-motion preferences.
- Date-only values are parsed as calendar dates so they do not shift in negative UTC offsets. Display
  dates in a consistent, human-readable format while submitting exact ISO strings.
- Export and destructive actions provide success/failure feedback and confirm destructive intent.
- UI error parsing uses `normalizeErrorResponse`; a malformed network response still produces a
  friendly retryable message.

## 10. Test strategy

**Unit and component tests (`npm test`, Vitest + jsdom)**

- Shared HTTP guards and normalizers accept valid envelopes and degrade malformed/network values.
- A test verifies the transition map rejects terminal, backward, and same-status moves.
- Components cover keyboard input, field errors, pending/success/empty/error states, and accessible
  names rather than markup snapshots. Fetch boundaries may be mocked in unit tests, but domain results
  must use typed fixtures from the shared contract.
- Readiness and date overlap calculations receive boundary tests for equal endpoints, one-day gaps,
  no tasks, no artworks, and overdue/conflict states.

**Integration tests (`npm run test:integration`, Vitest + real SQLite)**

- Build the Elysia app against the deterministic file at `DATABASE_PATH` with no mocked database.
- Verify schema/seed idempotence, close/reopen persistence, aggregate dashboard data, list filtering
  and pagination, strict validation envelopes, and 404 behavior.
- Verify schedule conflicts on create/update, cross-exhibition artwork conflicts, same-exhibition slot
  duplication, retired artwork rules, and rollback/no audit on failure.
- Verify every legal transition, rejection of every illegal path, status audit content, task and
  placement lifecycle, and CSV quoting/order/content.
- Each suite must isolate data transactions or reset its known test file. Tests are deterministic and
  require no external services.

**Browser tests (`npm run test:e2e`, Playwright Chromium)**

- `test:e2e` runs `npm run build` first. Playwright starts the bundled production server itself.
- The server uses `.tmp/wallwise-e2e.sqlite` under `NODE_ENV=test`, `HOST=127.0.0.1`, and `PORT=4173`.
  `start:e2e` removes old SQLite/WAL/SHM files so each browser run starts from the same seed.
- The readiness check is `GET http://127.0.0.1:4173/api/health`.
- Cover one complete real workflow: dashboard -> create artist -> create artwork -> create exhibition
  -> add placement -> add/complete task -> legal transition -> export CSV. Also prove that a
  conflicting create surfaces the related show and leaves the list unchanged.
- Use accessible roles/labels instead of brittle CSS selectors. Assert loading/empty/error states where
  feasible. No browser test may mock API payloads.

**CI gates in required order**

`npm ci`; install Playwright Chromium; `npm run lint`; `npm run format:check`; `npm run typecheck`;
`npm test`; `npm run test:integration`; `npm run build`; `npm run test:e2e`. All gates run on pushes
and pull requests with Node 20 and deterministic test database paths.

## 11. Known limitations

- Wallwise is a single-gallery desk with no authentication, user accounts, roles, or actor names in the
  audit record. It must not be exposed as a public multi-tenant service without adding that layer.
- Artwork imagery and file uploads are out of scope; records contain metadata only.
- The space model uses named spaces, walls, and ordered positions. It does not provide a drag-and-drop
  floor plan, dimension-aware wall capacity, or installation elevation calculations.
- Conflicts model dates and artwork occupancy only. Shipping, crating, insurance availability, loans,
  conservation holds, and lighting constraints are not tracked.
- SQLite and one Node process are intentional. There is no real-time multi-user presence or remote
  synchronization; WAL and immediate write transactions protect local consistency.
- CSV export is one exhibition portfolio sheet. Import, accounting export, and custom column selection
  are not included.
- Artists and artworks use archive/retire rather than destructive deletion. Exhibitions are retained and
  cancelled or closed; tasks and placements can be deleted while their audit history remains.
- Seed dates are a fixed demo fixture and are not automatically shifted to the current year.
