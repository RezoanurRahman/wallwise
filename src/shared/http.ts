import type { ErrorResponse } from './types';

export const API_BASE_PATH = '/api';

export const JSON_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  Accept: 'application/json',
  'Content-Type': 'application/json',
});

/** Creates request headers without relying on the DOM `HeadersInit` type. */
export function createJsonHeaders(
  extra?: Readonly<Record<string, string>>,
): Record<string, string> {
  return { ...JSON_HEADERS, ...extra };
}

/** Joins an API path to the default base while avoiding a duplicate `/api`. */
export function buildApiPath(path: string, basePath: string = API_BASE_PATH): string {
  const base = `/${basePath.replace(/^\/+|\/+$/g, '')}`;
  const target = path.startsWith('/') ? path : `/${path}`;

  if (target === base || target.startsWith(`${base}/`)) {
    return target;
  }

  return `${base}${target}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isErrorResponse(value: unknown): value is ErrorResponse {
  if (!isRecord(value) || !isRecord(value.error)) {
    return false;
  }

  const { code, message, field } = value.error;

  return (
    typeof code === 'string' &&
    code.trim().length > 0 &&
    typeof message === 'string' &&
    message.trim().length > 0 &&
    (field === undefined || typeof field === 'string')
  );
}

/**
 * Turns fetch failures, thrown values, and malformed payloads into the public
 * error envelope. This helper is environment-neutral and safe for server reuse.
 */
export function normalizeErrorResponse(
  value: unknown,
  fallback: { code?: string; message?: string } = {},
): ErrorResponse {
  if (isErrorResponse(value)) {
    return value;
  }

  let code = fallback.code ?? 'UNKNOWN_ERROR';
  let message = fallback.message ?? 'The request could not be completed.';
  let field: string | undefined;
  let details: unknown;

  if (isRecord(value)) {
    if (isRecord(value.error)) {
      if (typeof value.error.code === 'string' && value.error.code.trim().length > 0) {
        code = value.error.code;
      }
      if (typeof value.error.message === 'string' && value.error.message.trim().length > 0) {
        message = value.error.message;
      }
      if (typeof value.error.field === 'string') {
        field = value.error.field;
      }
      if (value.error.details !== undefined) {
        details = value.error.details;
      }
    } else if ('message' in value && typeof value.message === 'string' && value.message.trim()) {
      message = value.message;
    }
  } else if (value instanceof Error && value.message.trim()) {
    message = value.message;
  }

  return {
    error: {
      code,
      message,
      ...(field === undefined ? {} : { field }),
      ...(details === undefined ? {} : { details }),
    },
  };
}
