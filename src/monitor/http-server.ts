import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { Socket } from 'node:net';
import { SSEBridge } from './sse-bridge.js';
import type { SwarmEvent } from '../types.js';

export interface MonitorHandle {
  /** The port the monitor is listening on. */
  port: number;
  /** Broadcast a SwarmEvent to all connected SSE clients. */
  broadcast(event: SwarmEvent): void;
  /** Get the current state snapshot. */
  getState(): ReturnType<SSEBridge['getStateJSON']>;
  /** Close the HTTP server. */
  close(): Promise<void>;
}

export interface MonitorOptions {
  /** Port to listen on. Use 0 for random available port. Default: 4820. */
  port?: number;
}

export function createMonitorServer(options?: MonitorOptions): {
  server: Server;
  bridge: SSEBridge;
} {
  const bridge = new SSEBridge();

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    // CORS headers for cross-origin access
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = req.url ?? '/';

    switch (url) {
      case '/events':
        bridge.addClient(res);
        break;

      case '/state':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(bridge.getStateJSON()));
        break;

      case '/health':
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        break;

      default:
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    }
  });

  return { server, bridge };
}

export async function startMonitorServer(options?: MonitorOptions): Promise<MonitorHandle> {
  const port = options?.port ?? 4820;
  const { server, bridge } = createMonitorServer(options);

  // Track open sockets so we can destroy them on close (SSE connections stay alive)
  const sockets = new Set<Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });

  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(port, () => {
      const addr = server.address();
      const actualPort = typeof addr === 'object' && addr ? addr.port : port;

      resolve({
        port: actualPort,
        broadcast: (event: SwarmEvent) => bridge.broadcast(event),
        getState: () => bridge.getStateJSON(),
        close: () => new Promise<void>((res, rej) => {
          // Destroy all open sockets so SSE connections don't block shutdown
          for (const socket of sockets) {
            socket.destroy();
          }
          sockets.clear();
          server.close((err) => err ? rej(err) : res());
        }),
      });
    });
  });
}
