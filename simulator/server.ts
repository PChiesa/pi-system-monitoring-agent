import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { TagRegistry } from './tag-registry.js';
import { DataGenerator } from './data-generator.js';
import { ScenarioEngine } from './scenario-engine.js';
import { createRestHandler } from './rest-handler.js';
import { WSHandler } from './ws-handler.js';
import { generateSelfSignedCert } from './tls.js';
import { getOpenApiSpec, getExplorerHtml, getWsTestHtml, type AFElementInfo } from './openapi.js';
import {
  createCustomScenario,
  type CustomScenarioDefinition,
} from './custom-scenario.js';
import { AFModel } from './af-model.js';
import { createAFHandler } from './af-handler.js';
import { createImportHandler } from './import-handler.js';
import { sendJson, readBody } from './utils.js';

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
  readonly afModel: AFModel;
  private afHandler: ReturnType<typeof createAFHandler>;
  private importHandler: ReturnType<typeof createImportHandler>;
  private config: SimulatorConfig;
  private startTime = Date.now();
  private customScenarios = new Map<string, CustomScenarioDefinition>();
  private customTagGroups = new Map<string, string>();

  constructor(config: SimulatorConfig) {
    this.config = config;
    this.registry = new TagRegistry();
    this.generator = new DataGenerator(this.registry);
    this.scenarioEngine = new ScenarioEngine(this.generator, config.mode);
    this.wsHandler = new WSHandler(this.registry, this.generator);
    this.restHandler = createRestHandler(this.registry, this.generator);
    this.afModel = new AFModel(this.registry);
    this.wsHandler.setAFModel(this.afModel);
    this.afHandler = createAFHandler(this.afModel, this.generator);
    this.importHandler = createImportHandler(this.afModel, this.registry, this.generator);
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
        console.log(`[PI Simulator] OpenAPI:    https://localhost:${this.config.port}/openapi.json`);
        console.log(`[PI Simulator] Explorer:   https://localhost:${this.config.port}/docs`);
        console.log(`[PI Simulator] WS Test:    https://localhost:${this.config.port}/ws-test`);
        console.log(`[PI Simulator] Config UI:  https://localhost:${this.config.port}/ui/`);

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
    // CORS headers for dev (Vite dev server on a different port)
    if (req.headers.origin) {
      res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // PI Web API REST endpoints
    if (this.restHandler(req, res)) return;

    // PI Web API AF endpoints
    if (this.afHandler(req, res)) return;

    // AF import from remote PI Web API
    if (this.importHandler(req, res)) return;

    // Admin endpoints
    const url = new URL(req.url!, `https://${req.headers.host || 'localhost'}`);

    if (url.pathname === '/openapi.json' && req.method === 'GET') {
      sendJson(res, 200, getOpenApiSpec({
        port: this.config.port,
        registry: this.registry,
        scenarioEngine: this.scenarioEngine,
      }));
      return;
    }

    if ((url.pathname === '/docs' || url.pathname === '/docs/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getExplorerHtml(this.config.port));
      return;
    }

    if ((url.pathname === '/ws-test' || url.pathname === '/ws-test/') && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getWsTestHtml(this.config.port, this.registry.getAllMeta(), this.getAFElements()));
      return;
    }

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

    // Custom scenario CRUD
    if (url.pathname === '/admin/scenarios/custom' && req.method === 'GET') {
      sendJson(res, 200, { scenarios: [...this.customScenarios.values()] });
      return;
    }

    if (url.pathname === '/admin/scenarios/custom' && req.method === 'POST') {
      this.handleCreateCustomScenario(req, res);
      return;
    }

    const customScenarioMatch = url.pathname.match(/^\/admin\/scenarios\/custom\/([^/]+)$/);
    if (customScenarioMatch) {
      const name = decodeURIComponent(customScenarioMatch[1]!);
      if (req.method === 'GET') {
        const def = this.customScenarios.get(name);
        if (!def) { sendJson(res, 404, { error: `Custom scenario "${name}" not found` }); return; }
        sendJson(res, 200, def);
        return;
      }
      if (req.method === 'PUT') {
        this.handleUpdateCustomScenario(req, res, name);
        return;
      }
      if (req.method === 'DELETE') {
        this.handleDeleteCustomScenario(res, name);
        return;
      }
    }

    // AF admin CRUD endpoints
    if (url.pathname === '/admin/af/databases' && req.method === 'GET') {
      sendJson(res, 200, { databases: this.afModel.getDatabases() });
      return;
    }

    if (url.pathname === '/admin/af/databases' && req.method === 'POST') {
      readBody(req, (body) => {
        try {
          const { name, description } = JSON.parse(body);
          if (!name) { sendJson(res, 400, { error: 'Missing "name"' }); return; }
          const db = this.afModel.createDatabase(name, description ?? '');
          sendJson(res, 201, db);
        } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
      });
      return;
    }

    if (url.pathname === '/admin/af/elements' && req.method === 'POST') {
      readBody(req, (body) => {
        try {
          const { parentWebId, name, description } = JSON.parse(body);
          if (!parentWebId || !name) {
            sendJson(res, 400, { error: 'Missing "parentWebId" or "name"' });
            return;
          }
          const el = this.afModel.createElement(parentWebId, name, description ?? '');
          if (!el) { sendJson(res, 404, { error: 'Parent not found' }); return; }
          sendJson(res, 201, el);
        } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
      });
      return;
    }

    const afElementMatch = url.pathname.match(/^\/admin\/af\/elements\/([^/]+)$/);
    if (afElementMatch) {
      const webId = decodeURIComponent(afElementMatch[1]!);
      if (req.method === 'PUT') {
        readBody(req, (body) => {
          try {
            const updates = JSON.parse(body);
            const ok = this.afModel.updateElement(webId, updates);
            if (!ok) { sendJson(res, 404, { error: 'Element not found' }); return; }
            sendJson(res, 200, this.afModel.getElement(webId));
          } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
        });
        return;
      }
      if (req.method === 'DELETE') {
        const ok = this.afModel.deleteElement(webId);
        if (!ok) { sendJson(res, 404, { error: 'Element not found' }); return; }
        sendJson(res, 200, { status: 'ok', deleted: webId });
        return;
      }
    }

    if (url.pathname === '/admin/af/attributes' && req.method === 'POST') {
      readBody(req, (body) => {
        try {
          const { elementWebId, name, type, defaultUOM, piPointName, description } = JSON.parse(body);
          if (!elementWebId || !name) {
            sendJson(res, 400, { error: 'Missing "elementWebId" or "name"' });
            return;
          }
          const attr = this.afModel.createAttribute(
            elementWebId, name, type ?? 'Double', defaultUOM ?? '', piPointName ?? null, description ?? ''
          );
          if (!attr) { sendJson(res, 404, { error: 'Element not found' }); return; }
          sendJson(res, 201, attr);
        } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
      });
      return;
    }

    const afAttributeMatch = url.pathname.match(/^\/admin\/af\/attributes\/([^/]+)$/);
    if (afAttributeMatch) {
      const webId = decodeURIComponent(afAttributeMatch[1]!);
      if (req.method === 'PUT') {
        readBody(req, (body) => {
          try {
            const updates = JSON.parse(body);
            const ok = this.afModel.updateAttribute(webId, updates);
            if (!ok) { sendJson(res, 404, { error: 'Attribute not found' }); return; }
            sendJson(res, 200, this.afModel.getAttribute(webId));
          } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
        });
        return;
      }
      if (req.method === 'DELETE') {
        const ok = this.afModel.deleteAttribute(webId);
        if (!ok) { sendJson(res, 404, { error: 'Attribute not found' }); return; }
        sendJson(res, 200, { status: 'ok', deleted: webId });
        return;
      }
    }

    // Tag admin endpoints
    if (url.pathname === '/admin/tags' && req.method === 'POST') {
      this.handleAdminCreateTag(req, res);
      return;
    }

    if (url.pathname === '/admin/tags' && req.method === 'GET') {
      this.handleAdminGetTags(res);
      return;
    }

    const tagProfileMatch = url.pathname.match(/^\/admin\/tags\/([^/]+)\/profile$/);
    if (tagProfileMatch && req.method === 'PUT') {
      this.handleAdminUpdateTagProfile(req, res, decodeURIComponent(tagProfileMatch[1]!));
      return;
    }

    const tagOverrideMatch = url.pathname.match(/^\/admin\/tags\/([^/]+)\/override$/);
    if (tagOverrideMatch) {
      const tagName = decodeURIComponent(tagOverrideMatch[1]!);
      if (req.method === 'POST') {
        this.handleAdminSetOverride(req, res, tagName);
        return;
      }
      if (req.method === 'DELETE') {
        this.handleAdminClearOverride(res, tagName);
        return;
      }
    }

    // DELETE /admin/tags/:tagName — must come after /profile and /override matches
    const tagDeleteMatch = url.pathname.match(/^\/admin\/tags\/([^/]+)$/);
    if (tagDeleteMatch && req.method === 'DELETE') {
      this.handleAdminDeleteTag(res, decodeURIComponent(tagDeleteMatch[1]!));
      return;
    }

    // Serve React UI static files
    if (url.pathname === '/ui' || url.pathname.startsWith('/ui/')) {
      this.serveStaticUI(url.pathname, res);
      return;
    }

    // 404
    sendJson(res, 404, { Message: 'Not found' });
  }

  private serveStaticUI(pathname: string, res: http.ServerResponse): void {
    const uiDistDir = path.join(import.meta.dir, 'ui', 'dist');
    let filePath = pathname.replace(/^\/ui\/?/, '') || 'index.html';

    const fullPath = path.join(uiDistDir, filePath);

    // Prevent path traversal
    if (!fullPath.startsWith(uiDistDir)) {
      sendJson(res, 403, { Message: 'Forbidden' });
      return;
    }

    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
        const content = fs.readFileSync(fullPath);
        res.writeHead(200, { 'Content-Type': getMimeType(fullPath) });
        res.end(content);
      } else {
        // SPA fallback: serve index.html for client-side routes
        const indexPath = path.join(uiDistDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          const content = fs.readFileSync(indexPath);
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(content);
        } else {
          sendJson(res, 404, { Message: 'UI not built. Run: cd simulator/ui && npm run build' });
        }
      }
    } catch {
      sendJson(res, 500, { Message: 'Error serving static file' });
    }
  }

  private getAFElements(): AFElementInfo[] {
    const buildTree = (elements: { webId: string; name: string; path: string; children: any[] }[]): AFElementInfo[] =>
      elements.map(el => ({
        webId: el.webId,
        name: el.name,
        path: el.path,
        children: buildTree(el.children),
      }));
    const result: AFElementInfo[] = [];
    for (const db of this.afModel.getDatabases()) {
      result.push(...buildTree(db.elements));
    }
    return result;
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
    readBody(req, (body) => {
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

  private handleAdminGetTags(res: http.ServerResponse): void {
    const profiles = this.generator.getAllProfiles();
    const tags = this.registry.getAllMeta().map((meta) => ({
      tagName: meta.tagName,
      webId: meta.webId,
      unit: meta.unit,
      path: meta.path,
      group: this.customTagGroups.get(meta.tagName) ?? getTagGroup(meta.tagName),
      profile: profiles.get(meta.tagName) ?? null,
      currentValue: this.generator.getCurrentValue(meta.tagName) ?? null,
      hasOverride: this.generator.hasOverride(meta.tagName),
    }));
    sendJson(res, 200, { tags });
  }

  private handleAdminUpdateTagProfile(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    tagName: string
  ): void {
    readBody(req, (body) => {
      try {
        const updates = JSON.parse(body);
        const ok = this.generator.updateProfile(tagName, updates);
        if (!ok) {
          sendJson(res, 404, { error: `Unknown tag "${tagName}"` });
          return;
        }
        sendJson(res, 200, { status: 'ok', tagName, profile: this.generator.getProfile(tagName) });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    });
  }

  private handleAdminSetOverride(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    tagName: string
  ): void {
    readBody(req, (body) => {
      try {
        const { value } = JSON.parse(body);
        if (value === undefined || value === null) {
          sendJson(res, 400, { error: 'Missing "value" in request body' });
          return;
        }
        const ok = this.generator.setOverride(tagName, value);
        if (!ok) {
          sendJson(res, 404, { error: `Unknown tag "${tagName}"` });
          return;
        }
        sendJson(res, 200, { status: 'ok', tagName, override: value });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    });
  }

  private handleAdminClearOverride(res: http.ServerResponse, tagName: string): void {
    const ok = this.generator.clearOverride(tagName);
    if (!ok) {
      sendJson(res, 404, { error: `Unknown tag "${tagName}"` });
      return;
    }
    sendJson(res, 200, { status: 'ok', tagName, override: null });
  }

  private handleAdminDeleteTag(res: http.ServerResponse, tagName: string): void {
    if (!this.registry.getByTagName(tagName)) {
      sendJson(res, 404, { error: `Unknown tag "${tagName}"` });
      return;
    }
    this.generator.unregisterTag(tagName);
    this.registry.unregister(tagName);
    this.customTagGroups.delete(tagName);
    sendJson(res, 200, { status: 'ok', deleted: tagName });
  }

  private handleAdminCreateTag(req: http.IncomingMessage, res: http.ServerResponse): void {
    readBody(req, (body) => {
      try {
        const { tagName, unit, group, profile } = JSON.parse(body);
        if (!tagName || !profile) {
          sendJson(res, 400, { error: 'Missing required fields: tagName, profile' });
          return;
        }
        if (this.registry.getByTagName(tagName)) {
          sendJson(res, 409, { error: `Tag "${tagName}" already exists` });
          return;
        }
        const meta = this.registry.register(tagName, unit ?? '');
        this.generator.registerTag(tagName, profile);
        if (group) {
          this.customTagGroups.set(tagName, group);
        }
        sendJson(res, 201, {
          status: 'ok',
          tag: {
            tagName: meta.tagName,
            webId: meta.webId,
            unit: meta.unit,
            path: meta.path,
            group: group ?? getTagGroup(tagName),
            profile,
          },
        });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    });
  }

  private handleCreateCustomScenario(req: http.IncomingMessage, res: http.ServerResponse): void {
    readBody(req, (body) => {
      try {
        const def = JSON.parse(body) as CustomScenarioDefinition;
        if (!def.name || !def.durationMs || !Array.isArray(def.modifiers)) {
          sendJson(res, 400, { error: 'Missing required fields: name, durationMs, modifiers[]' });
          return;
        }
        if (this.scenarioEngine.isBuiltIn(def.name)) {
          sendJson(res, 409, { error: `Cannot overwrite built-in scenario "${def.name}"` });
          return;
        }
        this.customScenarios.set(def.name, def);
        this.scenarioEngine.register(createCustomScenario(def));
        sendJson(res, 201, { status: 'ok', scenario: def.name });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    });
  }

  private handleUpdateCustomScenario(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    name: string
  ): void {
    readBody(req, (body) => {
      try {
        if (!this.customScenarios.has(name)) {
          sendJson(res, 404, { error: `Custom scenario "${name}" not found` });
          return;
        }
        const def = JSON.parse(body) as CustomScenarioDefinition;
        def.name = name; // Enforce URL name
        this.customScenarios.set(name, def);
        this.scenarioEngine.unregister(name);
        this.scenarioEngine.register(createCustomScenario(def));
        sendJson(res, 200, { status: 'ok', scenario: name });
      } catch {
        sendJson(res, 400, { error: 'Invalid JSON body' });
      }
    });
  }

  private handleDeleteCustomScenario(res: http.ServerResponse, name: string): void {
    if (!this.customScenarios.has(name)) {
      sendJson(res, 404, { error: `Custom scenario "${name}" not found` });
      return;
    }
    this.customScenarios.delete(name);
    this.scenarioEngine.unregister(name);
    sendJson(res, 200, { status: 'ok', deleted: name });
  }
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  };
  return types[ext] ?? 'application/octet-stream';
}

function getTagGroup(tagName: string): string {
  if (tagName.startsWith('BOP.ACC.')) return 'Accumulator';
  if (tagName.startsWith('BOP.ANN')) return 'Annular';
  if (tagName.startsWith('BOP.RAM.')) return 'Ram';
  if (tagName.startsWith('BOP.MAN.') || tagName.startsWith('BOP.CHOKE.') || tagName.startsWith('BOP.KILL.')) return 'Manifold';
  if (tagName.startsWith('BOP.CTRL.')) return 'Control';
  if (tagName.startsWith('WELL.')) return 'Wellbore';
  return 'Other';
}
