import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli';
import { resolveRuntimeContextPaths, writeRuntimeControl } from './runtime/context';

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('agent CLI', () => {
  it('sends an explicit bounded run request', async () => {
    const requests: unknown[] = [];
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/health') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{}');
        return;
      }

      if (request.method === 'POST' && request.url === '/v1/runs') {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
          body += chunk;
        });
        request.on('end', () => {
          requests.push(JSON.parse(body));
          response.writeHead(202, { 'content-type': 'application/json' });
          response.end('{"run":{"state":"running"}}');
        });
        return;
      }

      response.writeHead(404);
      response.end();
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string') {
      throw new Error('Expected an IP socket address.');
    }

    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-cli-'));
    tempDirs.push(rootDir);
    const context = resolveRuntimeContextPaths({ rootDir, contextName: 'cli-test' });
    const now = new Date().toISOString();
    await writeRuntimeControl(context, {
      version: 1,
      contextName: context.contextName,
      contextDir: context.contextDir,
      createdAt: now,
      updatedAt: now,
      host: '127.0.0.1',
      controlPort: address.port,
      pid: process.pid,
      phase: 'ready',
      encoding: 'json',
      clientMessageValidation: 'error',
      serverMessageValidation: 'error',
      maxRunStepsPolicy: 100,
      render: { trigger: 'manual', backgroundColor: '#000000' },
      painters: [],
      sceneRevision: 0,
      sceneDirty: false,
    });
    vi.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await main([
        'run', 'start', 'step',
        '--max-steps', '7',
        '--stop-when', 'time >= 3',
        '--max-wall-time-ms', '1500',
        '--record',
        '--context', context.contextName,
        '--context-dir', rootDir,
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }

    expect(requests).toEqual([{
      mode: 'bounded',
      actionId: 'step',
      maxSteps: 7,
      stopWhen: 'time >= 3',
      maxWallTimeMs: 1500,
      record: true,
    }]);
  });
});
