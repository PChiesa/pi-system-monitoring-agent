import { describe, it, expect, beforeEach, afterEach, jest, spyOn } from 'bun:test';
import { HealthServer, HealthDependencies } from '../src/health';

function makeDeps(overrides: Partial<HealthDependencies> = {}): HealthDependencies {
  return {
    isPiChannelConnected: () => true,
    getSensorTagCount: () => 25,
    getLastSensorUpdate: () => new Date(),
    ...overrides,
  };
}

describe('HealthServer', () => {
  let server: HealthServer;

  beforeEach(() => {
    spyOn(console, 'log').mockImplementation((() => {}) as any);
  });

  afterEach(async () => {
    if (server) await server.stop();
    jest.restoreAllMocks();
  });

  describe('getStatus', () => {
    it('returns healthy when PI channel is connected and data is fresh', () => {
      server = new HealthServer(makeDeps());
      const status = server.getStatus();

      expect(status.status).toBe('healthy');
      expect(status.checks.piChannel.connected).toBe(true);
      expect(status.checks.sensorData.tagsRegistered).toBe(25);
      expect(status.checks.sensorData.staleSec).toBeLessThanOrEqual(1);
      expect(status.uptime).toBeGreaterThanOrEqual(0);
      expect(status.timestamp).toBeDefined();
    });

    it('returns unhealthy when PI channel is disconnected', () => {
      server = new HealthServer(makeDeps({ isPiChannelConnected: () => false }));
      const status = server.getStatus();

      expect(status.status).toBe('unhealthy');
      expect(status.checks.piChannel.connected).toBe(false);
    });

    it('returns degraded when sensor data is stale (>60s)', () => {
      const staleDate = new Date(Date.now() - 120_000);
      server = new HealthServer(makeDeps({ getLastSensorUpdate: () => staleDate }));
      const status = server.getStatus();

      expect(status.status).toBe('degraded');
      expect(status.checks.sensorData.staleSec).toBeGreaterThan(60);
    });

    it('returns healthy with null lastUpdate when no data received yet', () => {
      server = new HealthServer(makeDeps({ getLastSensorUpdate: () => null }));
      const status = server.getStatus();

      expect(status.status).toBe('healthy');
      expect(status.checks.sensorData.lastUpdate).toBeNull();
      expect(status.checks.sensorData.staleSec).toBeNull();
    });
  });

  describe('HTTP server', () => {
    it('responds 200 on /health when healthy', async () => {
      server = new HealthServer(makeDeps(), 0);
      await server.start();

      const addr = (server as any).server.address();
      const res = await fetch(`http://localhost:${addr.port}/health`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.status).toBe('healthy');
    });

    it('responds 503 on /health when unhealthy', async () => {
      server = new HealthServer(
        makeDeps({ isPiChannelConnected: () => false }),
        0
      );
      await server.start();

      const addr = (server as any).server.address();
      const res = await fetch(`http://localhost:${addr.port}/health`);

      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe('unhealthy');
    });

    it('responds 404 on unknown paths', async () => {
      server = new HealthServer(makeDeps(), 0);
      await server.start();

      const addr = (server as any).server.address();
      const res = await fetch(`http://localhost:${addr.port}/unknown`);

      expect(res.status).toBe(404);
    });

    it('stop is safe to call when server not started', async () => {
      server = new HealthServer(makeDeps());
      await expect(server.stop()).resolves.toBeUndefined();
    });
  });
});
