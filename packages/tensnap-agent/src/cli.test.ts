import { once } from 'node:events';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { main } from './cli';
import { resolveRuntimeContextPaths, writeRuntimeControl } from './runtime/context';

it.each(['Infinity', '-Infinity', 'NaN'])('rejects non-finite numeric flags: %s', async (value) => {
  await expect(main(['run', 'start', 'step', '--max-steps', value])).rejects.toThrow(
    'finite number',
  );
  await expect(main(['runtime', 'up', '--foreground', '--port', value])).rejects.toThrow(
    'finite number',
  );
  await expect(main(['runtime', 'up', '--port', value])).rejects.toThrow('finite number');
});

it.each(['-1', '65536', '1.5'])(
  'rejects invalid ports before starting either daemon mode: %s',
  async (value) => {
    for (const flags of [[], ['--foreground']]) {
      await expect(main(['runtime', 'up', ...flags, '--port', value])).rejects.toThrow(
        'integer from 0 through 65535',
      );
    }
  },
);

const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('agent CLI', () => {
  it.each(['other', '4'])(
    'rejects invalid IP-family policy before starting: %s',
    async (ipFamily) => {
      await expect(main(['runtime', 'up', '--ip-family', ipFamily])).rejects.toThrow(/ip_family/);
    },
  );

  it('connects to an IPv6 control endpoint using a bracketed URL', async (context) => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, '::1');
    try {
      await once(server, 'listening');
    } catch (error) {
      if (['EAFNOSUPPORT', 'EADDRNOTAVAIL'].includes((error as NodeJS.ErrnoException).code ?? '')) {
        context.skip();
        return;
      }
      throw error;
    }
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('No address');
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-ipv6-'));
    tempDirs.push(rootDir);
    const runtimeContext = resolveRuntimeContextPaths({ rootDir, contextName: 'ipv6' });
    const now = new Date().toISOString();
    await writeRuntimeControl(runtimeContext, {
      version: 1,
      contextName: 'ipv6',
      contextDir: runtimeContext.contextDir,
      createdAt: now,
      updatedAt: now,
      host: '::1',
      controlPort: address.port,
      pid: process.pid,
      phase: 'ready',
      encoding: 'json',
      clientMessageValidation: 'off',
      serverMessageValidation: 'off',
      maxRunStepsPolicy: 1,
      render: { trigger: 'manual', backgroundColor: '#000000' },
      painters: [],
      sceneRevision: 0,
      sceneDirty: false,
    });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await main(['runtime', 'status', '--context', 'ipv6', '--context-dir', rootDir]);
      expect(log).toHaveBeenCalledWith(expect.stringContaining('"ok": true'));
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
  it('carries captured scene time into checkpoint restore', async () => {
    const requests: Record<string, unknown>[] = [];
    let supportsProjectedRestore = true;
    const server = createServer((request, response) => {
      const send = (value: unknown) => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(value));
      };
      if (request.url === '/health') return send({});
      if (request.url === '/v1/runtime/status')
        return send({
          simulatorCapabilities: supportsProjectedRestore
            ? ['scene.restore.checkpoint', 'scene.restore.projected']
            : ['scene.restore.checkpoint'],
        });
      if (request.url === '/v1/scene/capture')
        return send({
          model_id: 'clocked',
          checkpoint: { encoding: 'application/octet-stream', data: 'AQ==' },
        });
      if (request.url === '/v1/scene/snapshot')
        return send({ snapshot: { metadata: { time: 3 } } });
      if (request.url === '/v1/scene/restore') {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
          body += chunk;
        });
        request.on('end', () => {
          requests.push(JSON.parse(body));
          send({ status: 'ok' });
        });
        return;
      }
      response.writeHead(404);
      response.end();
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (address === null || typeof address === 'string')
      throw new Error('Expected an IP socket address.');
    const rootDir = await mkdtemp(join(tmpdir(), 'tensnap-agent-capture-'));
    tempDirs.push(rootDir);
    const context = resolveRuntimeContextPaths({ rootDir, contextName: 'capture-test' });
    const now = new Date().toISOString();
    const captureFile = join(rootDir, 'capture.json');
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
        'scene',
        'capture',
        '--output',
        captureFile,
        '--context',
        context.contextName,
        '--context-dir',
        rootDir,
      ]);
      expect(JSON.parse(await readFile(captureFile, 'utf8'))).toMatchObject({ time: 3 });
      await main([
        'scene',
        'restore',
        '--checkpoint',
        captureFile,
        '--context',
        context.contextName,
        '--context-dir',
        rootDir,
      ]);
      await main([
        'scene',
        'restore',
        '--checkpoint',
        captureFile,
        '--time',
        '5',
        '--context',
        context.contextName,
        '--context-dir',
        rootDir,
      ]);
      supportsProjectedRestore = false;
      const checkpointOnlyFile = join(rootDir, 'checkpoint-only.json');
      await main([
        'scene',
        'capture',
        '--output',
        checkpointOnlyFile,
        '--context',
        context.contextName,
        '--context-dir',
        rootDir,
      ]);
      expect(JSON.parse(await readFile(checkpointOnlyFile, 'utf8'))).not.toHaveProperty('time');
      await main([
        'scene',
        'restore',
        '--checkpoint',
        checkpointOnlyFile,
        '--context',
        context.contextName,
        '--context-dir',
        rootDir,
      ]);
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
    expect(requests).toEqual([
      { checkpoint: { encoding: 'application/octet-stream', data: 'AQ==' }, time: 3 },
      { checkpoint: { encoding: 'application/octet-stream', data: 'AQ==' }, time: 5 },
      { checkpoint: { encoding: 'application/octet-stream', data: 'AQ==' } },
    ]);
  });

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

      if (request.method === 'POST' && request.url === '/v1/scene/render') {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
          body += chunk;
        });
        request.on('end', () => {
          requests.push(JSON.parse(body));
          response.writeHead(200, { 'content-type': 'application/json' });
          response.end('{"artifacts":[]}');
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
        'run',
        'start',
        'step',
        '--max-steps',
        '7',
        '--stop-when',
        'time >= 3',
        '--max-wall-time-ms',
        '1500',
        '--record',
        '--context',
        context.contextName,
        '--context-dir',
        rootDir,
      ]);
      await main([
        'scene',
        'render',
        'test-chart',
        '--chart',
        'population',
        '--output',
        '/tmp/population.png',
        '--context',
        context.contextName,
        '--context-dir',
        rootDir,
      ]);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }

    expect(requests).toEqual([
      {
        mode: 'bounded',
        actionId: 'step',
        maxSteps: 7,
        stopWhen: 'time >= 3',
        maxWallTimeMs: 1500,
        record: true,
      },
      expect.objectContaining({
        reason: 'test-chart',
        chartId: 'population',
        outputPath: '/tmp/population.png',
      }),
    ]);
  });
});
