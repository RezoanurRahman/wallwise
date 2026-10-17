import { ERROR_CODES } from '../../shared/constants';
import type { ConflictErrorDetails, ConflictWarning, ErrorResponse } from '../../shared/types';

export type DomainErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface DomainErrorOptions {
  field?: string;
  details?: unknown;
  cause?: unknown;
}

/** A safe, structured error that can cross the service/API boundary. */
export class DomainError extends Error {
  readonly status: number;
  readonly code: DomainErrorCode;
  readonly field?: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: DomainErrorCode,
    message: string,
    options: DomainErrorOptions = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'DomainError';
    this.status = status;
    this.code = code;
    if (options.field !== undefined) {
      this.field = options.field;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
    Object.setPrototypeOf(this, new.target.prototype);
  }

  toErrorResponse(): ErrorResponse {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.field === undefined ? {} : { field: this.field }),
        ...(this.details === undefined ? {} : { details: this.details }),
      },
    };
  }
}

export function validationError(message: string, field?: string, details?: unknown): DomainError {
  return new DomainError(400, ERROR_CODES.VALIDATION_ERROR, message, { field, details });
}

export function notFoundError(message: string, field?: string): DomainError {
  return new DomainError(404, ERROR_CODES.NOT_FOUND, message, { field });
}

export function scheduleConflictError(conflicts: ConflictWarning[]): DomainError {
  const details: ConflictErrorDetails = { conflicts };
  return new DomainError(
    409,
    ERROR_CODES.SCHEDULE_CONFLICT,
    'The exhibition schedule conflicts with another show in this space.',
    { details },
  );
}

export function artworkAssignmentConflictError(conflicts: ConflictWarning[]): DomainError {
  const details: ConflictErrorDetails = { conflicts };
  return new DomainError(
    409,
    ERROR_CODES.ARTWORK_ASSIGNMENT_CONFLICT,
    'The artwork is already assigned during this exhibition window.',
    { details },
  );
}

export function placementConflictError(message: string, details?: unknown): DomainError {
  return new DomainError(409, ERROR_CODES.PLACEMENT_CONFLICT, message, { details });
}

export function invalidTransitionError(from: string, to: string): DomainError {
  return new DomainError(
    409,
    ERROR_CODES.INVALID_TRANSITION,
    `Cannot move an exhibition from ${from} to ${to}.`,
    { field: 'to', details: { from, to } },
  );
}

export function ruleViolationError(message: string, field?: string): DomainError {
  return new DomainError(422, ERROR_CODES.RULE_VIOLATION, message, { field });
}

export function internalError(): DomainError {
  return new DomainError(
    500,
    ERROR_CODES.INTERNAL_ERROR,
    'The request could not be completed due to an internal error.',
  );
}

/** Converts known errors to the public envelope and hides unexpected internals. */
export function serializeError(error: unknown): ErrorResponse {
  if (error instanceof DomainError) {
    return error.toErrorResponse();
  }

  return internalError().toErrorResponse();
}

export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

/** Named aliases kept explicit for API-layer imports. */
export function toErrorResponse(error: unknown): ErrorResponse {
  return serializeError(error);
}

export function serializeDomainError(error: unknown): ErrorResponse {
  return serializeError(error);
}
