import { mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { createWallwiseApp } from '../../src/server/app';
import type { WallwiseRuntime } from '../../src/server/app';

export const FROZEN_NOW = new Date('2026-10-17T12:00:00.000Z');

const TEST_ORIGIN = 'http://wallwise.integration.test';
const activeRuntimes = new Set<TestRuntime>();
let databaseSequence = 0;

export interface TestRuntime extends WallwiseRuntime {
  readonly databasePath: string;
}

export interface JsonRequestOptions extends Omit<RequestInit, 'body'> {
  json?: unknown;
  rawBody?: string;
}

export interface JsonResult<T> {
  response: Response;
  body: T;
  text: string;
}

export interface TextResult {
  response: Response;
  text: string;
}

function requestUrl(path: string): string {
  return new URL(path, TEST_ORIGIN).toString();
}

function databaseArtifacts(databasePath: string): string[] {
  return [databasePath, `${databasePath}-wal`, `${databasePath}-shm`, `${databasePath}-journal`];
}

export function removeDatabaseFiles(databasePath: string): void {
  for (const artifact of databaseArtifacts(databasePath)) {
    rmSync(artifact, { force: true });
  }
}

/** Returns a clean, deterministic path in the test-only `.tmp` directory. */
export function freshPath(label = 'wallwise'): string {
  databaseSequence += 1;
  const safeLabel =
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, '-')
      .replace(/^-|-$/gu, '') || 'wallwise';
  const databasePath = resolve(
    process.cwd(),
    '.tmp',
    'integration',
    `${safeLabel}-${process.pid}-${databaseSequence}.sqlite`,
  );

  removeDatabaseFiles(databasePath);
  mkdirSync(dirname(databasePath), { recursive: true });
  return databasePath;
}

/**
 * Opens the real Elysia app against a real SQLite file. The default clock is frozen for
 * deterministic date-derived assertions; pass a function when a test needs to advance time.
 */
export function makeRuntime(
  databasePath = freshPath('wallwise'),
  now: Date | (() => Date) = FROZEN_NOW,
): TestRuntime {
  const runtime = createWallwiseApp({
    databasePath,
    now: typeof now === 'function' ? now : () => new Date(now.getTime()),
  });
  let closed = false;

  const testRuntime: TestRuntime = {
    ...runtime,
    databasePath,
    close: () => {
      if (closed) {
        return;
      }
      closed = true;
      runtime.close();
    },
  };

  activeRuntimes.add(testRuntime);
  return testRuntime;
}

export async function requestText(
  runtime: Pick<WallwiseRuntime, 'app'>,
  path: string,
  init: RequestInit = {},
): Promise<TextResult> {
  const response = await runtime.app.handle(new Request(requestUrl(path), init));
  return { response, text: await response.text() };
}

export async function requestJson<T>(
  runtime: Pick<WallwiseRuntime, 'app'>,
  path: string,
  options: JsonRequestOptions = {},
): Promise<JsonResult<T>> {
  const { json, rawBody, headers: optionHeaders, ...init } = options;
  const headers = new Headers(optionHeaders);
  let body = rawBody;

  if (json !== undefined) {
    headers.set('content-type', 'application/json');
    body = JSON.stringify(json);
  }

  const { response, text } = await requestText(runtime, path, { ...init, headers, body });
  let parsed: T;
  try {
    parsed = JSON.parse(text) as T;
  } catch {
    throw new Error(
      `Expected a JSON response from ${init.method ?? 'GET'} ${path}, received: ${text.slice(0, 200)}`,
    );
  }

  return { response, body: parsed, text };
}

/** Closes one runtime and removes its SQLite file, WAL, SHM, and rollback journal. */
export function cleanupRuntime(runtime: TestRuntime): void {
  try {
    runtime.close();
  } finally {
    activeRuntimes.delete(runtime);
    removeDatabaseFiles(runtime.databasePath);
  }
}

/** Closes every runtime opened by the current test, then removes each database artifact set. */
export function cleanupAllRuntimes(): void {
  const runtimes = [...activeRuntimes];
  const databasePaths = new Set(runtimes.map((runtime) => runtime.databasePath));
  activeRuntimes.clear();

  let closeError: unknown;
  for (const runtime of runtimes) {
    try {
      runtime.close();
    } catch (error) {
      closeError ??= error;
    }
  }

  for (const databasePath of databasePaths) {
    removeDatabaseFiles(databasePath);
  }

  if (closeError !== undefined) {
    throw closeError instanceof Error
      ? closeError
      : new Error('Failed to close the integration test runtime.', { cause: closeError });
  }
}
