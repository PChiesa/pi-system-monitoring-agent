import http from 'http';
import { AFModel } from './af-model.js';
import { TagRegistry } from './tag-registry.js';
import { DataGenerator, type TagProfile } from './data-generator.js';
import { sendJson, readBody } from './utils.js';
import { hasDb } from './db/connection.js';
import { insertTag } from './db/tag-repository.js';
import { insertDatabase as dbInsertDatabase, insertElement as dbInsertElement, insertAttribute as dbInsertAttribute } from './db/af-repository.js';
import { validateServerUrl, validateUrlMatchesHost } from './url-validator.js';

// ── Types ────────────────────────────────────────────────────────────────────

interface PIConnectionConfig {
  serverUrl: string;
  username: string;
  password: string;
  rejectUnauthorized?: boolean;
}

interface RemoteAssetServer {
  WebId: string;
  Name: string;
  Description: string;
  Path: string;
  IsConnected: boolean;
}

interface RemoteAFDatabase {
  WebId: string;
  Name: string;
  Description: string;
  Path: string;
}

interface RemoteAFElement {
  WebId: string;
  Name: string;
  Description: string;
  Path: string;
  HasChildren: boolean;
}

interface RemoteAFAttribute {
  WebId: string;
  Name: string;
  Description: string;
  Type: string;
  DefaultUnitsOfMeasure: string;
  DefaultUnitsName: string;
  DefaultUnitsNameAbbreviation: string;
  DataReferencePlugIn: string;
  ConfigString: string;
  Links: Record<string, string>;
}

interface RemotePIPoint {
  WebId: string;
  Name: string;
  Path: string;
  PointType: string;
  EngineeringUnits: string;
}

interface ImportRequest {
  connection: PIConnectionConfig;
  remoteElementWebId: string;
  targetParentWebId?: string;
  remoteDatabaseName?: string;
  maxDepth?: number;
  maxElements?: number;
  importTags?: boolean;
}

interface ImportResult {
  elementsCreated: number;
  attributesCreated: number;
  tagsCreated: number;
  errors: string[];
  rootElementWebId: string | null;
}

// ── PIRemoteClient ───────────────────────────────────────────────────────────

/** Error originating from the remote PI Web API (network, auth, or HTTP error). */
class PIRemoteError extends Error {
  readonly statusCode: number;
  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = 'PIRemoteError';
    this.statusCode = statusCode;
  }
}

class PIRemoteClient {
  private baseUrl: string;
  private serverUrl: string;
  private authHeader: string;
  private rejectUnauthorized: boolean;

  constructor(config: PIConnectionConfig) {
    // SSRF protection: validate the server URL before connecting
    validateServerUrl(config.serverUrl, { allowHttp: true, allowPrivate: false });

    let url = config.serverUrl.replace(/\/+$/, '');
    if (!url.endsWith('/piwebapi')) {
      url += '/piwebapi';
    }
    this.baseUrl = url;
    this.serverUrl = config.serverUrl;
    this.rejectUnauthorized = config.rejectUnauthorized ?? true;
    this.authHeader =
      'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  }

  private async get<T = unknown>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: this.authHeader,
          'X-Requested-With': 'XMLHttpRequest',
        },
        // @ts-expect-error — Bun supports rejectUnauthorized on fetch
        tls: { rejectUnauthorized: this.rejectUnauthorized },
      });
    } catch (err) {
      // Network-level failure (DNS, connection refused, TLS)
      const msg = err instanceof Error ? err.message : String(err);
      throw new PIRemoteError(`Cannot reach PI server: ${msg}`, 502);
    }
    if (res.status === 401 || res.status === 403) {
      throw new PIRemoteError('Authentication failed — check username and password', 401);
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new PIRemoteError(
        `PI Web API returned ${res.status} ${res.statusText}: ${text}`,
        502
      );
    }
    return res.json() as Promise<T>;
  }

  async testConnection(): Promise<{ ProductTitle?: string; ProductVersion?: string }> {
    return this.get('/');
  }

  async getAssetServers(): Promise<RemoteAssetServer[]> {
    const data = await this.get<{ Items?: RemoteAssetServer[] }>('/assetservers');
    return data.Items ?? [];
  }

  async getDatabases(assetServerWebId: string): Promise<RemoteAFDatabase[]> {
    const data = await this.get<{ Items?: RemoteAFDatabase[] }>(
      `/assetservers/${encodeURIComponent(assetServerWebId)}/assetdatabases`
    );
    return data.Items ?? [];
  }

  async getRootElements(dbWebId: string): Promise<RemoteAFElement[]> {
    const data = await this.get<{ Items?: RemoteAFElement[] }>(
      `/assetdatabases/${encodeURIComponent(dbWebId)}/elements`
    );
    return data.Items ?? [];
  }

  async getChildElements(elementWebId: string): Promise<RemoteAFElement[]> {
    const data = await this.get<{ Items?: RemoteAFElement[] }>(
      `/elements/${encodeURIComponent(elementWebId)}/elements`
    );
    return data.Items ?? [];
  }

  async getElement(webId: string): Promise<RemoteAFElement> {
    return this.get<RemoteAFElement>(`/elements/${encodeURIComponent(webId)}`);
  }

  async getAttributes(elementWebId: string): Promise<RemoteAFAttribute[]> {
    const data = await this.get<{ Items?: RemoteAFAttribute[] }>(
      `/elements/${encodeURIComponent(elementWebId)}/attributes`
    );
    return data.Items ?? [];
  }

  async getStreamValue(webId: string): Promise<{ Value: unknown; Timestamp: string; UnitsAbbreviation: string; Good: boolean }> {
    return this.get(`/streams/${encodeURIComponent(webId)}/value`);
  }

  async getPoint(webId: string): Promise<RemotePIPoint> {
    return this.get<RemotePIPoint>(`/points/${encodeURIComponent(webId)}`);
  }

  /** Follow an absolute Links.Point URL to get the PI Point object. */
  async getPointFromUrl(pointUrl: string): Promise<RemotePIPoint> {
    // SSRF protection: ensure the URL points to the same server we connected to
    validateUrlMatchesHost(pointUrl, this.serverUrl);

    let res: Response;
    try {
      res = await fetch(pointUrl, {
        headers: {
          Authorization: this.authHeader,
          'X-Requested-With': 'XMLHttpRequest',
        },
        // @ts-expect-error — Bun supports rejectUnauthorized on fetch
        tls: { rejectUnauthorized: this.rejectUnauthorized },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new PIRemoteError(`Cannot reach PI server: ${msg}`, 502);
    }
    if (!res.ok) {
      throw new PIRemoteError(`Failed to get PI Point: ${res.status} ${res.statusText}`, 502);
    }
    return res.json() as Promise<RemotePIPoint>;
  }
}

// ── Tag import helpers ───────────────────────────────────────────────────────

/** Resolve the actual PI Point tag name from the attribute's Links.Point URL.
 *  Falls back to parsing ConfigString only if no Point link is available. */
async function resolveTagName(
  client: PIRemoteClient,
  attr: RemoteAFAttribute,
): Promise<string> {
  // Preferred: follow the Links.Point URL to get the actual PI Point
  if (attr.Links?.Point) {
    const point = await client.getPointFromUrl(attr.Links.Point);
    return point.Name;
  }

  // Fallback: try to parse a simple ConfigString (\\Server\Tag or just Tag)
  // This only works for non-parametric config strings.
  if (attr.ConfigString && !attr.ConfigString.includes('%')) {
    let name = attr.ConfigString.replace(/^\\+/, '');
    const sepIdx = name.indexOf('\\');
    if (sepIdx !== -1) {
      name = name.substring(sepIdx + 1);
    }
    return name;
  }

  throw new Error(
    `Cannot resolve PI Point name for "${attr.Name}": no Links.Point and ConfigString uses substitution parameters`
  );
}

function mapPITypeToValueType(piType: string): 'number' | 'boolean' | 'string' {
  const numericTypes = ['Double', 'Single', 'Float16', 'Float32', 'Float64', 'Int16', 'Int32', 'Int64', 'Byte'];
  if (numericTypes.includes(piType)) return 'number';
  if (piType === 'Boolean') return 'boolean';
  return 'string';
}

function buildTagProfile(valueType: 'number' | 'boolean' | 'string', currentValue: unknown): TagProfile {
  if (valueType === 'boolean') {
    return { valueType: 'boolean', nominal: 0, sigma: 0, booleanDefault: !!currentValue };
  }
  if (valueType === 'string') {
    return { valueType: 'string', nominal: 0, sigma: 0, stringDefault: String(currentValue ?? '') };
  }
  const r = (n: number) => Math.round(n * 100) / 100;
  const v = r(typeof currentValue === 'number' ? currentValue : Number(currentValue) || 0);
  let min: number, max: number;
  if (v > 0) {
    min = r(v * 0.5);
    max = r(v * 1.5);
  } else if (v < 0) {
    min = r(v * 1.5);
    max = r(v * 0.5);
  } else {
    min = -1;
    max = 1;
  }
  const sigma = r(Math.max(Math.abs(v) * 0.02, 0.1));
  return { nominal: v, sigma, min, max };
}

// ── NDJSON stream helper ─────────────────────────────────────────────────────

function sendEvent(res: http.ServerResponse, event: Record<string, unknown>): void {
  res.write(JSON.stringify(event) + '\n');
}

// ── Phase 1: Count elements recursively (no attribute fetching) ──────────────

interface ElementToImport {
  webId: string;
  name: string;
  parentLocalWebId: string; // will be resolved during import
  depth: number;
}

async function countElements(
  client: PIRemoteClient,
  rootWebId: string,
  maxDepth: number,
  maxElements: number,
): Promise<{ elements: ElementToImport[]; truncated: boolean }> {
  const elements: ElementToImport[] = [];
  let truncated = false;

  // BFS queue: [remoteWebId, depth, parentIndex (-1 for root)]
  const queue: Array<{ webId: string; depth: number; parentIndex: number }> = [
    { webId: rootWebId, depth: 1, parentIndex: -1 },
  ];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.depth > maxDepth) {
      truncated = true;
      continue;
    }
    if (elements.length >= maxElements) {
      truncated = true;
      break;
    }

    const el = await client.getElement(item.webId);
    const idx = elements.length;
    elements.push({
      webId: el.WebId,
      name: el.Name,
      parentLocalWebId: '', // resolved during import
      depth: item.depth,
    });

    if (el.HasChildren) {
      const children = await client.getChildElements(item.webId);
      for (const child of children) {
        queue.push({ webId: child.WebId, depth: item.depth + 1, parentIndex: idx });
      }
    }
  }

  return { elements, truncated };
}

// ── Phase 2: Import with progress streaming ──────────────────────────────────

interface ImportCounters {
  elements: number;
  attributes: number;
  tags: number;
  errors: string[];
}

async function importSubtree(
  client: PIRemoteClient,
  afModel: AFModel,
  registry: TagRegistry,
  generator: DataGenerator,
  remoteElementWebId: string,
  localParentWebId: string,
  maxDepth: number,
  maxElements: number,
  currentDepth: number,
  counters: ImportCounters,
  total: number,
  res: http.ServerResponse,
  importTags: boolean,
): Promise<string | null> {
  if (currentDepth > maxDepth) {
    counters.errors.push(`Max depth (${maxDepth}) reached; deeper elements skipped`);
    return null;
  }
  if (counters.elements >= maxElements) {
    counters.errors.push(`Element limit (${maxElements}) reached; import truncated`);
    return null;
  }

  // Fetch remote element
  const remoteEl = await client.getElement(remoteElementWebId);

  console.log(
    `[AF Import] Importing element "${remoteEl.Name}" (${counters.elements + 1}/${total}) depth=${currentDepth}`
  );

  // Create locally
  const localEl = afModel.createElement(
    localParentWebId,
    remoteEl.Name,
    remoteEl.Description || ''
  );
  if (!localEl) {
    counters.errors.push(`Failed to create element "${remoteEl.Name}" under ${localParentWebId}`);
    return null;
  }
  counters.elements++;

  // Persist element to DB
  if (hasDb()) {
    try {
      const parentDbId = afModel.getDbId(localParentWebId);
      const isDbParent = afModel.isDatabaseWebId(localParentWebId);
      const databaseDbId = isDbParent ? parentDbId : afModel.getDbId(localEl.databaseWebId);
      if (databaseDbId !== undefined) {
        const row = await dbInsertElement(
          remoteEl.Name,
          remoteEl.Description || '',
          databaseDbId,
          isDbParent ? null : (parentDbId ?? null)
        );
        afModel.setDbId(localEl.webId, row.id);
      }
    } catch (err) { console.warn('[DB] Failed to persist imported element:', err); }
  }

  // Stream progress event
  sendEvent(res, {
    type: 'progress',
    current: counters.elements,
    total,
    elementName: remoteEl.Name,
    elementsCreated: counters.elements,
    attributesCreated: counters.attributes,
    tagsCreated: counters.tags,
  });

  // Import attributes (and create tags for PI Point references)
  try {
    const remoteAttrs = await client.getAttributes(remoteElementWebId);
    console.log(
      `[AF Import]   -> ${remoteAttrs.length} attribute(s) for "${remoteEl.Name}"`
    );
    for (const attr of remoteAttrs) {
      const uom =
        attr.DefaultUnitsOfMeasure ||
        attr.DefaultUnitsNameAbbreviation ||
        attr.DefaultUnitsName ||
        '';
      let piPointName: string | null = null;

      // If attribute references a PI Point, resolve actual tag name and create a local tag
      if (importTags && attr.DataReferencePlugIn === 'PI Point' && (attr.Links?.Point || attr.ConfigString)) {
        try {
          const tagName = await resolveTagName(client, attr);
          const valueType = mapPITypeToValueType(attr.Type);

          // Fetch current value from remote PI
          let currentValue: unknown = valueType === 'boolean' ? false : valueType === 'string' ? '' : 0;
          try {
            const streamVal = await client.getStreamValue(attr.WebId);
            if (streamVal.Value !== undefined && streamVal.Value !== null) {
              currentValue = streamVal.Value;
            }
          } catch {
            counters.errors.push(`Could not read value for "${attr.Name}" on "${remoteEl.Name}"; using default`);
          }

          // Register tag if it doesn't already exist
          if (!registry.getByTagName(tagName)) {
            const profile = buildTagProfile(valueType, currentValue);
            registry.register(tagName, uom);
            generator.registerTag(tagName, profile);
            counters.tags++;

            // Persist tag to DB
            if (hasDb()) {
              try { await insertTag(tagName, uom, profile); }
              catch (err) { console.warn('[DB] Failed to persist imported tag:', err); }
            }

            sendEvent(res, {
              type: 'progress',
              current: counters.elements,
              total,
              elementName: remoteEl.Name,
              elementsCreated: counters.elements,
              attributesCreated: counters.attributes,
              tagsCreated: counters.tags,
            });
            console.log(
              `[AF Import]     + tag "${tagName}" = ${currentValue} ${uom}`
            );
          } else {
            console.log(
              `[AF Import]     ~ tag "${tagName}" already exists, reusing`
            );
          }
          piPointName = tagName;
        } catch (err) {
          counters.errors.push(
            `Failed to create tag for "${attr.Name}": ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      const created = afModel.createAttribute(
        localEl.webId,
        attr.Name,
        attr.Type || 'Double',
        uom,
        piPointName,
        attr.Description || ''
      );
      if (created) {
        counters.attributes++;

        // Persist attribute to DB
        if (hasDb()) {
          try {
            const elDbId = afModel.getDbId(localEl.webId);
            if (elDbId !== undefined) {
              const row = await dbInsertAttribute(
                attr.Name, attr.Description || '', attr.Type || 'Double', uom, piPointName, elDbId
              );
              afModel.setDbId(created.webId, row.id);
            }
          } catch (err) { console.warn('[DB] Failed to persist imported attribute:', err); }
        }

        sendEvent(res, {
          type: 'progress',
          current: counters.elements,
          total,
          elementName: remoteEl.Name,
          elementsCreated: counters.elements,
          attributesCreated: counters.attributes,
          tagsCreated: counters.tags,
        });
      } else {
        counters.errors.push(`Failed to create attribute "${attr.Name}" on "${remoteEl.Name}"`);
      }
    }
  } catch (err) {
    counters.errors.push(
      `Error fetching attributes for "${remoteEl.Name}": ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Recurse into children
  if (remoteEl.HasChildren) {
    try {
      const children = await client.getChildElements(remoteElementWebId);
      for (const child of children) {
        if (counters.elements >= maxElements) {
          counters.errors.push(`Element limit (${maxElements}) reached; import truncated`);
          break;
        }
        await importSubtree(
          client,
          afModel,
          registry,
          generator,
          child.WebId,
          localEl.webId,
          maxDepth,
          maxElements,
          currentDepth + 1,
          counters,
          total,
          res,
          importTags,
        );
      }
    } catch (err) {
      counters.errors.push(
        `Error fetching children of "${remoteEl.Name}": ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  return localEl.webId;
}

// ── Request handler ──────────────────────────────────────────────────────────

function parseConnection(body: unknown): PIConnectionConfig | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  if (typeof b.serverUrl !== 'string' || !b.serverUrl) return null;
  if (typeof b.username !== 'string') return null;
  if (typeof b.password !== 'string') return null;
  return { serverUrl: b.serverUrl as string, username: b.username as string, password: b.password as string };
}

let importing = false;

export function createImportHandler(
  afModel: AFModel,
  registry: TagRegistry,
  generator: DataGenerator,
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  return function handleImport(
    req: http.IncomingMessage,
    res: http.ServerResponse
  ): boolean {
    const url = new URL(req.url!, `https://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    if (!path.startsWith('/admin/import/')) return false;
    if (req.method !== 'POST') {
      sendJson(res, 405, { error: 'Method not allowed' });
      return true;
    }

    // POST /admin/import/test-connection
    if (path === '/admin/import/test-connection') {
      readBody(req, async (raw) => {
        try {
          const body = JSON.parse(raw);
          const conn = parseConnection(body);
          if (!conn) {
            sendJson(res, 400, { error: 'Missing serverUrl, username, or password' });
            return;
          }
          const client = new PIRemoteClient(conn);
          const info = await client.testConnection();
          sendJson(res, 200, {
            connected: true,
            productTitle: info.ProductTitle ?? 'PI Web API',
            productVersion: info.ProductVersion ?? 'unknown',
          });
        } catch (err) {
          sendJson(res, 200, {
            connected: false,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      });
      return true;
    }

    // POST /admin/import/browse/servers
    if (path === '/admin/import/browse/servers') {
      readBody(req, async (raw) => {
        try {
          const body = JSON.parse(raw);
          const conn = parseConnection(body);
          if (!conn) {
            sendJson(res, 400, { error: 'Missing serverUrl, username, or password' });
            return;
          }
          const client = new PIRemoteClient(conn);
          const servers = await client.getAssetServers();
          sendJson(res, 200, { servers });
        } catch (err) {
          const status = err instanceof PIRemoteError ? err.statusCode : 500;
          sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
        }
      });
      return true;
    }

    // POST /admin/import/browse/databases
    if (path === '/admin/import/browse/databases') {
      readBody(req, async (raw) => {
        try {
          const body = JSON.parse(raw);
          const conn = parseConnection(body);
          if (!conn) {
            sendJson(res, 400, { error: 'Missing serverUrl, username, or password' });
            return;
          }
          const assetServerWebId = body.assetServerWebId as string;
          if (!assetServerWebId) {
            sendJson(res, 400, { error: 'Missing assetServerWebId' });
            return;
          }
          const client = new PIRemoteClient(conn);
          const databases = await client.getDatabases(assetServerWebId);
          sendJson(res, 200, { databases });
        } catch (err) {
          const status = err instanceof PIRemoteError ? err.statusCode : 500;
          sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
        }
      });
      return true;
    }

    // POST /admin/import/browse/elements
    if (path === '/admin/import/browse/elements') {
      readBody(req, async (raw) => {
        try {
          const body = JSON.parse(raw);
          const conn = parseConnection(body);
          if (!conn) {
            sendJson(res, 400, { error: 'Missing serverUrl, username, or password' });
            return;
          }
          const parentWebId = body.parentWebId as string;
          if (!parentWebId) {
            sendJson(res, 400, { error: 'Missing parentWebId' });
            return;
          }
          const client = new PIRemoteClient(conn);
          const isDatabase = body.isDatabase === true;
          const elements = isDatabase
            ? await client.getRootElements(parentWebId)
            : await client.getChildElements(parentWebId);
          sendJson(res, 200, { elements });
        } catch (err) {
          const status = err instanceof PIRemoteError ? err.statusCode : 500;
          sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
        }
      });
      return true;
    }

    // POST /admin/import/execute — NDJSON streaming response
    if (path === '/admin/import/execute') {
      if (importing) {
        sendJson(res, 409, { error: 'An import is already in progress' });
        return true;
      }
      readBody(req, async (raw) => {
        try {
          const body = JSON.parse(raw) as ImportRequest;
          const conn = parseConnection(body.connection);
          if (!conn) {
            sendJson(res, 400, { error: 'Missing connection details' });
            return;
          }
          if (!body.remoteElementWebId) {
            sendJson(res, 400, { error: 'Missing remoteElementWebId' });
            return;
          }

          // Resolve target parent — auto-create a database if none provided
          let targetParentWebId = body.targetParentWebId;
          if (!targetParentWebId) {
            const dbName = body.remoteDatabaseName || 'Imported';
            console.log(`[AF Import] No target parent specified, creating AF database "${dbName}"`);
            const newDb = afModel.createDatabase(dbName, '');
            targetParentWebId = newDb.webId;
            if (hasDb()) {
              try {
                const row = await dbInsertDatabase(dbName, '');
                afModel.setDbId(newDb.webId, row.id);
              } catch (err) {
                console.warn('[AF Import] Failed to persist auto-created database:', err);
              }
            }
          } else {
            const parentIsDb = afModel.isDatabaseWebId(targetParentWebId);
            const parentIsEl = afModel.isElementWebId(targetParentWebId);
            if (!parentIsDb && !parentIsEl) {
              sendJson(res, 404, { error: 'Target parent not found in local AF model' });
              return;
            }
          }

          importing = true;
          const maxDepth = body.maxDepth ?? 10;
          const maxElements = body.maxElements ?? 500;
          const importTagsFlag = body.importTags !== false;

          // Start NDJSON stream
          res.writeHead(200, {
            'Content-Type': 'application/x-ndjson',
            'Cache-Control': 'no-cache',
            'Transfer-Encoding': 'chunked',
          });

          const client = new PIRemoteClient(conn);

          // Phase 1: Count elements
          console.log('[AF Import] Phase 1: Counting elements...');
          sendEvent(res, { type: 'counting', message: 'Discovering elements...' });

          let total: number;
          let truncated = false;
          try {
            const counted = await countElements(client, body.remoteElementWebId, maxDepth, maxElements);
            total = counted.elements.length;
            truncated = counted.truncated;
            console.log(`[AF Import] Found ${total} element(s) to import${truncated ? ' (truncated)' : ''}`);
          } catch (err) {
            // If counting fails, fall back to maxElements as the estimate
            console.log(`[AF Import] Count phase failed, using maxElements as estimate: ${err instanceof Error ? err.message : err}`);
            total = maxElements;
          }

          sendEvent(res, { type: 'counted', total, truncated });

          // Phase 2: Import with progress
          console.log('[AF Import] Phase 2: Importing elements...');
          const counters: ImportCounters = { elements: 0, attributes: 0, tags: 0, errors: [] };

          const rootWebId = await importSubtree(
            client,
            afModel,
            registry,
            generator,
            body.remoteElementWebId,
            targetParentWebId,
            maxDepth,
            maxElements,
            1,
            counters,
            total,
            res,
            importTagsFlag,
          );

          const result: ImportResult = {
            elementsCreated: counters.elements,
            attributesCreated: counters.attributes,
            tagsCreated: counters.tags,
            errors: counters.errors,
            rootElementWebId: rootWebId,
          };

          console.log(
            `[AF Import] Complete: ${result.elementsCreated} elements, ${result.attributesCreated} attributes, ${result.tagsCreated} tags, ${result.errors.length} error(s)`
          );

          sendEvent(res, { type: 'result', ...result });
          res.end();
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[AF Import] Fatal error: ${msg}`);
          // If headers haven't been sent yet, send JSON error
          if (!res.headersSent) {
            const status = err instanceof PIRemoteError ? err.statusCode : 500;
            sendJson(res, status, { error: msg });
          } else {
            // Stream already started — send error event and close
            sendEvent(res, { type: 'error', error: msg });
            res.end();
          }
        } finally {
          importing = false;
        }
      });
      return true;
    }

    sendJson(res, 404, { error: 'Unknown import endpoint' });
    return true;
  };
}
