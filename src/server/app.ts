import { realpathSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';

import { cors } from '@elysiajs/cors';
import { node } from '@elysiajs/node';
import { Elysia } from 'elysia';

import type { CreatePlacementInput } from '../shared/types';
import { createDatabase } from './db/database';
import type { WallwiseDatabase } from './db/database';
import { internalError, isDomainError, notFoundError, validationError } from './domain/errors';
import type { WallwiseService } from './domain/service';
import {
  ActivityListQuerySchema,
  ArtistListQuerySchema,
  ArtworkListQuerySchema,
  CreateArtistSchema,
  CreateArtworkSchema,
  CreateExhibitionSchema,
  CreatePlacementSchema,
  CreateTaskSchema,
  ExhibitionListQuerySchema,
  ExhibitionTransitionSchema,
  TaskListQuerySchema,
  UpdateArtistSchema,
  UpdateArtworkSchema,
  UpdateExhibitionSchema,
  UpdatePlacementSchema,
  UpdateTaskSchema,
  parseOrThrow,
  parseQuery,
} from './api/schemas';

const DEFAULT_DATABASE_PATH = './data/wallwise.sqlite';
const DEFAULT_CORS_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];

export interface WallwiseAppOptions {
  databasePath?: string;
  now?: () => Date;
  staticDir?: string;
  corsOrigin?: string | string[];
}

export interface WallwiseRuntime {
  app: Elysia;
  database: WallwiseDatabase;
  service: WallwiseService;
  close: () => void;
}

interface StaticRoot {
  root: string;
  indexFile: string;
}

interface StaticLookup {
  filePath?: string;
  blocked: boolean;
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.otf': 'font/otf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function isWithin(root: string, target: string): boolean {
  const prefix = root.endsWith(sep) ? root : `${root}${sep}`;
  return target === root || target.startsWith(prefix);
}

function prepareStaticRoot(staticDir: string | undefined): StaticRoot | undefined {
  if (staticDir === undefined || staticDir.trim().length === 0) {
    return undefined;
  }

  try {
    const root = realpathSync(resolve(staticDir));
    const indexFile = realpathSync(resolve(root, 'index.html'));
    if (!isWithin(root, indexFile) || !isFile(indexFile)) {
      return undefined;
    }
    return { root, indexFile };
  } catch {
    return undefined;
  }
}

function contentTypeFor(filePath: string): string {
  return MIME_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

function cacheControlFor(root: string, filePath: string): string {
  const assetsRoot = resolve(root, 'assets');
  return isWithin(assetsRoot, filePath) ? 'public, max-age=31536000, immutable' : 'no-cache';
}

function staticFileResponse(staticRoot: StaticRoot, filePath: string): Response {
  const data = readFileSync(filePath);
  const bytes = new Uint8Array(data.byteLength);
  bytes.set(data);

  return new Response(bytes, {
    status: 200,
    headers: {
      'Cache-Control': cacheControlFor(staticRoot.root, filePath),
      'Content-Length': String(bytes.byteLength),
      'Content-Type': contentTypeFor(filePath),
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function lookupStaticFile(root: string, target: string): StaticLookup {
  let realTarget: string;
  try {
    realTarget = realpathSync(target);
  } catch {
    return { blocked: false };
  }

  if (!isWithin(root, realTarget)) {
    return { blocked: true };
  }

  try {
    const stats = statSync(realTarget);
    if (stats.isFile()) {
      return { filePath: realTarget, blocked: false };
    }
    if (stats.isDirectory()) {
      const directoryIndex = realpathSync(resolve(realTarget, 'index.html'));
      if (isWithin(root, directoryIndex) && isFile(directoryIndex)) {
        return { filePath: directoryIndex, blocked: false };
      }
    }
  } catch {
    return { blocked: false };
  }

  return { blocked: false };
}

function decodeRequestPath(pathname: string): string {
  try {
    const decoded = decodeURIComponent(pathname);
    if (decoded.includes('\0')) {
      throw new Error('Invalid path');
    }
    return decoded;
  } catch {
    throw notFoundError('Asset not found.');
  }
}

function serveStaticRequest(staticRoot: StaticRoot, request: Request): Response | undefined {
  if (request.method !== 'GET') {
    return undefined;
  }

  const pathname = decodeRequestPath(new URL(request.url).pathname);
  if (pathname === '/api' || pathname.startsWith('/api/')) {
    return undefined;
  }

  const target = resolve(
    staticRoot.root,
    `.${pathname.startsWith('/') ? pathname : `/${pathname}`}`,
  );
  if (!isWithin(staticRoot.root, target)) {
    throw notFoundError('Asset not found.');
  }

  const lookup = lookupStaticFile(staticRoot.root, target);
  if (lookup.blocked) {
    throw notFoundError('Asset not found.');
  }
  if (lookup.filePath !== undefined) {
    return staticFileResponse(staticRoot, lookup.filePath);
  }

  if (pathname.startsWith('/assets/') || extname(pathname) !== '') {
    throw notFoundError('Asset not found.');
  }

  return staticFileResponse(staticRoot, staticRoot.indexFile);
}

function logServerError(request: Request): void {
  let pathname = 'unknown';
  try {
    pathname = new URL(request.url).pathname;
  } catch {
    // Keep the safe placeholder path.
  }
  console.error(`[wallwise] Unhandled server error for ${request.method} ${pathname}.`);
}

function registerErrorHandler(app: Elysia): void {
  app.onError(({ code, error, request, set }) => {
    if (isDomainError(error)) {
      if (error.status >= 500) {
        logServerError(request);
      }
      set.status = error.status;
      return error.toErrorResponse();
    }

    if (code === 'NOT_FOUND') {
      set.status = 404;
      return notFoundError('Route not found.').toErrorResponse();
    }

    if (code === 'PARSE') {
      set.status = 400;
      return validationError('Request body must be valid JSON.').toErrorResponse();
    }

    if (
      code === 'VALIDATION' ||
      code === 'INVALID_FILE_TYPE' ||
      code === 'INVALID_COOKIE_SIGNATURE'
    ) {
      set.status = 400;
      return validationError('The request is invalid.').toErrorResponse();
    }

    logServerError(request);
    set.status = 500;
    return internalError().toErrorResponse();
  });
}

function registerCors(app: Elysia, corsOrigin: string | string[] | undefined): void {
  if (corsOrigin === undefined) {
    return;
  }

  const origins = Array.isArray(corsOrigin)
    ? corsOrigin.filter((origin) => origin.trim().length > 0)
    : corsOrigin.trim().length > 0
      ? corsOrigin
      : undefined;

  if (origins === undefined || (Array.isArray(origins) && origins.length === 0)) {
    return;
  }

  app.use(cors({ origin: origins }));
}

function searchParams(request: Request): URLSearchParams {
  return new URL(request.url).searchParams;
}

function registerApiRoutes(app: Elysia, service: WallwiseService): void {
  app.get('/api/health', () => service.getHealth());
  app.get('/api/dashboard', () => service.getDashboard());

  app.get('/api/artists', ({ request }) =>
    service.listArtists(parseQuery(ArtistListQuerySchema, searchParams(request))),
  );
  app.post('/api/artists', ({ body, set }) => {
    const input = parseOrThrow(CreateArtistSchema, body, { fallbackField: 'body' });
    set.status = 201;
    return service.createArtist(input);
  });
  app.get('/api/artists/:id', ({ params }) => service.getArtist(params.id));
  app.patch('/api/artists/:id', ({ body, params }) =>
    service.updateArtist(
      params.id,
      parseOrThrow(UpdateArtistSchema, body, { fallbackField: 'body' }),
    ),
  );

  app.get('/api/artworks', ({ request }) =>
    service.listArtworks(parseQuery(ArtworkListQuerySchema, searchParams(request))),
  );
  app.post('/api/artworks', ({ body, set }) => {
    const input = parseOrThrow(CreateArtworkSchema, body, { fallbackField: 'body' });
    set.status = 201;
    return service.createArtwork(input);
  });
  app.get('/api/artworks/:id', ({ params }) => service.getArtwork(params.id));
  app.patch('/api/artworks/:id', ({ body, params }) =>
    service.updateArtwork(
      params.id,
      parseOrThrow(UpdateArtworkSchema, body, { fallbackField: 'body' }),
    ),
  );

  app.get('/api/exhibitions', ({ request }) =>
    service.listExhibitions(parseQuery(ExhibitionListQuerySchema, searchParams(request))),
  );
  app.post('/api/exhibitions', ({ body, set }) => {
    const input = parseOrThrow(CreateExhibitionSchema, body, { fallbackField: 'body' });
    set.status = 201;
    return service.createExhibition(input);
  });
  app.get('/api/exhibitions/:id', ({ params }) => service.getExhibitionDetail(params.id));
  app.patch('/api/exhibitions/:id', ({ body, params }) =>
    service.updateExhibition(
      params.id,
      parseOrThrow(UpdateExhibitionSchema, body, { fallbackField: 'body' }),
    ),
  );
  app.post('/api/exhibitions/:id/transitions', ({ body, params }) =>
    service.transitionExhibition(
      params.id,
      parseOrThrow(ExhibitionTransitionSchema, body, { fallbackField: 'body' }),
    ),
  );

  app.post('/api/exhibitions/:id/placements', ({ body, params, set }) => {
    const parsed = parseOrThrow(CreatePlacementSchema, body, { fallbackField: 'body' });
    const exhibitionId = params.id;

    if (parsed.exhibitionId !== undefined && parsed.exhibitionId.trim() !== exhibitionId.trim()) {
      throw validationError(
        'exhibitionId must match the exhibition in the request path.',
        'exhibitionId',
      );
    }

    const input: CreatePlacementInput = {
      exhibitionId,
      artworkId: parsed.artworkId,
      wall: parsed.wall,
      position: parsed.position,
      ...(parsed.label === undefined ? {} : { label: parsed.label }),
      ...(parsed.notes === undefined ? {} : { notes: parsed.notes }),
    };
    set.status = 201;
    return service.createPlacement(input);
  });
  app.patch('/api/placements/:id', ({ body, params }) =>
    service.updatePlacement(
      params.id,
      parseOrThrow(UpdatePlacementSchema, body, { fallbackField: 'body' }),
    ),
  );
  app.delete('/api/placements/:id', ({ params }) => service.deletePlacement(params.id));

  app.get('/api/tasks', ({ request }) =>
    service.listTasks(parseQuery(TaskListQuerySchema, searchParams(request))),
  );
  app.post('/api/exhibitions/:id/tasks', ({ body, params, set }) => {
    const input = parseOrThrow(CreateTaskSchema, body, { fallbackField: 'body' });
    set.status = 201;
    return service.createTask(params.id, input);
  });
  app.patch('/api/tasks/:id', ({ body, params }) =>
    service.updateTask(params.id, parseOrThrow(UpdateTaskSchema, body, { fallbackField: 'body' })),
  );
  app.delete('/api/tasks/:id', ({ params }) => service.deleteTask(params.id));

  app.get('/api/activity', ({ request }) =>
    service.listActivity(parseQuery(ActivityListQuerySchema, searchParams(request))),
  );

  app.get(
    '/api/export/exhibitions.csv',
    () =>
      new Response(service.exportExhibitionsCsv(), {
        status: 200,
        headers: {
          'Content-Disposition': 'attachment; filename="wallwise-exhibitions.csv"',
          'Content-Type': 'text/csv; charset=utf-8',
        },
      }),
  );
}

export function createWallwiseApp(options: WallwiseAppOptions = {}): WallwiseRuntime {
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? DEFAULT_DATABASE_PATH;
  const now = options.now ?? (() => new Date());
  const database = createDatabase(databasePath);
  const close = (): void => database.close();

  try {
    const service = database.service(now);
    const app = new Elysia({
      adapter: node(),
      name: 'wallwise',
      handler: { standardHostname: false },
    });

    registerErrorHandler(app);
    registerCors(app, options.corsOrigin ?? DEFAULT_CORS_ORIGINS);
    const staticRoot = prepareStaticRoot(options.staticDir);
    if (staticRoot !== undefined) {
      app.onRequest(({ request }) => serveStaticRequest(staticRoot, request));
    }
    registerApiRoutes(app, service);

    return { app, database, service, close };
  } catch (error) {
    close();
    throw error;
  }
}
