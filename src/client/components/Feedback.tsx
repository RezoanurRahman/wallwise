import { AlertCircle, AlertTriangle, CheckCircle2, Inbox, LoaderCircle, X } from 'lucide-react';
import { useId } from 'react';
import type { ReactNode } from 'react';

import { cn } from '../utils';

export interface LoadingStateProps {
  className?: string;
  compact?: boolean;
  description?: ReactNode;
  label?: string;
}

export interface ErrorStateProps {
  children?: ReactNode;
  className?: string;
  message: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  retrying?: boolean;
  title?: string;
}

export interface EmptyStateProps {
  action?: ReactNode;
  className?: string;
  icon?: ReactNode;
  message?: ReactNode;
  title: string;
}

export interface InlineNoticeProps {
  children: ReactNode;
  className?: string;
  dismissLabel?: string;
  onDismiss?: () => void;
  title?: string;
  tone: 'success' | 'error' | 'warning';
}

export interface LiveRegionProps {
  className?: string;
  message: string;
  politeness?: 'polite' | 'assertive';
}

export function LoadingState({
  className,
  compact = false,
  description,
  label = 'Loading the desk',
}: LoadingStateProps) {
  return (
    <div
      className={cn('feedback', 'feedback--loading', compact && 'feedback--compact', className)}
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="feedback__icon feedback__icon--loading" aria-hidden="true">
        <LoaderCircle size={22} strokeWidth={1.8} focusable="false" />
      </span>
      <div className="feedback__copy">
        <p className="feedback__title">{label}</p>
        {description === undefined ? null : <p className="feedback__message">{description}</p>}
      </div>
    </div>
  );
}

export function ErrorState({
  children,
  className,
  message,
  onRetry,
  retryLabel = 'Try again',
  retrying = false,
  title = 'The desk could not load',
}: ErrorStateProps) {
  return (
    <div
      className={cn('feedback', 'feedback--error', className)}
      role="alert"
      aria-live="assertive"
      aria-busy={retrying}
    >
      <span className="feedback__icon feedback__icon--error" aria-hidden="true">
        <AlertCircle size={23} strokeWidth={1.8} focusable="false" />
      </span>
      <div className="feedback__copy">
        <h2 className="feedback__title">{title}</h2>
        <div className="feedback__message">{message}</div>
        {children === undefined ? null : <div className="feedback__details">{children}</div>}
        {onRetry === undefined ? null : (
          <button
            type="button"
            className="button button--secondary feedback__action"
            onClick={onRetry}
            disabled={retrying}
            aria-busy={retrying}
          >
            {retrying ? 'Retrying…' : retryLabel}
          </button>
        )}
      </div>
    </div>
  );
}

export function EmptyState({ action, className, icon, message, title }: EmptyStateProps) {
  const headingId = useId();

  return (
    <section className={cn('feedback', 'feedback--empty', className)} aria-labelledby={headingId}>
      <span className="feedback__icon feedback__icon--empty" aria-hidden="true">
        {icon ?? <Inbox size={23} strokeWidth={1.7} focusable="false" />}
      </span>
      <div className="feedback__copy">
        <h2 className="feedback__title" id={headingId}>
          {title}
        </h2>
        {message === undefined ? null : <p className="feedback__message">{message}</p>}
        {action === undefined ? null : <div className="feedback__action">{action}</div>}
      </div>
    </section>
  );
}

const NOTICE_ICONS = {
  error: AlertCircle,
  success: CheckCircle2,
  warning: AlertTriangle,
} as const;

export function InlineNotice({
  children,
  className,
  dismissLabel = 'Dismiss notice',
  onDismiss,
  title,
  tone,
}: InlineNoticeProps) {
  const Icon = NOTICE_ICONS[tone];
  const assertive = tone === 'error';

  return (
    <div
      className={cn('inline-notice', `inline-notice--${tone}`, className)}
      role={assertive ? 'alert' : 'status'}
      aria-live={assertive ? 'assertive' : 'polite'}
      aria-atomic="true"
    >
      <Icon
        className="inline-notice__icon"
        size={19}
        strokeWidth={1.8}
        aria-hidden="true"
        focusable="false"
      />
      <div className="inline-notice__copy">
        {title === undefined ? null : <p className="inline-notice__title">{title}</p>}
        <div className="inline-notice__message">{children}</div>
      </div>
      {onDismiss === undefined ? null : (
        <button
          className="icon-button inline-notice__dismiss"
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
        >
          <X size={18} strokeWidth={1.8} aria-hidden="true" focusable="false" />
        </button>
      )}
    </div>
  );
}

/** A persistent live region for concise async status announcements. */
export function LiveRegion({ className, message, politeness = 'polite' }: LiveRegionProps) {
  return (
    <div
      className={cn('visually-hidden', className)}
      role={politeness === 'assertive' ? 'alert' : 'status'}
      aria-live={politeness}
      aria-atomic="true"
    >
      {message}
    </div>
  );
}
