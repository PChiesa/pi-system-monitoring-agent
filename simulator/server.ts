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
import {
  createTagSchema,
  updateTagProfileSchema,
  setOverrideSchema,
  createAFDatabaseSchema,
  createAFElementSchema,
  createAFAttributeSchema,
  updateAFElementSchema,
  updateAFAttributeSchema,
  customScenarioSchema,
  activateScenarioSchema,
  formatZodError,
} from './validation.js';
import { initDatabase, waitForDatabase, closeDatabase, hasDb } from './db/connection.js';
import { loadAllTags, insertTag, updateTagProfile as dbUpdateTagProfile, updateTagGroup as dbUpdateTagGroup, deleteTag as dbDeleteTag, rowToProfile } from './db/tag-repository.js';
import { loadAllDatabases, loadAllElements, loadAllAttributes, insertDatabase as dbInsertDatabase, insertElement as dbInsertElement, insertAttribute as dbInsertAttribute, updateElement as dbUpdateElement, updateAttribute as dbUpdateAttribute, deleteElement as dbDeleteElement, deleteAttribute as dbDeleteAttribute } from './db/af-repository.js';
import { loadAllCustomScenarios, insertCustomScenario as dbInsertCustomScenario, updateCustomScenario as dbUpdateCustomScenario, deleteCustomScenario as dbDeleteCustomScenario } from './db/scenario-repository.js';

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
  private corsAllowedOrigins: string[];

  constructor(config: SimulatorConfig) {
    this.config = config;
    this.corsAllowedOrigins = buildCorsAllowlist(config.port);
    this.registry = new TagRegistry();
    this.generator = new DataGenerator(this.registry);
    this.scenarioEngine = new ScenarioEngine(this.generator, config.mode);
    this.wsHandler = new WSHandler(this.registry, this.generator);
    this.restHandler = createRestHandler(this.registry, this.generator);
    this.afModel = new AFModel();
    this.wsHandler.setAFModel(this.afModel);
    this.afHandler = createAFHandler(this.afModel, this.generator);
    this.importHandler = createImportHandler(this.afModel, this.registry, this.generator);
  }

  /** Initialize data — load from DB if DATABASE_URL is set, otherwise use in-memory defaults. */
  async init(): Promise<void> {
    if (process.env.DATABASE_URL) {
      console.log('[PI Simulator] DATABASE_URL set — connecting to PostgreSQL...');
      initDatabase();
      await waitForDatabase();

      // Load tags
      const tagRows = await loadAllTags();
      this.registry.loadFromDatabase(tagRows.map((r) => ({ tagName: r.tag_name, unit: r.unit })));
      const profiles = new Map<string, import('./data-generator.js').TagProfile>();
      for (const row of tagRows) {
        profiles.set(row.tag_name, rowToProfile(row));
        if (row.custom_group) this.customTagGroups.set(row.tag_name, row.custom_group);
      }
      this.generator.loadProfiles(profiles);

      // Load AF hierarchy
      const dbRows = await loadAllDatabases();
      const elRows = await loadAllElements();
      const attrRows = await loadAllAttributes();
      this.afModel.loadFromDatabase(dbRows, elRows, attrRows);

      // Load custom scenarios
      const scenarioDefs = await loadAllCustomScenarios();
      for (const def of scenarioDefs) {
        this.customScenarios.set(def.name, def);
        this.scenarioEngine.register(createCustomScenario(def));
      }

      console.log(
        `[PI Simulator] Loaded from DB: ${tagRows.length} tags, ${dbRows.length} AF databases, ${elRows.length} elements, ${attrRows.length} attributes, ${scenarioDefs.length} scenarios`
      );
    } else {
      console.log('[PI Simulator] No DATABASE_URL — using in-memory defaults');
      this.registry.loadFromDefaults();
      this.generator.loadFromDefaults();
      this.afModel.loadFromDefaults();
    }
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
        } else if (this.config.scenario) {
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

    if (hasDb()) {
      await closeDatabase();
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
    // Security headers
    setSecurityHeaders(res);

    // CORS — only allow configured origins (not arbitrary reflection)
    if (req.headers.origin && this.corsAllowedOrigins.includes(req.headers.origin)) {
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
      // Docs page uses inline scripts and an external CDN script — relax CSP for this page
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline'"
      );
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(getExplorerHtml(this.config.port));
      return;
    }

    if ((url.pathname === '/ws-test' || url.pathname === '/ws-test/') && req.method === 'GET') {
      // WS test page uses inline scripts and onclick handlers — relax CSP for this page
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' wss:"
      );
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
      sendJson(res, 200, { status: 'ok', scenario: 'none' });
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
      readBody(req, res, async (body) => {
        try {
          const parsed = createAFDatabaseSchema.safeParse(JSON.parse(body));
          if (!parsed.success) { sendJson(res, 400, { error: formatZodError(parsed.error) }); return; }
          const { name, description } = parsed.data;
          const db = this.afModel.createDatabase(name, description ?? '');
          if (hasDb()) {
            try {
              const row = await dbInsertDatabase(name, description ?? '');
              this.afModel.setDbId(db.webId, row.id);
            } catch (err) { console.warn('[DB] Failed to persist AF database:', err); }
          }
          sendJson(res, 201, db);
        } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
      });
      return;
    }

    if (url.pathname === '/admin/af/elements' && req.method === 'POST') {
      readBody(req, res, async (body) => {
        try {
          const parsed = createAFElementSchema.safeParse(JSON.parse(body));
          if (!parsed.success) {
            sendJson(res, 400, { error: formatZodError(parsed.error) });
            return;
          }
          const { parentWebId, name, description } = parsed.data;
          const el = this.afModel.createElement(parentWebId, name, description ?? '');
          if (!el) { sendJson(res, 404, { error: 'Parent not found' }); return; }
          if (hasDb()) {
            try {
              // Resolve DB ids for parent
              const parentDbId = this.afModel.getDbId(parentWebId);
              const isDbParent = this.afModel.isDatabaseWebId(parentWebId);
              const databaseDbId = isDbParent
                ? parentDbId
                : this.afModel.getDbId(el.databaseWebId);
              if (databaseDbId !== undefined) {
                const row = await dbInsertElement(
                  name,
                  description ?? '',
                  databaseDbId,
                  isDbParent ? null : (parentDbId ?? null)
                );
                this.afModel.setDbId(el.webId, row.id);
              }
            } catch (err) { console.warn('[DB] Failed to persist AF element:', err); }
          }
          sendJson(res, 201, el);
        } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
      });
      return;
    }

    const afElementMatch = url.pathname.match(/^\/admin\/af\/elements\/([^/]+)$/);
    if (afElementMatch) {
      const webId = decodeURIComponent(afElementMatch[1]!);
      if (req.method === 'PUT') {
        readBody(req, res, async (body) => {
          try {
            const parsed = updateAFElementSchema.safeParse(JSON.parse(body));
            if (!parsed.success) { sendJson(res, 400, { error: formatZodError(parsed.error) }); return; }
            const updates = parsed.data;
            const ok = this.afModel.updateElement(webId, updates);
            if (!ok) { sendJson(res, 404, { error: 'Element not found' }); return; }
            if (hasDb()) {
              try {
                const dbId = this.afModel.getDbId(webId);
                if (dbId !== undefined) await dbUpdateElement(dbId, updates);
              } catch (err) { console.warn('[DB] Failed to persist AF element update:', err); }
            }
            sendJson(res, 200, this.afModel.getElement(webId));
          } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
        });
        return;
      }
      if (req.method === 'DELETE') {
        if (hasDb()) {
          const dbId = this.afModel.getDbId(webId);
          if (dbId !== undefined) {
            dbDeleteElement(dbId).catch((err) => console.warn('[DB] Failed to persist AF element delete:', err));
          }
        }
        const ok = this.afModel.deleteElement(webId);
        if (!ok) { sendJson(res, 404, { error: 'Element not found' }); return; }
        sendJson(res, 200, { status: 'ok', deleted: webId });
        return;
      }
    }

    if (url.pathname === '/admin/af/attributes' && req.method === 'POST') {
      readBody(req, res, async (body) => {
        try {
          const parsed = createAFAttributeSchema.safeParse(JSON.parse(body));
          if (!parsed.success) {
            sendJson(res, 400, { error: formatZodError(parsed.error) });
            return;
          }
          const { elementWebId, name, type, defaultUOM, piPointName, description } = parsed.data;
          const attr = this.afModel.createAttribute(
            elementWebId, name, type ?? 'Double', defaultUOM ?? '', piPointName ?? null, description ?? ''
          );
          if (!attr) { sendJson(res, 404, { error: 'Element not found' }); return; }
          if (hasDb()) {
            try {
              const elDbId = this.afModel.getDbId(elementWebId);
              if (elDbId !== undefined) {
                const row = await dbInsertAttribute(
                  name, description ?? '', type ?? 'Double', defaultUOM ?? '', piPointName ?? null, elDbId
                );
                this.afModel.setDbId(attr.webId, row.id);
              }
            } catch (err) { console.warn('[DB] Failed to persist AF attribute:', err); }
          }
          sendJson(res, 201, attr);
        } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
      });
      return;
    }

    const afAttributeMatch = url.pathname.match(/^\/admin\/af\/attributes\/([^/]+)$/);
    if (afAttributeMatch) {
      const webId = decodeURIComponent(afAttributeMatch[1]!);
      if (req.method === 'PUT') {
        readBody(req, res, async (body) => {
          try {
            const parsed = updateAFAttributeSchema.safeParse(JSON.parse(body));
            if (!parsed.success) { sendJson(res, 400, { error: formatZodError(parsed.error) }); return; }
            const updates = parsed.data;
            const ok = this.afModel.updateAttribute(webId, updates);
            if (!ok) { sendJson(res, 404, { error: 'Attribute not found' }); return; }
            if (hasDb()) {
              try {
                const dbId = this.afModel.getDbId(webId);
                if (dbId !== undefined) {
                  await dbUpdateAttribute(dbId, {
                    name: updates.name,
                    description: updates.description,
                    type: updates.type,
                    defaultUom: updates.defaultUOM,
                    piPointName: updates.piPointName,
                  });
                }
              } catch (err) { console.warn('[DB] Failed to persist AF attribute update:', err); }
            }
            sendJson(res, 200, this.afModel.getAttribute(webId));
          } catch { sendJson(res, 400, { error: 'Invalid JSON body' }); }
        });
        return;
      }
      if (req.method === 'DELETE') {
        if (hasDb()) {
          const dbId = this.afModel.getDbId(webId);
          if (dbId !== undefined) {
            dbDeleteAttribute(dbId).catch((err) => console.warn('[DB] Failed to persist AF attribute delete:', err));
          }
        }
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

    const fullPath = path.resolve(uiDistDir, filePath);

    // Prevent path traversal (resolve normalizes '..' segments before the check)
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
      database: hasDb() ? 'connected' : 'none',
    });
  }

  private handleAdminSetScenario(req: http.IncomingMessage, res: http.ServerResponse): void {
    readBody(req, res, (body) => {
      try {
        const parsed = activateScenarioSchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          sendJson(res, 400, { error: formatZodError(parsed.error) });
          return;
        }
        const { name } = parsed.data;
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
    readBody(req, res, async (body) => {
      try {
        const parsed = updateTagProfileSchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          sendJson(res, 400, { error: formatZodError(parsed.error) });
          return;
        }
        const updates = parsed.data;
        const ok = this.generator.updateProfile(tagName, updates);
        if (!ok) {
          sendJson(res, 404, { error: `Unknown tag "${tagName}"` });
          return;
        }
        if (hasDb()) {
          try { await dbUpdateTagProfile(tagName, updates); }
          catch (err) { console.warn('[DB] Failed to persist tag profile update:', err); }
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
    readBody(req, res, (body) => {
      try {
        const parsed = setOverrideSchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          sendJson(res, 400, { error: formatZodError(parsed.error) });
          return;
        }
        const { value } = parsed.data;
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
    if (hasDb()) {
      dbDeleteTag(tagName).catch((err) => console.warn('[DB] Failed to persist tag delete:', err));
    }
    sendJson(res, 200, { status: 'ok', deleted: tagName });
  }

  private handleAdminCreateTag(req: http.IncomingMessage, res: http.ServerResponse): void {
    readBody(req, res, async (body) => {
      try {
        const parsed = createTagSchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          sendJson(res, 400, { error: formatZodError(parsed.error) });
          return;
        }
        const { tagName, unit, group, profile } = parsed.data;
        if (this.registry.getByTagName(tagName)) {
          sendJson(res, 409, { error: `Tag "${tagName}" already exists` });
          return;
        }
        const meta = this.registry.register(tagName, unit ?? '');
        this.generator.registerTag(tagName, profile);
        if (group) {
          this.customTagGroups.set(tagName, group);
        }
        if (hasDb()) {
          try { await insertTag(tagName, unit ?? '', profile, group); }
          catch (err) { console.warn('[DB] Failed to persist tag create:', err); }
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
    readBody(req, res, async (body) => {
      try {
        const parsed = customScenarioSchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          sendJson(res, 400, { error: formatZodError(parsed.error) });
          return;
        }
        const def = parsed.data as CustomScenarioDefinition;
        this.customScenarios.set(def.name, def);
        this.scenarioEngine.register(createCustomScenario(def));
        if (hasDb()) {
          try { await dbInsertCustomScenario(def); }
          catch (err) { console.warn('[DB] Failed to persist custom scenario create:', err); }
        }
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
    readBody(req, res, async (body) => {
      try {
        if (!this.customScenarios.has(name)) {
          sendJson(res, 404, { error: `Custom scenario "${name}" not found` });
          return;
        }
        const parsed = customScenarioSchema.safeParse(JSON.parse(body));
        if (!parsed.success) {
          sendJson(res, 400, { error: formatZodError(parsed.error) });
          return;
        }
        const def = parsed.data as CustomScenarioDefinition;
        def.name = name; // Enforce URL name
        this.customScenarios.set(name, def);
        this.scenarioEngine.unregister(name);
        this.scenarioEngine.register(createCustomScenario(def));
        if (hasDb()) {
          try { await dbUpdateCustomScenario(def); }
          catch (err) { console.warn('[DB] Failed to persist custom scenario update:', err); }
        }
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
    if (hasDb()) {
      dbDeleteCustomScenario(name).catch((err) => console.warn('[DB] Failed to persist scenario delete:', err));
    }
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

function setSecurityHeaders(res: http.ServerResponse): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
  );
}

function buildCorsAllowlist(port: number): string[] {
  const envOrigins = process.env.SIM_CORS_ORIGINS;
  if (envOrigins) {
    return envOrigins.split(',').map((o) => o.trim()).filter(Boolean);
  }
  // Default: simulator itself + common Vite dev server ports
  return [
    `https://localhost:${port}`,
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:3000',
  ];
}
