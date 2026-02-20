import https from 'https';
import http from 'http';
import { TagRegistry } from './tag-registry.js';
import { DataGenerator } from './data-generator.js';
import { ScenarioEngine } from './scenario-engine.js';
import { createRestHandler } from './rest-handler.js';
import { WSHandler } from './ws-handler.js';
import { generateSelfSignedCert } from './tls.js';

export interface SimulatorConfig {
  port: number;
  mode: 'auto' | 'manual';
  scenario?: string;
  autoIntervalMs: number;
}

export class SimulatorServer {
  private server: https.Server | null = null;
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  readonly registry: TagRegistry;
  readonly generator: DataGenerator;
  readonly scenarioEngine: ScenarioEngine;
  private wsHandler: WSHandler;
  private restHandler: ReturnType<typeof createRestHandler>;
  private config: SimulatorConfig;
  private startTime = Date.now();

  constructor(config: SimulatorConfig) {
    this.config = config;
    this.registry = new TagRegistry();
    this.generator = new DataGenerator(this.registry);
    this.scenarioEngine = new ScenarioEngine(this.generator, config.mode);
    this.wsHandler = new WSHandler(this.registry, this.generator);
    this.restHandler = createRestHandler(this.registry, this.generator);
  }

  async start(): Promise<void> {
    // Generate self-signed TLS cert
    console.log('[PI Simulator] Generating self-signed TLS certificate...');
    const { key, cert } = generateSelfSignedCert();

    // Seed initial history (generate a few minutes of data so /recorded queries work immediately)
    console.log('[PI Simulator] Seeding initial sensor history...');
    const now = Date.now();
    for (let i = 300; i > 0; i--) {
      const t = new Date(now - i * 1000);
      this.generator.tick(t);
    }

    this.server = https.createServer({ key, cert }, (req, res) => {
      this.handleRequest(req, res);
    });

    // WebSocket upgrade
    this.server.on('upgrade', (req, socket, head) => {
      if (!this.wsHandler.handleUpgrade(req, socket, head)) {
        socket.destroy();
      }
    });

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, () => {
        console.log(`[PI Simulator] Listening on port ${this.config.port}`);
        console.log(`[PI Simulator] Registered ${this.registry.size} tags`);
        console.log(`[PI Simulator] REST API:   https://localhost:${this.config.port}/piwebapi/`);
        console.log(`[PI Simulator] WebSocket:  wss://localhost:${this.config.port}/piwebapi/streamsets/channel`);
        console.log(`[PI Simulator] Admin:      https://localhost:${this.config.port}/admin/status`);

        // Start 1 Hz tick
        this.tickInterval = setInterval(() => {
          this.generator.tick();
        }, 1000);

        // Start scenario engine
        if (this.config.mode === 'auto') {
          this.scenarioEngine.startAuto(this.config.autoIntervalMs);
        } else if (this.config.scenario && this.config.scenario !== 'normal') {
          this.scenarioEngine.activate(this.config.scenario);
        }

        console.log('[PI Simulator] Ready for connections\n');
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    this.scenarioEngine.stopAuto();
    this.scenarioEngine.deactivate();
    this.wsHandler.closeAll();

    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
    }

    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  private handleRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
    // PI Web API REST endpoints
    if (this.restHandler(req, res)) return;

    // Admin endpoints
    const url = new URL(req.url!, `https://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/admin/status' && req.method === 'GET') {
      this.handleAdminStatus(res);
      return;
    }

    if (url.pathname === '/admin/scenario' && req.method === 'POST') {
      this.handleAdminSetScenario(req, res);
      return;
    }

    if (url.pathname === '/admin/scenario/stop' && req.method === 'POST') {
      this.scenarioEngine.deactivate();
      sendJson(res, 200, { status: 'ok', scenario: 'normal' });
      return;
    }

    if (url.pathname === '/admin/scenarios' && req.method === 'GET') {
      sendJson(res, 200, { scenarios: this.scenarioEngine.listScenarios() });
      return;
    }

    // 404
    sendJson(res, 404, { Message: 'Not found' });
  }

  private handleAdminStatus(res: http.ServerResponse): void {
    sendJson(res, 200, {
      status: 'running',
      uptime: Math.round((Date.now() - this.startTime) / 1000),
      tags: this.registry.size,
      wsClients: this.wsHandler.sessionCount,
      activeScenario: this.scenarioEngine.getActiveScenarioName(),
      mode: this.scenarioEngine.getMode(),
    });
  }

  private handleAdminSetScenario(req: http.IncomingMessage, res: http.ServerResponse): void {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        const { name } = JSON.parse(body);
        if (!name) {
          sendJson(res, 400, { error: 'Missing "name" in request body' });
          return;
        }
        const ok = this.scenarioEngine.activate(name);
        if (!ok) {
          sendJson(res, 404, {
            error: `Unknown scenario "${name}"`,
            available: this.scenarioEngine.listScenarios().map((s) => s.name),
          });
          return;
        }
        sendJson(res, 200, { status: 'ok', scenario: name });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    });
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
