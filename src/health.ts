import http from 'http';

export interface HealthDependencies {
  isPiChannelConnected: () => boolean;
  getSensorTagCount: () => number;
  getLastSensorUpdate: () => Date | null;
}

interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  uptime: number;
  timestamp: string;
  checks: {
    piChannel: { connected: boolean };
    sensorData: {
      tagsRegistered: number;
      lastUpdate: string | null;
      staleSec: number | null;
    };
  };
}

export class HealthServer {
  private server: http.Server | null = null;
  private startTime = Date.now();
  private deps: HealthDependencies;
  private port: number;

  constructor(deps: HealthDependencies, port = 8080) {
    this.deps = deps;
    this.port = port;
  }

  getStatus(): HealthResponse {
    const now = new Date();
    const lastUpdate = this.deps.getLastSensorUpdate();
    const staleSec = lastUpdate
      ? Math.round((now.getTime() - lastUpdate.getTime()) / 1000)
      : null;

    const piConnected = this.deps.isPiChannelConnected();
    const tagCount = this.deps.getSensorTagCount();

    let status: HealthResponse['status'] = 'healthy';
    if (!piConnected) {
      status = 'unhealthy';
    } else if (staleSec !== null && staleSec > 60) {
      status = 'degraded';
    }

    return {
      status,
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      timestamp: now.toISOString(),
      checks: {
        piChannel: { connected: piConnected },
        sensorData: {
          tagsRegistered: tagCount,
          lastUpdate: lastUpdate?.toISOString() ?? null,
          staleSec,
        },
      },
    };
  }

  start(): Promise<void> {
    return new Promise((resolve) => {
      this.server = http.createServer((req, res) => {
        if (req.url === '/health' && req.method === 'GET') {
          const health = this.getStatus();
          const code = health.status === 'unhealthy' ? 503 : 200;
          res.writeHead(code, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(health));
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.server.listen(this.port, () => {
        console.log(`[Health] Listening on port ${this.port}`);
        resolve();
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }
}
