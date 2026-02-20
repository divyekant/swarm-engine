import { describe, it, expect, afterEach } from 'vitest';
import { startMonitor } from '../../src/monitor/index.js';
import http from 'node:http';

function httpGet(url: string): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode!, body, headers: res.headers }));
    }).on('error', reject);
  });
}

describe('Monitor HTTP Server', () => {
  let monitor: Awaited<ReturnType<typeof startMonitor>> | null = null;

  afterEach(async () => {
    if (monitor) {
      await monitor.close();
      monitor = null;
    }
  });

  it('starts on the specified port', async () => {
    monitor = await startMonitor({ port: 0 }); // port 0 = random available port
    expect(monitor.port).toBeGreaterThan(0);
  });

  it('returns health check on GET /health', async () => {
    monitor = await startMonitor({ port: 0 });
    const { status, body } = await httpGet(`http://localhost:${monitor.port}/health`);
    expect(status).toBe(200);
    expect(JSON.parse(body)).toEqual({ status: 'ok' });
  });

  it('returns state snapshot on GET /state', async () => {
    monitor = await startMonitor({ port: 0 });
    const { status, body } = await httpGet(`http://localhost:${monitor.port}/state`);
    expect(status).toBe(200);
    const state = JSON.parse(body);
    expect(state).toHaveProperty('dagId');
    expect(state).toHaveProperty('status');
  });

  it('returns SSE stream on GET /events', async () => {
    monitor = await startMonitor({ port: 0 });

    // Connect to SSE endpoint and collect the broadcast event
    const eventPromise = new Promise<string>((resolve, reject) => {
      http.get(`http://localhost:${monitor!.port}/events`, (res) => {
        expect(res.headers['content-type']).toBe('text/event-stream');

        let collected = '';
        res.on('data', (chunk) => {
          collected += chunk.toString();
          // Wait until we have a "data:" line (skip the initial SSE comment)
          if (collected.includes('data: ')) {
            resolve(collected);
            res.destroy(); // close after receiving the event
          }
        });

        // The response callback fires once headers are flushed (via the
        // initial SSE comment). The client is now registered in SSEBridge,
        // so we can safely broadcast.
        monitor!.broadcast({
          type: 'swarm_start',
          dagId: 'test-dag',
          nodeCount: 2,
        });
      }).on('error', (e) => {
        // Ignore ECONNRESET from res.destroy()
        if ((e as NodeJS.ErrnoException).code !== 'ECONNRESET') reject(e);
      });
    });

    const sseData = await eventPromise;
    expect(sseData).toContain('data: ');
    expect(sseData).toContain('"type":"swarm_start"');
  });

  it('returns 404 for unknown routes', async () => {
    monitor = await startMonitor({ port: 0 });
    const { status } = await httpGet(`http://localhost:${monitor.port}/unknown`);
    expect(status).toBe(404);
  });
});
