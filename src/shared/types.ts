/**
 * Authoritative Wallwise HTTP API contract.
 *
 * Dates without times use `YYYY-MM-DD` (`IsoDate`). Timestamps use ISO 8601 UTC
 * strings (`IsoTimestamp`). API IDs are opaque strings, including in seeded data.
 *
 * Nullable fields are present when they have no value unless an input marks them
 * optional. Create and update inputs are not persistence records: the server owns
 * defaults, validation, and generated IDs/timestamps.
 */

export type EntityId = string;
export type IsoDate = string;
export type IsoTimestamp = string;

export type ArtistStatus = 'active' | 'archived';
export type ArtworkStatus = 'available' | 'reserved' | 'retired';
export type ExhibitionStatus = 'draft' | 'planned' | 'installing' | 'open' | 'closed' | 'cancelled';
export type TaskStatus = 'todo' | 'in_progress' | 'done';
export type TaskCategory =
  'wall_prep' | 'lighting' | 'hanging' | 'labeling' | 'condition_check' | 'shipping' | 'other';
export type ActivityEntityType = 'artist' | 'artwork' | 'exhibition' | 'placement' | 'task';
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'status_changed' | 'seeded';
export type ReadinessState = 'ready' | 'attention' | 'blocked';
export type ConflictType = 'exhibition_space' | 'installation_space' | 'artwork_double_booking';
export type SortDirection = 'asc' | 'desc';

export interface ArtistSummary {
  id: EntityId;
  name: string;
  status: ArtistStatus;
}

export interface Artist {
  id: EntityId;
  name: string;
  email: string | null;
  bio: string | null;
  status: ArtistStatus;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ArtworkSummary {
  id: EntityId;
  artistId: EntityId;
  title: string;
  medium: string;
  year: number | null;
  widthCm: number | null;
  heightCm: number | null;
  framed: boolean;
  status: ArtworkStatus;
  artist: ArtistSummary;
}

/** Artwork list/detail records always embed their artist summary. */
export interface Artwork extends ArtworkSummary {
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ExhibitionDerived {
  artworkCount: number;
  placedArtworkCount: number;
  taskCount: number;
  completedTaskCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  conflictCount: number;
  readinessPercent: number;
  readinessState: ReadinessState;
}

export interface Exhibition {
  id: EntityId;
  title: string;
  subtitle: string | null;
  space: string;
  startDate: IsoDate;
  endDate: IsoDate;
  installStart: IsoDate;
  installEnd: IsoDate;
  status: ExhibitionStatus;
  curator: string | null;
  notes: string | null;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
  derived: ExhibitionDerived;
}

export interface Placement {
  id: EntityId;
  exhibitionId: EntityId;
  artworkId: EntityId;
  wall: string;
  position: number;
  label: string | null;
  notes: string | null;
  createdAt: IsoTimestamp;
  artwork: ArtworkSummary;
}

export interface InstallationTask {
  id: EntityId;
  exhibitionId: EntityId;
  title: string;
  category: TaskCategory;
  assignee: string | null;
  dueDate: IsoDate | null;
  status: TaskStatus;
  createdAt: IsoTimestamp;
  updatedAt: IsoTimestamp;
}

export interface ActivityEntry {
  id: EntityId;
  entityType: ActivityEntityType;
  entityId: EntityId;
  action: ActivityAction;
  detail: string;
  createdAt: IsoTimestamp;
}

export interface ConflictWarning {
  type: ConflictType;
  message: string;
  exhibitionId: EntityId;
  exhibitionTitle: string;
  relatedExhibitionId: EntityId;
  relatedExhibitionTitle: string;
  artworkId?: EntityId;
  artworkTitle?: string;
}

export interface ConflictErrorDetails {
  conflicts: ConflictWarning[];
}

/** Detail payload for an exhibition, including its hang, task, audit, and conflict state. */
export interface ExhibitionDetail extends Exhibition {
  placements: Placement[];
  tasks: InstallationTask[];
  activity: ActivityEntry[];
  conflicts: ConflictWarning[];
}

export interface DashboardTotals {
  artists: number;
  activeArtists: number;
  artworks: number;
  availableArtworks: number;
  exhibitions: number;
  scheduledExhibitions: number;
  placements: number;
  openTasks: number;
}

export interface DashboardStatusCounts {
  artists: Record<ArtistStatus, number>;
  artworks: Record<ArtworkStatus, number>;
  exhibitions: Record<ExhibitionStatus, number>;
  tasks: Record<TaskStatus, number>;
}

export interface UpcomingExhibition {
  id: EntityId;
  title: string;
  space: string;
  startDate: IsoDate;
  endDate: IsoDate;
  installStart: IsoDate;
  installEnd: IsoDate;
  status: ExhibitionStatus;
  readinessPercent: number;
  readinessState: ReadinessState;
  conflictCount: number;
}

export interface ReadinessRow {
  exhibitionId: EntityId;
  title: string;
  space: string;
  status: ExhibitionStatus;
  startDate: IsoDate;
  endDate: IsoDate;
  artworkCount: number;
  placedArtworkCount: number;
  taskCount: number;
  completedTaskCount: number;
  openTaskCount: number;
  overdueTaskCount: number;
  conflictCount: number;
  readinessPercent: number;
  readinessState: ReadinessState;
}

export interface DashboardSummary {
  totals: DashboardTotals;
  statusCounts: DashboardStatusCounts;
  upcomingExhibitions: UpcomingExhibition[];
  readinessRows: ReadinessRow[];
  overdueTaskCount: number;
  conflictWarningCount: number;
  recentActivity: ActivityEntry[];
  generatedAt: IsoTimestamp;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  field?: string;
  details?: unknown;
}

export interface ErrorResponse {
  error: ApiErrorBody;
}

export type ApiResult<T> = { ok: true; data: T } | { ok: false; error: ApiErrorBody };

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface ListResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface DetailResponse<T> {
  data: T;
}

export interface MutationResponse<T> {
  data: T;
  message: string;
  activity?: ActivityEntry;
}

export interface DeletedEntity {
  id: EntityId;
}

export type DeleteResponse = MutationResponse<DeletedEntity>;

export interface HealthResponse {
  status: 'ok';
  database: 'up';
  seedVersion: number | null;
  timestamp: IsoTimestamp;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
}

export interface ArtistListQuery extends PaginationQuery {
  search?: string;
  status?: ArtistStatus;
  sort?: 'name' | 'createdAt' | 'updatedAt';
  direction?: SortDirection;
}

export interface ArtworkListQuery extends PaginationQuery {
  search?: string;
  artistId?: EntityId;
  status?: ArtworkStatus;
  sort?: 'title' | 'artist' | 'createdAt' | 'updatedAt';
  direction?: SortDirection;
}

export interface ExhibitionListQuery extends PaginationQuery {
  search?: string;
  status?: ExhibitionStatus;
  space?: string;
  from?: IsoDate;
  to?: IsoDate;
  sort?: 'startDate' | 'endDate' | 'title' | 'updatedAt';
  direction?: SortDirection;
}

export interface TaskListQuery extends PaginationQuery {
  exhibitionId?: EntityId;
  status?: TaskStatus;
  category?: TaskCategory;
  overdue?: boolean;
  sort?: 'dueDate' | 'createdAt' | 'updatedAt';
  direction?: SortDirection;
}

export interface ActivityListQuery extends PaginationQuery {
  entityType?: ActivityEntityType;
  entityId?: EntityId;
  limit?: number;
}

export interface CreateArtistInput {
  name: string;
  email?: string | null;
  bio?: string | null;
  status?: ArtistStatus;
}

export type UpdateArtistInput = Partial<CreateArtistInput>;

export interface CreateArtworkInput {
  artistId: EntityId;
  title: string;
  medium: string;
  year?: number | null;
  widthCm?: number | null;
  heightCm?: number | null;
  framed?: boolean;
  status?: ArtworkStatus;
}

export type UpdateArtworkInput = Partial<CreateArtworkInput>;

export interface CreateExhibitionInput {
  title: string;
  subtitle?: string | null;
  space: string;
  startDate: IsoDate;
  endDate: IsoDate;
  installStart: IsoDate;
  installEnd: IsoDate;
  curator?: string | null;
  notes?: string | null;
}

export type UpdateExhibitionInput = Partial<CreateExhibitionInput>;

export interface CreatePlacementInput {
  exhibitionId: EntityId;
  artworkId: EntityId;
  wall: string;
  position: number;
  label?: string | null;
  notes?: string | null;
}

export type UpdatePlacementInput = Partial<
  Omit<CreatePlacementInput, 'exhibitionId' | 'artworkId'>
>;

export interface CreateTaskInput {
  title: string;
  category: TaskCategory;
  assignee?: string | null;
  dueDate?: IsoDate | null;
  status?: TaskStatus;
}

export type UpdateTaskInput = Partial<CreateTaskInput>;

export interface ExhibitionTransitionRequest {
  to: ExhibitionStatus;
  note?: string | null;
}

export interface ExhibitionExportRow {
  exhibitionId: EntityId;
  title: string;
  subtitle: string | null;
  status: ExhibitionStatus;
  space: string;
  startDate: IsoDate;
  endDate: IsoDate;
  installStart: IsoDate;
  installEnd: IsoDate;
  curator: string | null;
  artworkCount: number;
  placedArtworkCount: number;
  taskCount: number;
  completedTaskCount: number;
  openTaskCount: number;
  readinessPercent: number;
  conflictCount: number;
  updatedAt: IsoTimestamp;
}

export type ArtistListResponse = ListResponse<Artist>;
export type ArtistDetailResponse = DetailResponse<Artist>;
export type ArtistMutationResponse = MutationResponse<Artist>;

export type ArtworkListResponse = ListResponse<Artwork>;
export type ArtworkDetailResponse = DetailResponse<Artwork>;
export type ArtworkMutationResponse = MutationResponse<Artwork>;

export type ExhibitionListResponse = ListResponse<Exhibition>;
export type ExhibitionDetailResponse = DetailResponse<ExhibitionDetail>;
export type ExhibitionMutationResponse = MutationResponse<Exhibition>;

export type PlacementMutationResponse = MutationResponse<Placement>;
export type TaskMutationResponse = MutationResponse<InstallationTask>;
export type TaskListResponse = ListResponse<InstallationTask>;
export type ActivityListResponse = ListResponse<ActivityEntry>;
export type DashboardResponse = DetailResponse<DashboardSummary>;
