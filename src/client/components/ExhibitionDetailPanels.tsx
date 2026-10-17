import { ClipboardList, History, Pencil, Plus, Trash2, Wrench, X } from 'lucide-react';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { FormEvent, RefObject } from 'react';

import { isApiClientError, listArtworks } from '../api';
import {
  EXHIBITION_STATUS_TRANSITIONS,
  FIELD_LIMITS,
  ISO_DATE_PATTERN,
  MAX_PAGE_SIZE,
  TASK_CATEGORIES,
  TASK_CATEGORY_LABELS,
  TASK_STATUSES,
} from '../../shared/constants';
import { isRecord } from '../../shared/http';
import type {
  ActivityEntry,
  Artwork,
  ConflictType,
  ConflictWarning,
  CreatePlacementInput,
  CreateTaskInput,
  ExhibitionDetail,
  ExhibitionStatus,
  InstallationTask,
  Placement,
  TaskCategory,
  TaskStatus,
  UpdateExhibitionInput,
  UpdateTaskInput,
} from '../../shared/types';
import {
  cn,
  focusFirstInvalid,
  formatDate,
  formatTimestamp,
  statusLabel,
  taskCategoryLabel,
} from '../utils';
import { EmptyState, InlineNotice, LoadingState } from './Feedback';
import { StatusBadge } from './StatusBadge';

const MAX_POSITION = 1_000_000;
const DEFAULT_TASK_CATEGORY: TaskCategory = 'wall_prep';
const DEFAULT_TASK_STATUS: TaskStatus = 'todo';

const CONFLICT_TYPE_LABELS: Readonly<Record<ConflictType, string>> = {
  exhibition_space: 'Exhibition dates conflict',
  installation_space: 'Installation window conflict',
  artwork_double_booking: 'Artwork double-booked',
};

const CONFLICT_TYPES = [
  'exhibition_space',
  'installation_space',
  'artwork_double_booking',
] as const satisfies readonly ConflictType[];

const TRANSITION_LABELS: Readonly<Record<ExhibitionStatus, string>> = {
  draft: 'Return to draft',
  planned: 'Plan exhibition',
  installing: 'Begin installation',
  open: 'Open exhibition',
  closed: 'Close exhibition',
  cancelled: 'Cancel exhibition',
};

const ACTIVITY_ACTION_LABELS = {
  created: 'Created',
  updated: 'Updated',
  deleted: 'Deleted',
  status_changed: 'Status changed',
  seeded: 'Seed history',
} as const;

const ACTIVITY_ENTITY_LABELS = {
  artist: 'Artist',
  artwork: 'Artwork',
  exhibition: 'Exhibition',
  placement: 'Placement',
  task: 'Task',
} as const;

interface TextFieldProps {
  className?: string;
  disabled?: boolean;
  error?: string;
  hint?: string;
  id: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  label: string;
  maxLength?: number;
  min?: number;
  name?: string;
  onChange: (value: string) => void;
  required?: boolean;
  step?: number;
  type?: 'date' | 'number' | 'text';
  value: string;
}

function TextField({
  className,
  disabled = false,
  error,
  hint,
  id,
  inputRef,
  label,
  maxLength,
  min,
  name,
  onChange,
  required = false,
  step,
  type = 'text',
  value,
}: TextFieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter((value): value is string => value !== undefined);

  return (
    <div className={cn('field', className)}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <input
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(' ')}
        aria-invalid={error === undefined ? undefined : true}
        aria-label={label}
        disabled={disabled}
        id={id}
        maxLength={maxLength}
        min={min}
        name={name}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        ref={inputRef}
        required={required}
        step={step}
        type={type}
        value={value}
      />
      {hint === undefined ? null : (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

interface TextAreaFieldProps {
  className?: string;
  disabled?: boolean;
  error?: string;
  hint?: string;
  id: string;
  label: string;
  maxLength?: number;
  name?: string;
  onChange: (value: string) => void;
  required?: boolean;
  rows?: number;
  value: string;
}

function TextAreaField({
  className,
  disabled = false,
  error,
  hint,
  id,
  label,
  maxLength,
  name,
  onChange,
  required = false,
  rows,
  value,
}: TextAreaFieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter((value): value is string => value !== undefined);

  return (
    <div className={cn('field', className)}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <textarea
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(' ')}
        aria-invalid={error === undefined ? undefined : true}
        aria-label={label}
        disabled={disabled}
        id={id}
        maxLength={maxLength}
        name={name}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        required={required}
        rows={rows}
        value={value}
      />
      {hint === undefined ? null : (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

interface SelectOption {
  disabled?: boolean;
  label: string;
  value: string;
}

interface SelectFieldProps {
  className?: string;
  disabled?: boolean;
  error?: string;
  hint?: string;
  id: string;
  label: string;
  name?: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  placeholder?: string;
  required?: boolean;
  value: string;
}

function SelectField({
  className,
  disabled = false,
  error,
  hint,
  id,
  label,
  name,
  onChange,
  options,
  placeholder,
  required = false,
  value,
}: SelectFieldProps) {
  const hintId = hint === undefined ? undefined : `${id}-hint`;
  const errorId = error === undefined ? undefined : `${id}-error`;
  const describedBy = [hintId, errorId].filter((item): item is string => item !== undefined);

  return (
    <div className={cn('field', className)}>
      <label className="field__label" htmlFor={id}>
        {label}
        {required ? (
          <span className="field__required" aria-hidden="true">
            *
          </span>
        ) : null}
      </label>
      <select
        aria-describedby={describedBy.length === 0 ? undefined : describedBy.join(' ')}
        aria-invalid={error === undefined ? undefined : true}
        aria-label={label}
        disabled={disabled}
        id={id}
        name={name}
        onChange={(event) => {
          onChange(event.currentTarget.value);
        }}
        required={required}
        value={value}
      >
        {placeholder === undefined ? null : <option value="">{placeholder}</option>}
        {options.map((option) => (
          <option disabled={option.disabled} key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint === undefined ? null : (
        <p className="field__hint" id={hintId}>
          {hint}
        </p>
      )}
      {error === undefined ? null : (
        <p className="field__error" id={errorId}>
          {error}
        </p>
      )}
    </div>
  );
}

function apiErrorMessage(error: unknown): string {
  if (isApiClientError(error)) {
    return error.message;
  }

  if (isRecord(error)) {
    if (isRecord(error.error) && typeof error.error.message === 'string') {
      return error.error.message;
    }
    if (typeof error.message === 'string' && error.message.trim().length > 0) {
      return error.message;
    }
  }

  return 'The request could not be completed. Review the details and try again.';
}

function apiErrorCode(error: unknown): string | null {
  if (isApiClientError(error)) {
    return error.code;
  }

  if (isRecord(error)) {
    if (isRecord(error.error) && typeof error.error.code === 'string') {
      return error.error.code;
    }
    if (typeof error.code === 'string') {
      return error.code;
    }
  }

  return null;
}

function apiErrorField(error: unknown): string | null {
  if (isApiClientError(error)) {
    return error.field ?? null;
  }

  if (isRecord(error)) {
    if (isRecord(error.error) && typeof error.error.field === 'string') {
      return error.error.field;
    }
    if (typeof error.field === 'string') {
      return error.field;
    }
  }

  return null;
}

function apiErrorDetails(error: unknown): unknown {
  if (isApiClientError(error)) {
    return error.details;
  }

  if (isRecord(error)) {
    if (error.details !== undefined) {
      return error.details;
    }
    if (isRecord(error.error) && error.error.details !== undefined) {
      return error.error.details;
    }
    if (isRecord(error.response) && isRecord(error.response.error)) {
      return error.response.error.details;
    }
  }

  return undefined;
}

function isConflictWarning(value: unknown): value is ConflictWarning {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.type === 'string' &&
    (CONFLICT_TYPES as readonly string[]).includes(value.type) &&
    typeof value.message === 'string' &&
    typeof value.exhibitionId === 'string' &&
    typeof value.exhibitionTitle === 'string' &&
    typeof value.relatedExhibitionId === 'string' &&
    typeof value.relatedExhibitionTitle === 'string' &&
    (value.artworkId === undefined || typeof value.artworkId === 'string') &&
    (value.artworkTitle === undefined || typeof value.artworkTitle === 'string')
  );
}

function conflictsFromError(error: unknown): ConflictWarning[] {
  const details = apiErrorDetails(error);
  if (!isRecord(details) || !Array.isArray(details.conflicts)) {
    return [];
  }

  return details.conflicts.filter(isConflictWarning);
}

function confirmAction(message: string): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') {
    return false;
  }

  return window.confirm(message);
}

function focusFieldLater(formRef: RefObject<HTMLFormElement | null>, field?: string | null): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.setTimeout(() => {
    focusFirstInvalid(formRef.current, field ?? null);
  }, 0);
}

function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE_PATTERN.test(value)) {
    return false;
  }

  const year = Number.parseInt(value.slice(0, 4), 10);
  const month = Number.parseInt(value.slice(5, 7), 10);
  const day = Number.parseInt(value.slice(8, 10), 10);
  const parsed = new Date(Date.UTC(year, month - 1, day));

  if (year >= 0 && year <= 99) {
    parsed.setUTCFullYear(year);
  }

  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

function ConflictItems({ conflicts }: { conflicts: readonly ConflictWarning[] }) {
  return (
    <ul className="conflict-list">
      {conflicts.map((conflict, index) => (
        <li
          className="conflict-item"
          key={`${conflict.type}-${conflict.relatedExhibitionId}-${index}`}
        >
          <p className="conflict-item__title">
            {CONFLICT_TYPE_LABELS[conflict.type]}: {conflict.relatedExhibitionTitle}
          </p>
          <p>{conflict.message}</p>
          <p className="small">
            Related show: <strong>{conflict.relatedExhibitionTitle}</strong>
            {conflict.artworkTitle === undefined ? null : (
              <>
                {' '}
                · Artwork: <strong>{conflict.artworkTitle}</strong>
              </>
            )}
          </p>
        </li>
      ))}
    </ul>
  );
}

export interface ConflictPanelProps {
  conflicts: readonly ConflictWarning[];
  exhibitionStatus: ExhibitionStatus;
}

export function ConflictPanel({ conflicts, exhibitionStatus }: ConflictPanelProps) {
  const headingId = useId();
  const hasConflicts = conflicts.length > 0;
  const terminalNote =
    exhibitionStatus === 'cancelled'
      ? 'This show is cancelled. Its placements, tasks, and activity remain visible as history, and cancelled shows are excluded from active conflict checks.'
      : exhibitionStatus === 'closed'
        ? 'This show is closed. Its record and history remain visible; the notices below reflect only conflicts returned by the current API detail.'
        : 'Active checks cover exhibition dates, installation windows, and artwork assignments across non-cancelled shows.';

  return (
    <section
      aria-labelledby={headingId}
      aria-live={hasConflicts ? 'assertive' : undefined}
      className={cn('card', hasConflicts && 'card--feature')}
      role={hasConflicts ? 'alert' : undefined}
    >
      <header className="card__header">
        <div className="card__header-copy">
          <p className="card__eyebrow">Risk / conflicts</p>
          <h2 className="card__title" id={headingId}>
            {hasConflicts
              ? `${conflicts.length} active conflict${conflicts.length === 1 ? '' : 's'} need attention`
              : 'No active conflicts'}
          </h2>
          <p className="card__subtitle">
            {hasConflicts
              ? 'Resolve the named schedule or artwork overlap before opening the show.'
              : 'Wallwise reported no overlapping show dates, installation windows, or artwork assignments.'}
          </p>
        </div>
        <StatusBadge
          label={hasConflicts ? 'Needs attention' : 'Clear'}
          status={hasConflicts ? 'blocked' : 'ready'}
        />
      </header>
      <div className="card__body stack--tight">
        {hasConflicts ? <ConflictItems conflicts={conflicts} /> : null}
        <p className="small muted">{terminalNote}</p>
      </div>
    </section>
  );
}

interface EditExhibitionValues {
  curator: string;
  endDate: string;
  installEnd: string;
  installStart: string;
  notes: string;
  space: string;
  startDate: string;
  subtitle: string;
  title: string;
}

type EditExhibitionField = keyof EditExhibitionValues;
type EditExhibitionErrors = Partial<Record<EditExhibitionField, string>>;

const EDIT_EXHIBITION_FIELDS = [
  'title',
  'subtitle',
  'space',
  'startDate',
  'endDate',
  'installStart',
  'installEnd',
  'curator',
  'notes',
] as const satisfies readonly EditExhibitionField[];

function editValuesFromDetail(detail: ExhibitionDetail): EditExhibitionValues {
  return {
    title: detail.title,
    subtitle: detail.subtitle ?? '',
    space: detail.space,
    startDate: detail.startDate,
    endDate: detail.endDate,
    installStart: detail.installStart,
    installEnd: detail.installEnd,
    curator: detail.curator ?? '',
    notes: detail.notes ?? '',
  };
}

function isEditExhibitionField(value: string | null): value is EditExhibitionField {
  if (value === null) {
    return false;
  }

  const normalized = value.toLowerCase();
  return EDIT_EXHIBITION_FIELDS.some((field) => field.toLowerCase() === normalized);
}

function validateEditExhibition(values: EditExhibitionValues): EditExhibitionErrors {
  const errors: EditExhibitionErrors = {};
  const title = values.title.trim();
  const subtitle = values.subtitle.trim();
  const space = values.space.trim();
  const curator = values.curator.trim();
  const notes = values.notes.trim();

  if (title.length === 0) {
    errors.title = 'Title is required.';
  } else if (title.length > FIELD_LIMITS.exhibitionTitle) {
    errors.title = `Title must be ${FIELD_LIMITS.exhibitionTitle} characters or fewer.`;
  }

  if (subtitle.length > FIELD_LIMITS.subtitle) {
    errors.subtitle = `Subtitle must be ${FIELD_LIMITS.subtitle} characters or fewer.`;
  }

  if (space.length === 0) {
    errors.space = 'Space is required.';
  } else if (space.length > FIELD_LIMITS.space) {
    errors.space = `Space must be ${FIELD_LIMITS.space} characters or fewer.`;
  }

  if (curator.length > FIELD_LIMITS.curator) {
    errors.curator = `Curator must be ${FIELD_LIMITS.curator} characters or fewer.`;
  }

  if (notes.length > FIELD_LIMITS.notes) {
    errors.notes = `Notes must be ${FIELD_LIMITS.notes} characters or fewer.`;
  }

  if (values.installStart.length === 0) {
    errors.installStart = 'Installation start is required.';
  } else if (!isValidIsoDate(values.installStart)) {
    errors.installStart = 'Enter a real calendar date.';
  }

  if (values.installEnd.length === 0) {
    errors.installEnd = 'Installation end is required.';
  } else if (!isValidIsoDate(values.installEnd)) {
    errors.installEnd = 'Enter a real calendar date.';
  }

  if (values.startDate.length === 0) {
    errors.startDate = 'Public opening date is required.';
  } else if (!isValidIsoDate(values.startDate)) {
    errors.startDate = 'Enter a real calendar date.';
  }

  if (values.endDate.length === 0) {
    errors.endDate = 'Public closing date is required.';
  } else if (!isValidIsoDate(values.endDate)) {
    errors.endDate = 'Enter a real calendar date.';
  }

  if (
    errors.installStart === undefined &&
    errors.installEnd === undefined &&
    values.installStart > values.installEnd
  ) {
    errors.installEnd = 'Installation end must be on or after installation start.';
  }

  if (
    errors.installEnd === undefined &&
    errors.startDate === undefined &&
    values.installEnd > values.startDate
  ) {
    errors.startDate = 'Public opening must be on or after installation end.';
  }

  if (
    errors.startDate === undefined &&
    errors.endDate === undefined &&
    values.startDate > values.endDate
  ) {
    errors.endDate = 'Public closing must be on or after public opening.';
  }

  return errors;
}

function editInputFromValues(values: EditExhibitionValues): UpdateExhibitionInput {
  const subtitle = values.subtitle.trim();
  const curator = values.curator.trim();
  const notes = values.notes.trim();

  return {
    title: values.title.trim(),
    subtitle: subtitle === '' ? null : subtitle,
    space: values.space.trim(),
    startDate: values.startDate,
    endDate: values.endDate,
    installStart: values.installStart,
    installEnd: values.installEnd,
    curator: curator === '' ? null : curator,
    notes: notes === '' ? null : notes,
  };
}

export interface ExhibitionEditPanelProps {
  detail: ExhibitionDetail;
  onClose: () => void;
  onSave: (input: UpdateExhibitionInput) => Promise<string>;
}

export function ExhibitionEditPanel({ detail, onClose, onSave }: ExhibitionEditPanelProps) {
  const panelId = useId();
  const headingId = `${panelId}-heading`;
  const prefix = `${panelId}-edit`;
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<EditExhibitionValues>(() => editValuesFromDetail(detail));
  const [errors, setErrors] = useState<EditExhibitionErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<ConflictWarning[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setValue = (field: EditExhibitionField, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => {
      if (current[field] === undefined) {
        return current;
      }
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextErrors = validateEditExhibition(values);
    setErrors(nextErrors);
    setSubmitError(null);
    setConflicts([]);
    setSuccess(null);

    const firstError = EDIT_EXHIBITION_FIELDS.find((field) => nextErrors[field] !== undefined);
    if (firstError !== undefined) {
      focusFieldLater(formRef, firstError);
      return;
    }

    setSaving(true);
    try {
      const message = await onSave(editInputFromValues(values));
      setSuccess(message);
    } catch (error: unknown) {
      const message = apiErrorMessage(error);
      setSubmitError(message);
      setConflicts(conflictsFromError(error));
      const field = apiErrorField(error);
      if (isEditExhibitionField(field)) {
        setErrors({ [field]: message });
      }
      focusFieldLater(formRef, field);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="card" aria-labelledby={headingId}>
      <header className="card__header">
        <div className="card__header-copy">
          <p className="card__eyebrow">Record / edit</p>
          <h2 className="card__title" id={headingId}>
            Edit exhibition
          </h2>
          <p className="card__subtitle">
            Lifecycle status is never editable here. Use the lifecycle controls to make a mapped
            transition with an audit note.
          </p>
        </div>
        <button
          aria-label="Close exhibition editor"
          className="icon-button"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" focusable="false" size={18} strokeWidth={1.8} />
        </button>
      </header>
      <form
        aria-busy={saving}
        className="card__body stack"
        noValidate
        onSubmit={(event) => {
          void handleSubmit(event);
        }}
        ref={formRef}
      >
        {submitError === null ? null : (
          <InlineNotice title="The exhibition was not saved" tone="error">
            <p>{submitError}</p>
            <p>Your edits are still here so you can review the named conflict and try again.</p>
            {conflicts.length === 0 ? null : <ConflictItems conflicts={conflicts} />}
          </InlineNotice>
        )}
        {success === null ? null : (
          <InlineNotice title="Exhibition saved" tone="success">
            {success}
          </InlineNotice>
        )}
        <div className="form-grid">
          <TextField
            className="field--full"
            error={errors.title}
            id={`${prefix}-title`}
            label="Title"
            maxLength={FIELD_LIMITS.exhibitionTitle}
            name="title"
            onChange={(value) => {
              setValue('title', value);
            }}
            required
            value={values.title}
          />
          <TextField
            className="field--full"
            error={errors.subtitle}
            id={`${prefix}-subtitle`}
            label="Subtitle"
            maxLength={FIELD_LIMITS.subtitle}
            name="subtitle"
            onChange={(value) => {
              setValue('subtitle', value);
            }}
            value={values.subtitle}
          />
          <TextField
            error={errors.space}
            id={`${prefix}-space`}
            label="Space"
            maxLength={FIELD_LIMITS.space}
            name="space"
            onChange={(value) => {
              setValue('space', value);
            }}
            required
            value={values.space}
          />
          <TextField
            error={errors.curator}
            id={`${prefix}-curator`}
            label="Curator"
            maxLength={FIELD_LIMITS.curator}
            name="curator"
            onChange={(value) => {
              setValue('curator', value);
            }}
            value={values.curator}
          />
          <TextField
            error={errors.installStart}
            id={`${prefix}-install-start`}
            label="Installation start"
            name="installStart"
            onChange={(value) => {
              setValue('installStart', value);
            }}
            required
            type="date"
            value={values.installStart}
          />
          <TextField
            error={errors.installEnd}
            id={`${prefix}-install-end`}
            label="Installation end"
            name="installEnd"
            onChange={(value) => {
              setValue('installEnd', value);
            }}
            required
            type="date"
            value={values.installEnd}
          />
          <TextField
            error={errors.startDate}
            id={`${prefix}-start-date`}
            label="Public opening"
            name="startDate"
            onChange={(value) => {
              setValue('startDate', value);
            }}
            required
            type="date"
            value={values.startDate}
          />
          <TextField
            error={errors.endDate}
            id={`${prefix}-end-date`}
            label="Public closing"
            name="endDate"
            onChange={(value) => {
              setValue('endDate', value);
            }}
            required
            type="date"
            value={values.endDate}
          />
          <TextAreaField
            className="field--full"
            error={errors.notes}
            hint={`${values.notes.trim().length} of ${FIELD_LIMITS.notes} characters`}
            id={`${prefix}-notes`}
            label="Notes"
            maxLength={FIELD_LIMITS.notes}
            name="notes"
            onChange={(value) => {
              setValue('notes', value);
            }}
            rows={3}
            value={values.notes}
          />
        </div>
        <p className="small muted">
          Dates must read installation start ≤ installation end ≤ public opening ≤ public closing. A
          space or date conflict leaves the saved record unchanged and keeps this form open.
        </p>
        <div className="form-actions">
          <button
            className="button button--ghost"
            disabled={saving}
            onClick={onClose}
            type="button"
          >
            Cancel
          </button>
          <button className="button button--primary" disabled={saving} type="submit">
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  );
}

function needsConfirmation(target: ExhibitionStatus): boolean {
  return target === 'open' || target === 'closed' || target === 'cancelled';
}

function transitionConfirmation(target: ExhibitionStatus, exhibitionTitle: string): string {
  if (target === 'open') {
    return `Open “${exhibitionTitle}”? This announces the public run and moves the show from installing to open.`;
  }

  if (target === 'closed') {
    return `Close “${exhibitionTitle}”? This is the final public-run transition; no further lifecycle changes will be available.`;
  }

  if (target === 'cancelled') {
    return `Cancel “${exhibitionTitle}”? The show will be excluded from future conflict checks, while its placements, tasks, and activity history remain.`;
  }

  return `Move “${exhibitionTitle}” to ${statusLabel(target)}?`;
}

export interface LifecyclePanelProps {
  currentStatus: ExhibitionStatus;
  exhibitionTitle: string;
  onTransition: (target: ExhibitionStatus, note: string | null) => Promise<string>;
}

export function LifecyclePanel({
  currentStatus,
  exhibitionTitle,
  onTransition,
}: LifecyclePanelProps) {
  const headingId = useId();
  const noteId = useId();
  const [note, setNote] = useState('');
  const [pendingTarget, setPendingTarget] = useState<ExhibitionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorConflicts, setErrorConflicts] = useState<ConflictWarning[]>([]);
  const [success, setSuccess] = useState<string | null>(null);
  const allowed = EXHIBITION_STATUS_TRANSITIONS[currentStatus];

  const handleTransition = async (target: ExhibitionStatus): Promise<void> => {
    if (
      needsConfirmation(target) &&
      !confirmAction(transitionConfirmation(target, exhibitionTitle))
    ) {
      return;
    }

    setPendingTarget(target);
    setError(null);
    setErrorConflicts([]);
    setSuccess(null);

    try {
      const message = await onTransition(target, note.trim() === '' ? null : note.trim());
      setSuccess(message);
      setNote('');
    } catch (transitionError: unknown) {
      setError(apiErrorMessage(transitionError));
      setErrorConflicts(conflictsFromError(transitionError));
    } finally {
      setPendingTarget(null);
    }
  };

  return (
    <section className="card" aria-labelledby={headingId}>
      <header className="card__header">
        <div className="card__header-copy">
          <p className="card__eyebrow">Lifecycle / audit</p>
          <h2 className="card__title" id={headingId}>
            Exhibition lifecycle
          </h2>
          <p className="card__subtitle">
            Only transitions in the Wallwise lifecycle map are offered from the current status.
          </p>
        </div>
        <StatusBadge status={currentStatus} />
      </header>
      <div className="card__body stack--tight">
        {error === null ? null : (
          <InlineNotice title="Status not changed" tone="error">
            <p>{error}</p>
            {errorConflicts.length === 0 ? null : <ConflictItems conflicts={errorConflicts} />}
            <p>Your transition note is still here. Review the current status and retry.</p>
          </InlineNotice>
        )}
        {success === null ? null : (
          <InlineNotice title="Lifecycle updated" tone="success">
            {success}
          </InlineNotice>
        )}
        <fieldset className="fieldset">
          <legend className="fieldset__legend">Change lifecycle status</legend>
          <div className="stack--tight">
            <TextAreaField
              disabled={pendingTarget !== null}
              hint="Optional, up to 500 characters. The note is preserved with the status entry in the append-only activity history."
              id={noteId}
              label="Transition note"
              maxLength={FIELD_LIMITS.transitionNote}
              name="transitionNote"
              onChange={setNote}
              rows={3}
              value={note}
            />
            {allowed.length === 0 ? (
              <p className="small muted">
                No further lifecycle transitions are available from {statusLabel(currentStatus)}.
              </p>
            ) : (
              <div className="cluster">
                {allowed.map((target) => {
                  const label = TRANSITION_LABELS[target];
                  return (
                    <button
                      aria-busy={pendingTarget === target}
                      className={cn(
                        'button',
                        target === 'cancelled'
                          ? 'button--danger'
                          : target === 'open'
                            ? 'button--primary'
                            : 'button--secondary',
                      )}
                      disabled={pendingTarget !== null}
                      key={target}
                      onClick={() => {
                        void handleTransition(target);
                      }}
                      type="button"
                    >
                      {pendingTarget === target ? `${label}…` : label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </fieldset>
        <p className="small muted">
          Opening, closing, and cancelling ask for confirmation. Every successful transition is
          written to the exhibition&apos;s status history.
        </p>
      </div>
    </section>
  );
}

interface PlacementValues {
  artworkId: string;
  label: string;
  notes: string;
  position: string;
  wall: string;
}

type PlacementField = keyof PlacementValues;
type PlacementErrors = Partial<Record<'artworkId' | 'label' | 'position' | 'wall', string>>;

const EMPTY_PLACEMENT_VALUES: PlacementValues = {
  artworkId: '',
  label: '',
  notes: '',
  position: '',
  wall: '',
};

function validatePlacement(values: PlacementValues): PlacementErrors {
  const errors: PlacementErrors = {};
  const wall = values.wall.trim();
  const position = values.position.trim();

  if (values.artworkId.length === 0) {
    errors.artworkId = 'Choose an artwork for this placement.';
  }

  if (wall.length === 0) {
    errors.wall = 'Wall is required.';
  } else if (wall.length > FIELD_LIMITS.wall) {
    errors.wall = `Wall must be ${FIELD_LIMITS.wall} characters or fewer.`;
  }

  if (position.length === 0) {
    errors.position = 'Position is required.';
  } else if (!/^\d+$/.test(position)) {
    errors.position = 'Position must be a whole number of 0 or greater.';
  } else {
    const parsed = Number(position);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_POSITION) {
      errors.position = `Position must be a whole number between 0 and ${MAX_POSITION}.`;
    }
  }

  if (values.label.trim().length > FIELD_LIMITS.placementLabel) {
    errors.label = `Label must be ${FIELD_LIMITS.placementLabel} characters or fewer.`;
  }

  return errors;
}

function placementConflictExplanation(
  error: unknown,
  placements: readonly Placement[],
  values: PlacementValues,
): string | null {
  if (apiErrorCode(error) !== 'PLACEMENT_CONFLICT') {
    return null;
  }

  const details = apiErrorDetails(error);
  const reason = isRecord(details) && typeof details.reason === 'string' ? details.reason : null;

  if (reason === 'duplicate_artwork') {
    const existing = placements.find((placement) => placement.artworkId === values.artworkId);
    return existing === undefined
      ? 'That artwork is already in this exhibition hang.'
      : `Existing placement: “${existing.artwork.title}” on ${existing.wall} at position ${existing.position}.`;
  }

  if (reason === 'duplicate_slot') {
    const wall = values.wall.trim();
    const position = Number(values.position);
    const existing = placements.find(
      (placement) =>
        placement.wall.toLowerCase() === wall.toLowerCase() && placement.position === position,
    );
    return existing === undefined
      ? 'That wall position is already occupied in this exhibition hang.'
      : `That slot currently holds “${existing.artwork.title}” (${existing.artwork.artist.name}).`;
  }

  return null;
}

type CatalogueResult =
  { kind: 'success'; artworks: Artwork[] } | { kind: 'error'; message: string };

async function requestArtworkCatalogue(signal: AbortSignal): Promise<CatalogueResult> {
  try {
    const [availableResponse, reservedResponse] = await Promise.all([
      listArtworks({ status: 'available', pageSize: MAX_PAGE_SIZE, sort: 'title' }, signal),
      listArtworks({ status: 'reserved', pageSize: MAX_PAGE_SIZE, sort: 'title' }, signal),
    ]);
    const byId = new Map<string, Artwork>();
    for (const artwork of [...availableResponse.data, ...reservedResponse.data]) {
      if (artwork.status === 'available' || artwork.status === 'reserved') {
        byId.set(artwork.id, artwork);
      }
    }
    const artworks = [...byId.values()].sort((left, right) =>
      left.title.localeCompare(right.title, 'en', { sensitivity: 'base' }),
    );
    return { kind: 'success', artworks };
  } catch (error: unknown) {
    return { kind: 'error', message: apiErrorMessage(error) };
  }
}

export interface PlacementPanelProps {
  exhibitionId: string;
  exhibitionTitle: string;
  onCreatePlacement: (input: CreatePlacementInput) => Promise<string>;
  onDeletePlacement: (placementId: string) => Promise<string>;
  placements: readonly Placement[];
}

export function PlacementPanel({
  exhibitionId,
  exhibitionTitle,
  onCreatePlacement,
  onDeletePlacement,
  placements,
}: PlacementPanelProps) {
  const headingId = useId();
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const artworkSelectRef = useRef<HTMLSelectElement>(null);
  const catalogueRequestRef = useRef<AbortController | null>(null);
  const [artworks, setArtworks] = useState<Artwork[]>([]);
  const [catalogueState, setCatalogueState] = useState<'error' | 'loading' | 'ready'>('loading');
  const [catalogueError, setCatalogueError] = useState<string | null>(null);
  const [values, setValues] = useState<PlacementValues>(EMPTY_PLACEMENT_VALUES);
  const [errors, setErrors] = useState<PlacementErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitConflicts, setSubmitConflicts] = useState<ConflictWarning[]>([]);
  const [conflictExplanation, setConflictExplanation] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);

  const loadCatalogue = useCallback(async (showLoading = true): Promise<void> => {
    const controller = new AbortController();
    catalogueRequestRef.current?.abort();
    catalogueRequestRef.current = controller;
    if (showLoading) {
      setCatalogueState('loading');
      setCatalogueError(null);
    }

    const result = await requestArtworkCatalogue(controller.signal);
    if (controller.signal.aborted) {
      return;
    }

    if (result.kind === 'success') {
      setArtworks(result.artworks);
      setCatalogueState('ready');
    } else {
      setCatalogueState('error');
      setCatalogueError(result.message);
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    catalogueRequestRef.current?.abort();
    catalogueRequestRef.current = controller;
    void requestArtworkCatalogue(controller.signal).then((result) => {
      if (controller.signal.aborted) {
        return;
      }

      if (result.kind === 'success') {
        setArtworks(result.artworks);
        setCatalogueState('ready');
      } else {
        setCatalogueState('error');
        setCatalogueError(result.message);
      }
    });

    return () => {
      controller.abort();
    };
  }, []);

  const setValue = (field: PlacementField, value: string): void => {
    setValues((current) => ({ ...current, [field]: value }));
    if (field === 'artworkId' || field === 'label' || field === 'position' || field === 'wall') {
      setErrors((current) => {
        if (current[field] === undefined) {
          return current;
        }
        const next = { ...current };
        delete next[field];
        return next;
      });
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextErrors = validatePlacement(values);
    setErrors(nextErrors);
    setSubmitError(null);
    setSubmitConflicts([]);
    setConflictExplanation(null);
    setSuccess(null);

    if (Object.keys(nextErrors).length > 0) {
      focusFieldLater(
        formRef,
        nextErrors.artworkId !== undefined
          ? 'artworkId'
          : nextErrors.wall !== undefined
            ? 'wall'
            : 'position',
      );
      return;
    }

    const selectedArtwork = artworks.find((artwork) => artwork.id === values.artworkId);
    const wall = values.wall.trim();
    const position = Number(values.position);
    const label = values.label.trim();
    const notes = values.notes.trim();
    setSaving(true);

    try {
      await onCreatePlacement({
        exhibitionId,
        artworkId: values.artworkId,
        wall,
        position,
        label: label === '' ? null : label,
        notes: notes === '' ? null : notes,
      });
      setSuccess(
        selectedArtwork === undefined
          ? 'Placement added to the hang.'
          : `${selectedArtwork.title} placed on ${wall} at position ${position}.`,
      );
      setValues(EMPTY_PLACEMENT_VALUES);
      setErrors({});
    } catch (error: unknown) {
      setSubmitError(apiErrorMessage(error));
      setSubmitConflicts(conflictsFromError(error));
      setConflictExplanation(placementConflictExplanation(error, placements, values));
      const field = apiErrorField(error);
      if (field === 'artworkId' || field === 'wall' || field === 'position') {
        setErrors({ [field]: apiErrorMessage(error) });
      }
      focusFieldLater(formRef, field);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (placement: Placement): Promise<void> => {
    const confirmed = confirmAction(
      `Remove “${placement.artwork.title}” from “${exhibitionTitle}”?\n\nThe wall slot and artwork will be freed immediately. The removal stays in the append-only activity history.`,
    );
    if (!confirmed) {
      return;
    }

    setRemovingId(placement.id);
    setSubmitError(null);
    setSubmitConflicts([]);
    setConflictExplanation(null);
    setSuccess(null);

    try {
      const message = await onDeletePlacement(placement.id);
      setSuccess(message);
    } catch (error: unknown) {
      setSubmitError(apiErrorMessage(error));
    } finally {
      setRemovingId(null);
    }
  };

  const artworkOptions = artworks.map((artwork) => ({
    label: `${artwork.title} — ${artwork.artist.name} (${statusLabel(artwork.status)})`,
    value: artwork.id,
  }));

  return (
    <section className="card" aria-labelledby={headingId}>
      <header className="card__header">
        <div className="card__header-copy">
          <p className="card__eyebrow">Hang / placements</p>
          <h2 className="card__title" id={headingId}>
            Hang plan
          </h2>
          <p className="card__subtitle">
            {placements.length === 0
              ? 'No works are assigned to the walls yet.'
              : `${placements.length} placement${placements.length === 1 ? '' : 's'} across the exhibition walls.`}
          </p>
        </div>
        <StatusBadge
          label={`${placements.length} placed`}
          status={placements.length === 0 ? 'attention' : 'available'}
        />
      </header>
      <div className="card__body stack">
        {catalogueState === 'loading' ? (
          <LoadingState compact label="Loading the artwork catalogue" />
        ) : null}
        {catalogueState === 'error' ? (
          <InlineNotice title="Artwork catalogue unavailable" tone="error">
            <p>{catalogueError}</p>
            <button
              className="button button--secondary button--small"
              onClick={() => {
                void loadCatalogue(true);
              }}
              type="button"
            >
              Retry catalogue
            </button>
          </InlineNotice>
        ) : null}
        {submitError === null ? null : (
          <InlineNotice title="Placement not added" tone="error">
            <p>{submitError}</p>
            {conflictExplanation === null ? null : <p>{conflictExplanation}</p>}
            {submitConflicts.length === 0 ? null : <ConflictItems conflicts={submitConflicts} />}
            <p>Your placement entries are still here.</p>
          </InlineNotice>
        )}
        {success === null ? null : (
          <InlineNotice title="Hang updated" tone="success">
            {success}
          </InlineNotice>
        )}
        {placements.length === 0 ? (
          <EmptyState
            action={
              <button
                className="button button--secondary"
                onClick={() => {
                  artworkSelectRef.current?.focus();
                }}
                type="button"
              >
                Add the first work
              </button>
            }
            icon={<Wrench size={25} strokeWidth={1.6} focusable="false" />}
            message="Choose an available or reserved artwork, then give it a wall and a non-negative position."
            title="The walls are still empty"
          />
        ) : (
          <div className="table-wrap">
            <table className="data-table data-table--stack">
              <caption>
                Hang placements ordered by wall and position. Removing a work keeps its audit
                history.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Artwork</th>
                  <th scope="col">Wall</th>
                  <th scope="col">Position</th>
                  <th scope="col">Label and notes</th>
                  <th scope="col">Artwork status</th>
                  <th className="data-table__actions" scope="col">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                {placements.map((placement) => (
                  <tr key={placement.id}>
                    <th data-label="Artwork" scope="row">
                      <p className="data-table__primary">{placement.artwork.title}</p>
                      <p className="data-table__secondary">{placement.artwork.artist.name}</p>
                    </th>
                    <td data-label="Wall">{placement.wall}</td>
                    <td className="data-table__numeric" data-label="Position">
                      {placement.position}
                    </td>
                    <td data-label="Label and notes">
                      {placement.label === null ? (
                        <p className="muted">No label</p>
                      ) : (
                        <p>{placement.label}</p>
                      )}
                      {placement.notes === null ? null : (
                        <p className="data-table__secondary">{placement.notes}</p>
                      )}
                    </td>
                    <td data-label="Artwork status">
                      <StatusBadge compact status={placement.artwork.status} />
                    </td>
                    <td className="data-table__actions" data-label="Actions">
                      <button
                        aria-busy={removingId === placement.id}
                        aria-label={`Remove ${placement.artwork.title} from the hang`}
                        className="button button--ghost button--small"
                        disabled={removingId !== null}
                        onClick={() => {
                          void handleRemove(placement);
                        }}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" focusable="false" size={16} strokeWidth={1.8} />
                        {removingId === placement.id ? 'Removing…' : 'Remove'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form
          aria-busy={saving}
          className="stack--tight"
          noValidate
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          ref={formRef}
        >
          <fieldset className="fieldset">
            <legend className="fieldset__legend">Add a placement</legend>
            <div className="form-grid">
              <SelectField
                className="field--full"
                disabled={catalogueState !== 'ready' || saving}
                error={errors.artworkId}
                hint="Only available and reserved artworks are offered. Retired works cannot be newly placed."
                id={`${prefix}-artwork`}
                label="Artwork"
                name="artworkId"
                onChange={(value) => {
                  setValue('artworkId', value);
                }}
                options={artworkOptions}
                placeholder={
                  catalogueState === 'loading'
                    ? 'Loading artwork catalogue…'
                    : catalogueState === 'error'
                      ? 'Artwork catalogue unavailable'
                      : artworkOptions.length === 0
                        ? 'No available or reserved artworks'
                        : 'Choose an artwork'
                }
                required
                value={values.artworkId}
              />
              <TextField
                disabled={saving}
                error={errors.wall}
                id={`${prefix}-wall`}
                label="Wall"
                maxLength={FIELD_LIMITS.wall}
                name="wall"
                onChange={(value) => {
                  setValue('wall', value);
                }}
                required
                value={values.wall}
              />
              <TextField
                disabled={saving}
                error={errors.position}
                id={`${prefix}-position`}
                label="Position"
                min={0}
                name="position"
                onChange={(value) => {
                  setValue('position', value);
                }}
                required
                step={1}
                type="number"
                value={values.position}
              />
              <TextField
                disabled={saving}
                error={errors.label}
                id={`${prefix}-label`}
                label="Label"
                maxLength={FIELD_LIMITS.placementLabel}
                name="label"
                onChange={(value) => {
                  setValue('label', value);
                }}
                value={values.label}
              />
              <TextAreaField
                className="field--full"
                disabled={saving}
                id={`${prefix}-notes`}
                label="Notes"
                maxLength={FIELD_LIMITS.notes}
                name="notes"
                onChange={(value) => {
                  setValue('notes', value);
                }}
                rows={2}
                value={values.notes}
              />
            </div>
          </fieldset>
          <div className="form-actions">
            <button
              className="button button--primary"
              disabled={saving || catalogueState !== 'ready'}
              type="submit"
            >
              <Plus aria-hidden="true" focusable="false" size={16} strokeWidth={1.9} />
              {saving ? 'Adding placement…' : 'Add placement'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

interface TaskFormValues {
  assignee: string;
  category: TaskCategory;
  dueDate: string;
  status: TaskStatus;
  title: string;
}

type TaskField = 'assignee' | 'category' | 'dueDate' | 'status' | 'title';
type TaskErrors = Partial<Record<TaskField, string>>;

const EMPTY_TASK_VALUES: TaskFormValues = {
  assignee: '',
  category: DEFAULT_TASK_CATEGORY,
  dueDate: '',
  status: DEFAULT_TASK_STATUS,
  title: '',
};

function taskValuesFromTask(task: InstallationTask): TaskFormValues {
  return {
    assignee: task.assignee ?? '',
    category: task.category,
    dueDate: task.dueDate ?? '',
    status: task.status,
    title: task.title,
  };
}

function validateTask(values: TaskFormValues): TaskErrors {
  const errors: TaskErrors = {};
  const title = values.title.trim();
  const assignee = values.assignee.trim();

  if (title.length === 0) {
    errors.title = 'Task title is required.';
  } else if (title.length > FIELD_LIMITS.taskTitle) {
    errors.title = `Task title must be ${FIELD_LIMITS.taskTitle} characters or fewer.`;
  }

  if (assignee.length > FIELD_LIMITS.assignee) {
    errors.assignee = `Assignee must be ${FIELD_LIMITS.assignee} characters or fewer.`;
  }

  if (values.dueDate.length > 0 && !isValidIsoDate(values.dueDate)) {
    errors.dueDate = 'Enter a real calendar date.';
  }

  return errors;
}

function taskCreateInput(values: TaskFormValues): CreateTaskInput {
  const assignee = values.assignee.trim();
  return {
    title: values.title.trim(),
    category: values.category,
    assignee: assignee === '' ? null : assignee,
    dueDate: values.dueDate === '' ? null : values.dueDate,
    status: values.status,
  };
}

function taskUpdateInput(values: TaskFormValues): UpdateTaskInput {
  const assignee = values.assignee.trim();
  return {
    title: values.title.trim(),
    category: values.category,
    assignee: assignee === '' ? null : assignee,
    dueDate: values.dueDate === '' ? null : values.dueDate,
  };
}

function isTaskStatus(value: string): value is TaskStatus {
  return (TASK_STATUSES as readonly string[]).includes(value);
}

function isTaskField(value: string | null): value is TaskField {
  return (
    value === 'title' ||
    value === 'category' ||
    value === 'assignee' ||
    value === 'dueDate' ||
    value === 'status'
  );
}

function isTaskOverdue(task: InstallationTask): boolean {
  if (task.dueDate === null || task.status === 'done') {
    return false;
  }

  return task.dueDate < new Date().toISOString().slice(0, 10);
}

interface TaskFieldsProps {
  errors: TaskErrors;
  includeStatus: boolean;
  onChange: (values: TaskFormValues) => void;
  prefix: string;
  titleInputRef?: RefObject<HTMLInputElement | null>;
  values: TaskFormValues;
}

function TaskFields({
  errors,
  includeStatus,
  onChange,
  prefix,
  titleInputRef,
  values,
}: TaskFieldsProps) {
  const categoryOptions = TASK_CATEGORIES.map((category) => ({
    label: TASK_CATEGORY_LABELS[category],
    value: category,
  }));
  const statusOptions = TASK_STATUSES.map((taskStatus) => ({
    label: statusLabel(taskStatus),
    value: taskStatus,
  }));

  return (
    <div className="form-grid">
      <TextField
        className="field--full"
        error={errors.title}
        id={`${prefix}-title`}
        inputRef={titleInputRef}
        label="Task title"
        maxLength={FIELD_LIMITS.taskTitle}
        name="title"
        onChange={(value) => {
          onChange({ ...values, title: value });
        }}
        required
        value={values.title}
      />
      <SelectField
        error={errors.category}
        id={`${prefix}-category`}
        label="Category"
        name="category"
        onChange={(value) => {
          const category = TASK_CATEGORIES.find((candidate) => candidate === value);
          if (category !== undefined) {
            onChange({ ...values, category });
          }
        }}
        options={categoryOptions}
        required
        value={values.category}
      />
      {includeStatus ? (
        <SelectField
          error={errors.status}
          id={`${prefix}-status`}
          label="Initial status"
          name="status"
          onChange={(value) => {
            if (isTaskStatus(value)) {
              onChange({ ...values, status: value });
            }
          }}
          options={statusOptions}
          required
          value={values.status}
        />
      ) : null}
      <TextField
        error={errors.assignee}
        id={`${prefix}-assignee`}
        label="Assignee"
        maxLength={FIELD_LIMITS.assignee}
        name="assignee"
        onChange={(value) => {
          onChange({ ...values, assignee: value });
        }}
        value={values.assignee}
      />
      <TextField
        error={errors.dueDate}
        hint="Optional. A task is overdue after this date unless it is done."
        id={`${prefix}-due-date`}
        label="Due date"
        name="dueDate"
        onChange={(value) => {
          onChange({ ...values, dueDate: value });
        }}
        type="date"
        value={values.dueDate}
      />
    </div>
  );
}

interface TaskEditFormProps {
  onCancel: () => void;
  onSaved: (message: string) => void;
  onUpdateTask: (taskId: string, input: UpdateTaskInput) => Promise<string>;
  task: InstallationTask;
}

function TaskEditForm({ onCancel, onSaved, onUpdateTask, task }: TaskEditFormProps) {
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<TaskFormValues>(() => taskValuesFromTask(task));
  const [errors, setErrors] = useState<TaskErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextErrors = validateTask(values);
    setErrors(nextErrors);
    setSubmitError(null);

    const firstError = (
      ['title', 'category', 'assignee', 'dueDate', 'status'] as const satisfies readonly TaskField[]
    ).find((field) => nextErrors[field] !== undefined);
    if (firstError !== undefined) {
      focusFieldLater(formRef, firstError);
      return;
    }

    setSaving(true);
    try {
      const message = await onUpdateTask(task.id, taskUpdateInput(values));
      onSaved(message);
    } catch (error: unknown) {
      const message = apiErrorMessage(error);
      setSubmitError(message);
      const field = apiErrorField(error);
      if (isTaskField(field)) {
        setErrors({ [field]: message });
      }
      focusFieldLater(formRef, field);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      aria-busy={saving}
      className="stack--tight"
      noValidate
      onSubmit={(event) => {
        void handleSubmit(event);
      }}
      ref={formRef}
    >
      {submitError === null ? null : (
        <InlineNotice title="Task not saved" tone="error">
          {submitError}
        </InlineNotice>
      )}
      <TaskFields
        errors={errors}
        includeStatus={false}
        onChange={(nextValues) => {
          setValues(nextValues);
          setErrors({});
        }}
        prefix={prefix}
        values={values}
      />
      <div className="form-actions">
        <button className="button button--ghost" disabled={saving} onClick={onCancel} type="button">
          Cancel edit
        </button>
        <button className="button button--primary" disabled={saving} type="submit">
          {saving ? 'Saving…' : 'Save task'}
        </button>
      </div>
    </form>
  );
}

interface TaskCardProps {
  onDeleteTask: (taskId: string) => Promise<string>;
  onDeleted: (message: string) => void;
  onUpdateTask: (taskId: string, input: UpdateTaskInput) => Promise<string>;
  task: InstallationTask;
}

function TaskCard({ onDeleteTask, onDeleted, onUpdateTask, task }: TaskCardProps) {
  const statusId = useId();
  const [pendingAction, setPendingAction] = useState<'delete' | 'status' | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const overdue = isTaskOverdue(task);
  const statusOptions = TASK_STATUSES.map((taskStatus) => ({
    label: statusLabel(taskStatus),
    value: taskStatus,
  }));

  const handleStatusChange = async (nextStatus: TaskStatus): Promise<void> => {
    if (nextStatus === task.status) {
      return;
    }

    setPendingAction('status');
    setError(null);
    setSuccess(null);
    try {
      const message = await onUpdateTask(task.id, { status: nextStatus });
      setSuccess(message);
    } catch (statusError: unknown) {
      setError(apiErrorMessage(statusError));
    } finally {
      setPendingAction(null);
    }
  };

  const handleDelete = async (): Promise<void> => {
    const confirmed = confirmAction(
      `Delete the task “${task.title}”?\n\nIt will leave the checklist, but its audit history remains in the activity log.`,
    );
    if (!confirmed) {
      return;
    }

    setPendingAction('delete');
    setError(null);
    setSuccess(null);
    try {
      const message = await onDeleteTask(task.id);
      onDeleted(message);
    } catch (deleteError: unknown) {
      setError(apiErrorMessage(deleteError));
    } finally {
      setPendingAction(null);
    }
  };

  return (
    <li className="card card--inset">
      <div className="card__body stack--tight">
        <div className="cluster cluster--between">
          <h3>{task.title}</h3>
          <StatusBadge status={task.status} />
        </div>
        <p className="small muted">
          {taskCategoryLabel(task.category)} · {task.assignee ?? 'Unassigned'} ·{' '}
          {task.dueDate === null ? 'No due date' : `Due ${formatDate(task.dueDate)}`}
          {overdue ? (
            <>
              {' '}
              · <span className="text-danger">Overdue</span>
            </>
          ) : null}
        </p>
        {error === null ? null : (
          <InlineNotice title="Task action failed" tone="error">
            {error}
          </InlineNotice>
        )}
        {success === null ? null : (
          <p aria-live="polite" className="small text-success" role="status">
            {success}
          </p>
        )}
        <div className="form-grid">
          <SelectField
            disabled={pendingAction !== null}
            hint="Changes save immediately and append a task activity entry."
            id={statusId}
            label="Status"
            name={`task-status-${task.id}`}
            onChange={(value) => {
              if (isTaskStatus(value)) {
                void handleStatusChange(value);
              }
            }}
            options={statusOptions}
            value={task.status}
          />
        </div>
        <div className="cluster cluster--end">
          <button
            className="button button--ghost button--small"
            disabled={pendingAction !== null}
            onClick={() => {
              setEditing((current) => !current);
              setError(null);
              setSuccess(null);
            }}
            type="button"
          >
            <Pencil aria-hidden="true" focusable="false" size={15} strokeWidth={1.8} />
            {editing ? 'Close editor' : 'Edit task'}
          </button>
          <button
            className="button button--ghost button--small"
            disabled={pendingAction !== null}
            onClick={() => {
              void handleDelete();
            }}
            type="button"
          >
            <Trash2 aria-hidden="true" focusable="false" size={15} strokeWidth={1.8} />
            {pendingAction === 'delete' ? 'Deleting…' : 'Delete task'}
          </button>
        </div>
        {editing ? (
          <TaskEditForm
            onCancel={() => {
              setEditing(false);
            }}
            onSaved={(message) => {
              setEditing(false);
              setSuccess(message);
            }}
            onUpdateTask={onUpdateTask}
            task={task}
          />
        ) : null}
      </div>
    </li>
  );
}

type TaskCreateErrors = TaskErrors;

export interface TaskPanelProps {
  derived: ExhibitionDetail['derived'];
  onCreateTask: (input: CreateTaskInput) => Promise<string>;
  onDeleteTask: (taskId: string) => Promise<string>;
  onUpdateTask: (taskId: string, input: UpdateTaskInput) => Promise<string>;
  tasks: readonly InstallationTask[];
}

export function TaskPanel({
  derived,
  onCreateTask,
  onDeleteTask,
  onUpdateTask,
  tasks,
}: TaskPanelProps) {
  const headingId = useId();
  const prefix = useId();
  const formRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const [values, setValues] = useState<TaskFormValues>(EMPTY_TASK_VALUES);
  const [errors, setErrors] = useState<TaskCreateErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextErrors = validateTask(values);
    setErrors(nextErrors);
    setSubmitError(null);
    setSuccess(null);

    const firstError = (
      ['title', 'category', 'assignee', 'dueDate', 'status'] as const satisfies readonly TaskField[]
    ).find((field) => nextErrors[field] !== undefined);
    if (firstError !== undefined) {
      focusFieldLater(formRef, firstError);
      return;
    }

    setSaving(true);
    try {
      const message = await onCreateTask(taskCreateInput(values));
      setSuccess(message);
      setValues(EMPTY_TASK_VALUES);
      setErrors({});
    } catch (error: unknown) {
      const message = apiErrorMessage(error);
      setSubmitError(message);
      const field = apiErrorField(error);
      if (isTaskField(field)) {
        setErrors({ [field]: message });
      }
      focusFieldLater(formRef, field);
    } finally {
      setSaving(false);
    }
  };

  const overdueCount = derived.overdueTaskCount;

  return (
    <section className="card" aria-labelledby={headingId}>
      <header className="card__header">
        <div className="card__header-copy">
          <p className="card__eyebrow">Installation / tasks</p>
          <h2 className="card__title" id={headingId}>
            Installation tasks
          </h2>
          <p className="card__subtitle">
            {derived.openTaskCount} open · {derived.completedTaskCount} of {derived.taskCount}{' '}
            complete
            {overdueCount === 0 ? ' · no overdue tasks' : ` · ${overdueCount} overdue`}
          </p>
        </div>
        <StatusBadge
          label={overdueCount === 0 ? `${derived.openTaskCount} open` : `${overdueCount} overdue`}
          status={overdueCount === 0 ? 'todo' : 'blocked'}
        />
      </header>
      <div className="card__body stack">
        {submitError === null ? null : (
          <InlineNotice title="Task not added" tone="error">
            <p>{submitError}</p>
            <p>Your task fields are still here.</p>
          </InlineNotice>
        )}
        {success === null ? null : (
          <InlineNotice title="Task list updated" tone="success">
            {success}
          </InlineNotice>
        )}
        {tasks.length === 0 ? (
          <EmptyState
            action={
              <button
                className="button button--secondary"
                onClick={() => {
                  titleInputRef.current?.focus();
                }}
                type="button"
              >
                Add the first task
              </button>
            }
            icon={<ClipboardList size={25} strokeWidth={1.6} focusable="false" />}
            message="Track wall prep, lighting, labels, shipping, and every other step before opening."
            title="No installation tasks yet"
          />
        ) : (
          <ul className="list-reset stack--tight">
            {tasks.map((task) => (
              <TaskCard
                key={task.id}
                onDeleteTask={onDeleteTask}
                onDeleted={setSuccess}
                onUpdateTask={onUpdateTask}
                task={task}
              />
            ))}
          </ul>
        )}
        <form
          aria-busy={saving}
          className="stack--tight"
          noValidate
          onSubmit={(event) => {
            void handleSubmit(event);
          }}
          ref={formRef}
        >
          <fieldset className="fieldset">
            <legend className="fieldset__legend">Add a task</legend>
            <TaskFields
              errors={errors}
              includeStatus
              onChange={(nextValues) => {
                setValues(nextValues);
                setErrors({});
              }}
              prefix={prefix}
              titleInputRef={titleInputRef}
              values={values}
            />
          </fieldset>
          <div className="form-actions">
            <button className="button button--primary" disabled={saving} type="submit">
              <Plus aria-hidden="true" focusable="false" size={16} strokeWidth={1.9} />
              {saving ? 'Adding task…' : 'Add task'}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
}

export interface ActivityTimelineProps {
  activity: readonly ActivityEntry[];
}

export function ActivityTimeline({ activity }: ActivityTimelineProps) {
  const headingId = useId();
  const orderedActivity = useMemo(
    () =>
      [...activity].sort((left, right) => {
        const byTimestamp = right.createdAt.localeCompare(left.createdAt);
        return byTimestamp === 0 ? right.id.localeCompare(left.id) : byTimestamp;
      }),
    [activity],
  );

  return (
    <section className="card" aria-labelledby={headingId}>
      <header className="card__header">
        <div className="card__header-copy">
          <p className="card__eyebrow">Audit / history</p>
          <h2 className="card__title" id={headingId}>
            Activity
          </h2>
          <p className="card__subtitle">
            Newest first. These entries are append-only and cannot be edited or deleted through the
            API.
          </p>
        </div>
        <History aria-hidden="true" focusable="false" size={22} strokeWidth={1.6} />
      </header>
      <div className="card__body">
        {orderedActivity.length === 0 ? (
          <EmptyState
            icon={<History size={25} strokeWidth={1.6} focusable="false" />}
            message="Creating or changing this exhibition, its hang, or its tasks will add durable entries here."
            title="No activity recorded yet"
          />
        ) : (
          <div className="stack--tight">
            <ol className="activity-list">
              {orderedActivity.map((entry) => (
                <li className="activity-item" key={entry.id}>
                  <span aria-hidden="true" className="activity-item__marker" />
                  <div className="activity-item__body">
                    <p className="activity-item__detail">{entry.detail}</p>
                    <p className="activity-item__meta">
                      <span>
                        {ACTIVITY_ENTITY_LABELS[entry.entityType]} ·{' '}
                        {ACTIVITY_ACTION_LABELS[entry.action]}
                      </span>
                      <time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time>
                    </p>
                  </div>
                </li>
              ))}
            </ol>
            <p className="small muted">
              The API stores the change text and server timestamp; it does not record an actor name,
              so this timeline does not infer one.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
