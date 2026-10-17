import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { createWallwiseApp } from './app';
import type { WallwiseAppOptions, WallwiseRuntime } from './app';

export { createWallwiseApp };
export type { WallwiseAppOptions, WallwiseRuntime };

const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 3000;

interface StoppableServer {
  stop: (closeActiveConnections?: boolean) => unknown;
}

function readHost(value: string | undefined): string {
  const host = value?.trim();
  return host && host.length > 0 ? host : DEFAULT_HOST;
}

function readPort(value: string | undefined): number {
  const raw = value?.trim();
  if (raw === undefined || raw.length === 0) {
    return DEFAULT_PORT;
  }
  if (!/^\d+$/.test(raw)) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }

  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('PORT must be an integer between 0 and 65535.');
  }
  return port;
}

function readCorsOrigin(value: string | undefined): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  return origins.length > 0 ? origins : [];
}

function startServer(): void {
  let runtime: WallwiseRuntime | undefined;

  try {
    runtime = createWallwiseApp({
      databasePath: process.env.DATABASE_PATH,
      corsOrigin: readCorsOrigin(process.env.CORS_ORIGIN),
      staticDir: resolve(process.cwd(), 'dist'),
    });

    const { app, close } = runtime;
    const host = readHost(process.env.HOST);
    const port = readPort(process.env.PORT);
    let server: StoppableServer | undefined;
    let shuttingDown = false;

    const shutdown = async (): Promise<void> => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      console.log('[wallwise] Shutting down.');
      try {
        if (server !== undefined) {
          await Promise.resolve(server.stop());
        }
      } catch {
        // The adapter may already have closed the listener.
      } finally {
        close();
        process.exit(0);
      }
    };

    process.once('SIGINT', () => {
      void shutdown();
    });
    process.once('SIGTERM', () => {
      void shutdown();
    });

    app.listen({ hostname: host, port }, (instance: StoppableServer) => {
      server = instance;
    });
    console.log(`[wallwise] Listening on http://${host}:${port}.`);
  } catch {
    runtime?.close();
    console.error('[wallwise] Server failed to start.');
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1];
if (entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href) {
  startServer();
}
