// #region Imports
import { createAdaptorServer, type ServerType } from '@hono/node-server';
import { AgentRuntime } from './AgentRuntime';
import type { RuntimeEvent } from '../types';
import { buildControlApp } from './control-server/app';
import { RuntimeSseBroker } from './control-server/sse-broker';

// #endregion

interface ControlServerOptions {
  host?: string;
  port?: number;
}

// #region Control Server

export class RuntimeControlServer {
  private readonly broker = new RuntimeSseBroker();
  private readonly app: ReturnType<typeof buildControlApp>;
  private server: ServerType | null = null;

  constructor(
    private readonly runtime: AgentRuntime,
    private readonly options: ControlServerOptions = {},
  ) {
    this.app = buildControlApp(runtime, this.broker, () => {
      void this.shutdownAndExit();
    });
    this.runtime.on('event', (event) => this.broker.broadcast(event as RuntimeEvent));
  }

  async listen(): Promise<{ host: string; port: number }> {
    const host = this.options.host ?? '127.0.0.1';
    const port = this.options.port ?? 0;

    const server = createAdaptorServer({
      fetch: this.app.fetch,
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('Unable to determine control server address.');
    }

    await this.runtime.setControlAddress(address.address, address.port);
    return { host: address.address, port: address.port };
  }

  async close(): Promise<void> {
    this.broker.closeAll();
    if (!this.server) {
      return;
    }

    const server = this.server;
    this.server = null;

    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  private async shutdownAndExit(): Promise<void> {
    await this.runtime.stop();
    await this.close();
    process.exit(0);
  }
}

// #endregion