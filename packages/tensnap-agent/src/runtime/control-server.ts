import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { AgentRuntime } from './AgentRuntime';
import type { RuntimeEvent, RuntimeLogEntry } from '../types';
import type { RenderTriggerMode } from '../types';

interface ControlServerOptions {
  host?: string;
  port?: number;
}

async function readJsonBody<T>(request: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  if (!chunks.length) {
    return {} as T;
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T;
}

function sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
  response.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(data, null, 2)}\n`);
}

function sendText(response: ServerResponse, statusCode: number, data: string): void {
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' });
  response.end(data);
}

function sendNoContent(response: ServerResponse): void {
  response.writeHead(204);
  response.end();
}

function writeSse(response: ServerResponse, event: RuntimeEvent): void {
  response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event)}\n\n`);
}

function decodePathParam(prefix: string, pathname: string): string | null {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  return decodeURIComponent(pathname.slice(prefix.length));
}

export class RuntimeControlServer {
  private readonly server: Server;
  private readonly sseClients = new Set<ServerResponse>();

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly options: ControlServerOptions = {},
  ) {
    this.server = createServer((request, response) => {
      void this.handleRequest(request, response);
    });
    this.runtime.on('event', (event) => this.broadcast(event as RuntimeEvent));
  }

  async listen(): Promise<{ host: string; port: number }> {
    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 0;

    await new Promise<void>((resolve, reject) => {
      this.server.once('error', reject);
      this.server.listen(port, host, () => {
        this.server.off('error', reject);
        resolve();
      });
    });

    const address = this.server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine control server address.');
    }

    await this.runtime.setControlAddress(address.address, address.port);
    return { host: address.address, port: address.port };
  }

  async close(): Promise<void> {
    for (const client of this.sseClients) {
      client.end();
    }
    this.sseClients.clear();

    await new Promise<void>((resolve, reject) => {
      this.server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private broadcast(event: RuntimeEvent): void {
    for (const client of this.sseClients) {
      writeSse(client, event);
    }
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const method = request.method ?? 'GET';
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`);
    const { pathname } = url;

    try {
      if (method === 'GET' && pathname === '/health') {
        sendJson(response, 200, { ok: true, status: this.runtime.getStatus() });
        return;
      }

      if (method === 'GET' && pathname === '/v1/events') {
        response.writeHead(200, {
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'content-type': 'text/event-stream',
        });
        this.sseClients.add(response);
        writeSse(response, {
          type: 'runtime.connected',
          at: new Date().toISOString(),
          data: this.runtime.getStatus(),
        });
        request.on('close', () => {
          this.sseClients.delete(response);
          response.end();
        });
        return;
      }

      if (method === 'GET' && pathname === '/v1/runtime/status') {
        sendJson(response, 200, this.runtime.getStatus());
        return;
      }

      if (method === 'GET' && pathname === '/v1/runtime/logs') {
        let entries: RuntimeLogEntry[] = [];
        try {
          const raw = await readFile(this.runtime.context.logFile, 'utf8');
          entries = raw
            .split('\n')
            .filter(Boolean)
            .map((line) => JSON.parse(line) as RuntimeLogEntry);
        } catch {
          entries = [];
        }
        sendJson(response, 200, entries);
        return;
      }

      if (method === 'POST' && pathname === '/v1/runtime/connect') {
        const body = await readJsonBody<{ simulatorUrl: string; encoding?: 'json' | 'msgpack' }>(request);
        const status = await this.runtime.connect(body);
        sendJson(response, 200, status);
        return;
      }

      if (method === 'POST' && pathname === '/v1/runtime/disconnect') {
        await this.runtime.disconnect();
        sendJson(response, 200, this.runtime.getStatus());
        return;
      }

      if (method === 'POST' && pathname === '/v1/runtime/stop') {
        sendJson(response, 202, { stopping: true });
        setImmediate(() => {
          void this.runtime.stop().then(() => this.close()).finally(() => {
            process.exit(0);
          });
        });
        return;
      }

      if (method === 'POST' && pathname === '/v1/runtime/sync') {
        await this.runtime.syncScene();
        sendJson(response, 200, this.runtime.getStatus());
        return;
      }

      if (method === 'POST' && pathname === '/v1/runtime/render-trigger') {
        const body = await readJsonBody<{ trigger: RenderTriggerMode }>(request);
        const status = await this.runtime.setRenderTrigger(body.trigger);
        sendJson(response, 200, status);
        return;
      }

      if (method === 'GET' && pathname === '/v1/scene') {
        sendJson(response, 200, {
          status: this.runtime.getStatus(),
          render: this.runtime.getRenderSettings(),
          painters: this.runtime.getPainterIds(),
          scene: this.runtime.inspectScene(),
        });
        return;
      }

      if (method === 'POST' && pathname === '/v1/scene/render') {
        const body = await readJsonBody<{
          reason?: string;
          envId?: string;
          width?: number;
          height?: number;
          viewport?: { x: number; y: number; width: number; height: number };
          format?: 'png' | 'jpeg';
          quality?: number;
          outputPath?: string;
          persist?: boolean;
          includeData?: boolean;
        }>(request);
        const artifacts = await this.runtime.requestRender(
          {
            envId: body.envId,
            width: body.width,
            height: body.height,
            viewport: body.viewport,
            format: body.format,
            quality: body.quality,
            outputPath: body.outputPath,
            persist: body.persist,
            includeData: body.includeData,
          },
          body.reason ?? 'manual',
        );
        sendJson(response, 200, { artifacts });
        return;
      }

      if (method === 'POST' && pathname.startsWith('/v1/scene/actions/')) {
        const alias = decodePathParam('/v1/scene/actions/', pathname);
        if (!alias || !['start', 'step', 'reset'].includes(alias)) {
          sendJson(response, 404, { error: 'Unknown reserved scene action.' });
          return;
        }
        const body = await readJsonBody<{ continuous?: boolean }>(request);
        await this.runtime.runReservedAction(alias as 'start' | 'step' | 'reset', body);
        sendJson(response, 202, { action: alias, accepted: true });
        return;
      }

      if (method === 'GET' && pathname === '/v1/params') {
        sendJson(response, 200, this.runtime.listParameters());
        return;
      }

      if (method === 'POST' && pathname.startsWith('/v1/params/')) {
        const parameterId = decodePathParam('/v1/params/', pathname);
        if (!parameterId) {
          sendJson(response, 404, { error: 'Missing parameter ID.' });
          return;
        }
        const body = await readJsonBody<{ value: unknown }>(request);
        await this.runtime.setParameter(parameterId, body.value);
        sendJson(response, 202, { parameterId, accepted: true });
        return;
      }

      if (method === 'GET' && pathname === '/v1/actions') {
        sendJson(response, 200, this.runtime.listActions());
        return;
      }

      if (method === 'POST' && pathname.startsWith('/v1/actions/')) {
        const actionId = decodePathParam('/v1/actions/', pathname);
        if (!actionId) {
          sendJson(response, 404, { error: 'Missing action ID.' });
          return;
        }
        const body = await readJsonBody<{ continuous?: boolean }>(request);
        await this.runtime.runAction(actionId, body);
        sendJson(response, 202, { actionId, accepted: true });
        return;
      }

      if (method === 'OPTIONS') {
        sendNoContent(response);
        return;
      }

      sendText(response, 404, 'Not found\n');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(response, 500, { error: message });
    }
  }
}