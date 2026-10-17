// #region Imports
import { createAdaptorServer, type ServerType } from '@hono/node-server';
import { AgentRuntime } from './AgentRuntime';
import type { RuntimeEvent } from '../types';
import { buildControlApp } from './control-server/app';
import { listenIPServers, closeIPServers } from '@tensnap/network/node';
import type { IPFamily } from '@tensnap/network';
import { RuntimeSseBroker } from './control-server/sse-broker';

// #endregion

interface ControlServerOptions {
  ip_family?: IPFamily;
  host?: string;
  port?: number;
}

// #region Control Server

export class RuntimeControlServer {
  private readonly broker = new RuntimeSseBroker();
  private readonly app: ReturnType<typeof buildControlApp>;
  private servers: ServerType[] = [];
  private listenPromise?: Promise<{ host: string; port: number }>;
  private closePromise?: Promise<void>;
  private readonly onRuntimeEvent = (event: RuntimeEvent) => this.broker.broadcast(event);

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly options: ControlServerOptions = {},
  ) {
    this.app = buildControlApp(runtime, this.broker, () => {
      void this.shutdownAndExit();
    });
  }

  listen(): Promise<{ host: string; port: number }> {
    if (this.closePromise) return Promise.reject(new Error('Control server is closing.'));
    if (!this.listenPromise) {
      this.runtime.on('event', this.onRuntimeEvent);
      this.listenPromise = this.startListening().catch((error) => {
        this.runtime.off('event', this.onRuntimeEvent);
        this.listenPromise = undefined;
        throw error;
      });
    }
    return this.listenPromise;
  }

  private async startListening(): Promise<{ host: string; port: number }> {
    const host = this.options.host ?? 'localhost';
    const port = this.options.port ?? 0;

    this.servers = await listenIPServers(() => createAdaptorServer({ fetch: this.app.fetch }), {
      host,
      port,
      ip_family: this.options.ip_family,
    });
    try {
      const address = this.servers[0].address();
      if (!address || typeof address === 'string') {
        throw new Error('Unable to determine control server address.');
      }
      await this.runtime.setControlAddress(address.address, address.port);
      return { host: address.address, port: address.port };
    } catch (error) {
      const servers = this.servers;
      this.servers = [];
      try {
        await closeIPServers(servers);
      } catch (cleanupError) {
        throw Object.assign(new Error('Control server startup and rollback failed.'), {
          cause: error,
          errors: [error, cleanupError],
        });
      }
      throw error;
    }
  }

  close(): Promise<void> {
    if (!this.closePromise) {
      this.closePromise = this.closeResources().finally(() => {
        this.listenPromise = undefined;
        this.closePromise = undefined;
      });
    }
    return this.closePromise;
  }

  private async closeResources(): Promise<void> {
    await this.listenPromise?.catch(() => undefined);
    this.runtime.off('event', this.onRuntimeEvent);
    this.broker.closeAll();
    const servers = this.servers;
    this.servers = [];
    await closeIPServers(servers);
  }

  private async shutdownAndExit(): Promise<void> {
    await this.runtime.stop();
    await this.close();
    process.exit(0);
  }
}

// #endregion
