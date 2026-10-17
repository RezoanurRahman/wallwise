import {
  Archive,
  ArchiveX,
  Ban,
  CalendarClock,
  CheckCircle2,
  Circle,
  CircleHelp,
  Clock,
  DoorOpen,
  FilePenLine,
  LoaderCircle,
  LockKeyhole,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Wrench,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useId } from 'react';

import type {
  ArtistStatus,
  ArtworkStatus,
  ExhibitionStatus,
  ReadinessState,
  TaskStatus,
} from '../../shared/types';
import { cn, readinessLabel, statusLabel } from '../utils';

export type StatusValue =
  ArtistStatus | ArtworkStatus | ExhibitionStatus | TaskStatus | ReadinessState;

type StatusTone = 'positive' | 'caution' | 'critical' | 'neutral';

interface StatusMeta {
  icon: LucideIcon;
  modifier: string;
  tone: StatusTone;
}

const STATUS_META = {
  active: { icon: CheckCircle2, modifier: 'active', tone: 'positive' },
  archived: { icon: Archive, modifier: 'archived', tone: 'neutral' },
  available: { icon: Circle, modifier: 'available', tone: 'positive' },
  reserved: { icon: Clock, modifier: 'reserved', tone: 'caution' },
  retired: { icon: ArchiveX, modifier: 'retired', tone: 'neutral' },
  draft: { icon: FilePenLine, modifier: 'draft', tone: 'neutral' },
  planned: { icon: CalendarClock, modifier: 'planned', tone: 'caution' },
  installing: { icon: Wrench, modifier: 'installing', tone: 'caution' },
  open: { icon: DoorOpen, modifier: 'open', tone: 'positive' },
  closed: { icon: LockKeyhole, modifier: 'closed', tone: 'neutral' },
  cancelled: { icon: Ban, modifier: 'cancelled', tone: 'critical' },
  todo: { icon: Circle, modifier: 'todo', tone: 'neutral' },
  in_progress: { icon: LoaderCircle, modifier: 'in-progress', tone: 'caution' },
  done: { icon: CheckCircle2, modifier: 'done', tone: 'positive' },
  ready: { icon: ShieldCheck, modifier: 'ready', tone: 'positive' },
  attention: { icon: ShieldAlert, modifier: 'attention', tone: 'caution' },
  blocked: { icon: ShieldX, modifier: 'blocked', tone: 'critical' },
} as const satisfies Record<StatusValue, StatusMeta>;

const UNKNOWN_STATUS_META: StatusMeta = {
  icon: CircleHelp,
  modifier: 'unknown',
  tone: 'neutral',
};

function statusMeta(status: StatusValue): StatusMeta {
  const meta: StatusMeta | undefined = STATUS_META[status];
  return meta ?? UNKNOWN_STATUS_META;
}

export interface StatusBadgeProps {
  className?: string;
  compact?: boolean;
  label?: string;
  status: StatusValue;
}

export interface ReadinessMeterProps {
  className?: string;
  compact?: boolean;
  label?: string;
  state: ReadinessState;
  value: number;
}

export function StatusBadge({ className, compact = false, label, status }: StatusBadgeProps) {
  const meta = statusMeta(status);
  const Icon = meta.icon;
  const text = label ?? statusLabel(status);
  const modifier = STATUS_META[status] === undefined ? 'unknown' : meta.modifier;

  return (
    <span
      className={cn(
        'status-badge',
        `status-badge--${modifier}`,
        compact && 'status-badge--compact',
        className,
      )}
      data-tone={meta.tone}
    >
      <Icon
        className="status-badge__icon"
        size={14}
        strokeWidth={2}
        aria-hidden="true"
        focusable="false"
      />
      <span>{text}</span>
    </span>
  );
}

export function ReadinessMeter({
  className,
  compact = false,
  label = 'Readiness',
  state,
  value,
}: ReadinessMeterProps) {
  const labelId = useId();
  const percentage = Number.isFinite(value) ? Math.min(100, Math.max(0, Math.round(value))) : 0;
  const stateText = readinessLabel(state);
  const modifier = statusMeta(state).modifier;

  return (
    <div
      className={cn(
        'readiness-meter',
        `readiness-meter--${modifier}`,
        compact && 'readiness-meter--compact',
        className,
      )}
    >
      <div className="readiness-meter__header">
        <span className="readiness-meter__label" id={labelId}>
          {label}
        </span>
        <span className="readiness-meter__value">
          <strong>{percentage}%</strong> ready
        </span>
      </div>
      <progress
        className="readiness-meter__progress"
        max={100}
        value={percentage}
        aria-labelledby={labelId}
        aria-valuetext={`${percentage}% ready. ${stateText}.`}
      />
      <div className="readiness-meter__footer">
        <StatusBadge status={state} compact />
        <span className="readiness-meter__state">{stateText}</span>
      </div>
    </div>
  );
}

export default StatusBadge;
