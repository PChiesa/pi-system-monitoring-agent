import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from 'bun:test';
import { EventEmitter } from 'events';
import { TagRegistry } from '../simulator/tag-registry';
import { DataGenerator } from '../simulator/data-generator';
import { AFModel } from '../simulator/af-model';
import { createImportHandler } from '../simulator/import-handler';

// ── Test helpers ─────────────────────────────────────────────────────────────

function mockReq(method: string, url: string, body?: unknown): any {
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:8443' };

  // Simulate request body
  if (body !== undefined) {
    setTimeout(() => {
      req.emit('data', JSON.stringify(body));
      req.emit('end');
    }, 0);
  } else {
    setTimeout(() => req.emit('end'), 0);
  }

  return req;
}

function mockRes(): any {
  const res: any = new EventEmitter();
  res.statusCode = 0;
  res.headers = {};
  res.body = '';
  res.headersSent = false;
  res.writeHead = (status: number, headers?: Record<string, string>) => {
    res.statusCode = status;
    Object.assign(res.headers, headers);
    res.headersSent = true;
  };
  res.write = (data: string) => {
    res.body += data;
    return true;
  };
  res.end = (data?: string) => {
    if (data) res.body += data;
  };
  return res;
}

function resJson(res: any): any {
  return JSON.parse(res.body);
}

/** Parse NDJSON streaming response into an array of event objects. */
function parseNdjsonEvents(res: any): any[] {
  return res.body.split('\n').filter((l: string) => l.trim()).map((l: string) => JSON.parse(l));
}

/** Extract the final 'result' event from NDJSON events. */
function getResultEvent(events: any[]): any {
  return events.find((e: any) => e.type === 'result');
}

/** Wait for the response body to be written. */
function waitForResponse(res: any, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve, reject) => {
    const originalEnd = res.end;
    const timer = setTimeout(() => reject(new Error('Response timeout')), timeoutMs);
    res.end = (data?: string) => {
      originalEnd.call(res, data);
      clearTimeout(timer);
      resolve();
    };
  });
}

// ── Mock fetch ───────────────────────────────────────────────────────────────

let fetchMock: ReturnType<typeof spyOn>;

function mockFetchResponse(body: unknown, status = 200) {
  fetchMock.mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    })
  );
}

function mockFetchError(message: string) {
  fetchMock.mockRejectedValueOnce(new Error(message));
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('import-handler', () => {
  let registry: TagRegistry;
  let generator: DataGenerator;
  let afModel: AFModel;
  let handler: ReturnType<typeof createImportHandler>;

  beforeEach(() => {
    spyOn(console, 'log').mockImplementation(() => {});
    spyOn(console, 'error').mockImplementation(() => {});
    registry = new TagRegistry();
    registry.loadFromDefaults();
    generator = new DataGenerator(registry);
    generator.loadFromDefaults();
    afModel = new AFModel();
    afModel.loadFromDefaults();
    handler = createImportHandler(afModel, registry, generator);
    fetchMock = spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const connection = { serverUrl: 'https://piserver.test', username: 'user', password: 'pass' };

  describe('routing', () => {
    it('returns false for non-import paths', () => {
      const req = mockReq('GET', '/admin/status');
      const res = mockRes();
      expect(handler(req, res)).toBe(false);
    });

    it('returns true for import paths', async () => {
      mockFetchResponse({ ProductTitle: 'PI Web API', ProductVersion: '2025' });
      const req = mockReq('POST', '/admin/import/test-connection', connection);
      const res = mockRes();
      const wait = waitForResponse(res);
      expect(handler(req, res)).toBe(true);
      await wait; // wait for async callback to complete so it doesn't leak
    });

    it('rejects non-POST methods', () => {
      const req = mockReq('GET', '/admin/import/test-connection');
      const res = mockRes();
      // Non-POST is handled synchronously, no readBody called
      handler(req, res);
      expect(res.statusCode).toBe(405);
    });
  });

  describe('POST /admin/import/test-connection', () => {
    it('returns connected: true on success', async () => {
      mockFetchResponse({ ProductTitle: 'PI Web API', ProductVersion: '2025.1.0' });
      const req = mockReq('POST', '/admin/import/test-connection', connection);
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const body = resJson(res);
      expect(body.connected).toBe(true);
      expect(body.productTitle).toBe('PI Web API');
      expect(body.productVersion).toBe('2025.1.0');
    });

    it('returns connected: false on fetch error', async () => {
      mockFetchError('Connection refused');
      const req = mockReq('POST', '/admin/import/test-connection', connection);
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const body = resJson(res);
      expect(body.connected).toBe(false);
      expect(body.error).toContain('Connection refused');
    });

    it('returns 400 for missing connection fields', async () => {
      const req = mockReq('POST', '/admin/import/test-connection', { serverUrl: '' });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /admin/import/browse/servers', () => {
    it('returns asset servers from remote PI', async () => {
      const remoteServers = [
        { WebId: 'SRV1', Name: 'MyAssetServer', Description: 'Test', Path: '\\\\MyAssetServer', IsConnected: true },
      ];
      mockFetchResponse({ Items: remoteServers });

      const req = mockReq('POST', '/admin/import/browse/servers', connection);
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const body = resJson(res);
      expect(body.servers).toHaveLength(1);
      expect(body.servers[0].Name).toBe('MyAssetServer');
    });

    it('returns 502 on remote connection error', async () => {
      mockFetchError('Network error');
      const req = mockReq('POST', '/admin/import/browse/servers', connection);
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(502);
      const body = resJson(res);
      expect(body.error).toContain('Cannot reach PI server');
    });
  });

  describe('POST /admin/import/browse/databases', () => {
    it('returns databases for an asset server', async () => {
      const remoteDbs = [
        { WebId: 'DB1', Name: 'TestDB', Description: 'Test', Path: '\\\\Server\\TestDB' },
      ];
      mockFetchResponse({ Items: remoteDbs });

      const req = mockReq('POST', '/admin/import/browse/databases', {
        ...connection,
        assetServerWebId: 'SRV1',
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const body = resJson(res);
      expect(body.databases).toHaveLength(1);
      expect(body.databases[0].Name).toBe('TestDB');
    });

    it('returns 400 if assetServerWebId is missing', async () => {
      const req = mockReq('POST', '/admin/import/browse/databases', connection);
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /admin/import/browse/elements', () => {
    it('returns root elements for a database', async () => {
      const elements = [
        { WebId: 'EL1', Name: 'Root1', Description: '', Path: '\\\\S\\DB\\Root1', HasChildren: false },
      ];
      mockFetchResponse({ Items: elements });

      const req = mockReq('POST', '/admin/import/browse/elements', {
        ...connection,
        parentWebId: 'DB1',
        isDatabase: true,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const body = resJson(res);
      expect(body.elements).toHaveLength(1);
      expect(body.elements[0].Name).toBe('Root1');
    });

    it('returns child elements for an element', async () => {
      const elements = [
        { WebId: 'EL2', Name: 'Child1', Description: '', Path: '\\\\S\\DB\\Parent\\Child1', HasChildren: false },
      ];
      mockFetchResponse({ Items: elements });

      const req = mockReq('POST', '/admin/import/browse/elements', {
        ...connection,
        parentWebId: 'EL1',
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const body = resJson(res);
      expect(body.elements).toHaveLength(1);
    });

    it('returns 400 if parentWebId is missing', async () => {
      const req = mockReq('POST', '/admin/import/browse/elements', connection);
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(400);
    });
  });

  describe('POST /admin/import/execute (NDJSON streaming)', () => {
    it('imports a simple element with attributes', async () => {
      const dbs = afModel.getDatabases();
      const dbWebId = dbs[0].webId;

      const elementData = {
        WebId: 'REMOTE_EL1',
        Name: 'Imported Element',
        Description: 'An imported element',
        Path: '\\\\Remote\\DB\\Imported Element',
        HasChildren: false,
      };
      const attrData = {
        Items: [
          {
            WebId: 'REMOTE_AT1',
            Name: 'Temperature',
            Description: 'Temperature sensor',
            Type: 'Double',
            DefaultUnitsOfMeasure: 'F',
            DataReferencePlugIn: 'PI Point',
            ConfigString: '\\\\Remote.TEMP',
          },
        ],
      };

      // Phase 1: count — getElement(root)
      mockFetchResponse(elementData);
      // Phase 2: import — getElement(root), getAttributes(root), getStreamValue(REMOTE_AT1)
      mockFetchResponse(elementData);
      mockFetchResponse(attrData);
      mockFetchResponse({ Value: 72.5, Timestamp: '2024-01-01T00:00:00Z', UnitsAbbreviation: 'F', Good: true });

      const elementsBefore = afModel.getRootElements(dbWebId).length;

      const req = mockReq('POST', '/admin/import/execute', {
        connection,
        remoteElementWebId: 'REMOTE_EL1',
        targetParentWebId: dbWebId,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const events = parseNdjsonEvents(res);
      const result = getResultEvent(events);
      expect(result.elementsCreated).toBe(1);
      expect(result.attributesCreated).toBe(1);
      expect(result.tagsCreated).toBe(1);
      expect(result.errors).toHaveLength(0);
      expect(result.rootElementWebId).toBeTruthy();

      // Verify tag was created for the PI Point attribute
      const tagMeta = registry.getByTagName('Remote.TEMP');
      expect(tagMeta).toBeTruthy();
      expect(tagMeta!.unit).toBe('F');

      // Verify streaming events present
      expect(events.some((e: any) => e.type === 'counting')).toBe(true);
      expect(events.some((e: any) => e.type === 'counted')).toBe(true);
      expect(events.some((e: any) => e.type === 'progress')).toBe(true);

      // Verify it was actually created in the model
      const elementsAfter = afModel.getRootElements(dbWebId).length;
      expect(elementsAfter).toBe(elementsBefore + 1);
    });

    it('imports nested hierarchy', async () => {
      const dbs = afModel.getDatabases();
      const dbWebId = dbs[0].webId;

      const parentData = {
        WebId: 'REMOTE_PARENT',
        Name: 'Parent',
        Description: 'Parent element',
        Path: '\\\\Remote\\DB\\Parent',
        HasChildren: true,
      };
      const childData = {
        WebId: 'REMOTE_CHILD',
        Name: 'Child',
        Description: 'Child element',
        Path: '\\\\Remote\\DB\\Parent\\Child',
        HasChildren: false,
      };
      const childrenList = {
        Items: [
          { WebId: 'REMOTE_CHILD', Name: 'Child', Description: '', Path: '\\\\Remote\\DB\\Parent\\Child', HasChildren: false },
        ],
      };
      const childAttrs = {
        Items: [
          { WebId: 'REMOTE_AT2', Name: 'Pressure', Description: '', Type: 'Double', DefaultUnitsOfMeasure: 'PSI', DataReferencePlugIn: '', ConfigString: '' },
        ],
      };

      // Phase 1: count (BFS) — getElement(parent), getChildElements(parent), getElement(child)
      mockFetchResponse(parentData);
      mockFetchResponse(childrenList);
      mockFetchResponse(childData);
      // Phase 2: import — getElement(parent), getAttributes(parent), getChildElements(parent), getElement(child), getAttributes(child)
      mockFetchResponse(parentData);
      mockFetchResponse({ Items: [] });
      mockFetchResponse(childrenList);
      mockFetchResponse(childData);
      mockFetchResponse(childAttrs);

      const req = mockReq('POST', '/admin/import/execute', {
        connection,
        remoteElementWebId: 'REMOTE_PARENT',
        targetParentWebId: dbWebId,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const events = parseNdjsonEvents(res);
      const result = getResultEvent(events);
      expect(result.elementsCreated).toBe(2);
      expect(result.attributesCreated).toBe(1);

      // Verify progress events: 2 elements + 1 attribute = 3 progress events
      const progressEvents = events.filter((e: any) => e.type === 'progress');
      expect(progressEvents).toHaveLength(3);
    });

    it('respects maxElements limit', async () => {
      const dbs = afModel.getDatabases();
      const dbWebId = dbs[0].webId;

      const rootData = { WebId: 'REMOTE_EL1', Name: 'Root', Description: '', Path: '\\\\Remote\\DB\\Root', HasChildren: true };
      const childrenList = {
        Items: [
          { WebId: 'C1', Name: 'C1', Description: '', Path: '\\\\R\\D\\C1', HasChildren: false },
          { WebId: 'C2', Name: 'C2', Description: '', Path: '\\\\R\\D\\C2', HasChildren: false },
          { WebId: 'C3', Name: 'C3', Description: '', Path: '\\\\R\\D\\C3', HasChildren: false },
        ],
      };
      const c1Data = { WebId: 'C1', Name: 'C1', Description: '', Path: '\\\\R\\D\\C1', HasChildren: false };

      // Phase 1: count (BFS) — getElement(root), getChildElements(root), getElement(C1), then C2 hits limit
      mockFetchResponse(rootData);
      mockFetchResponse(childrenList);
      mockFetchResponse(c1Data);
      // Phase 2: import — getElement(root), getAttributes(root), getChildElements(root), getElement(C1), getAttributes(C1)
      mockFetchResponse(rootData);
      mockFetchResponse({ Items: [] });
      mockFetchResponse(childrenList);
      mockFetchResponse(c1Data);
      mockFetchResponse({ Items: [] });

      const req = mockReq('POST', '/admin/import/execute', {
        connection,
        remoteElementWebId: 'REMOTE_EL1',
        targetParentWebId: dbWebId,
        maxElements: 2,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const events = parseNdjsonEvents(res);
      const result = getResultEvent(events);
      expect(result.elementsCreated).toBe(2);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e: string) => e.includes('Element limit'))).toBe(true);
    });

    it('respects maxDepth limit', async () => {
      const dbs = afModel.getDatabases();
      const dbWebId = dbs[0].webId;

      const rootData = { WebId: 'DEEP_ROOT', Name: 'DeepRoot', Description: '', Path: '\\\\R\\D\\DeepRoot', HasChildren: true };
      const childrenList = {
        Items: [
          { WebId: 'DEEP_CHILD', Name: 'DeepChild', Description: '', Path: '\\\\R\\D\\DeepRoot\\DeepChild', HasChildren: true },
        ],
      };

      // Phase 1: count — getElement(root), getChildElements(root); child at depth 2 is skipped
      mockFetchResponse(rootData);
      mockFetchResponse(childrenList);
      // Phase 2: import — getElement(root), getAttributes(root), getChildElements(root); child skipped by depth
      mockFetchResponse(rootData);
      mockFetchResponse({ Items: [] });
      mockFetchResponse(childrenList);

      const req = mockReq('POST', '/admin/import/execute', {
        connection,
        remoteElementWebId: 'DEEP_ROOT',
        targetParentWebId: dbWebId,
        maxDepth: 1,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(200);
      const events = parseNdjsonEvents(res);
      const result = getResultEvent(events);
      expect(result.elementsCreated).toBe(1);
      expect(result.errors.some((e: string) => e.includes('Max depth'))).toBe(true);
    });

    it('returns 404 for nonexistent target parent', async () => {
      const req = mockReq('POST', '/admin/import/execute', {
        connection,
        remoteElementWebId: 'REMOTE_EL1',
        targetParentWebId: 'NONEXISTENT_WEBID',
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(404);
    });

    it('returns 400 for missing required fields', async () => {
      const req = mockReq('POST', '/admin/import/execute', {
        connection,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(400);
    });

    it('creates tags for PI Point attributes with correct profile', async () => {
      const dbs = afModel.getDatabases();
      const dbWebId = dbs[0].webId;

      const elementData = {
        WebId: 'REMOTE_MAPPED',
        Name: 'MappedElement',
        Description: '',
        Path: '\\\\R\\D\\MappedElement',
        HasChildren: false,
      };
      const attrData = {
        Items: [
          {
            WebId: 'REMOTE_MAP_AT',
            Name: 'MappedAttr',
            Description: '',
            Type: 'Double',
            DefaultUnitsOfMeasure: 'PSI',
            DataReferencePlugIn: 'PI Point',
            ConfigString: '\\\\ServerTag.Name',
          },
        ],
      };

      // Phase 1: count — getElement
      mockFetchResponse(elementData);
      // Phase 2: import — getElement, getAttributes, getStreamValue
      mockFetchResponse(elementData);
      mockFetchResponse(attrData);
      mockFetchResponse({ Value: 150.5, Timestamp: '2024-01-01T00:00:00Z', UnitsAbbreviation: 'PSI', Good: true });

      const req = mockReq('POST', '/admin/import/execute', {
        connection,
        remoteElementWebId: 'REMOTE_MAPPED',
        targetParentWebId: dbWebId,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      const events = parseNdjsonEvents(res);
      const result = getResultEvent(events);
      expect(result.attributesCreated).toBe(1);
      expect(result.tagsCreated).toBe(1);

      // Verify attribute is mapped to the new tag
      const roots = afModel.getRootElements(dbWebId);
      const imported = roots.find(el => el.name === 'MappedElement');
      expect(imported).toBeTruthy();
      expect(imported!.attributes[0].piPointName).toBe('ServerTag.Name');
      expect(imported!.attributes[0].dataReference).toBe('PI Point');

      // Verify tag registered in registry
      const tagMeta = registry.getByTagName('ServerTag.Name');
      expect(tagMeta).toBeTruthy();
      expect(tagMeta!.unit).toBe('PSI');

      // Verify tag profile: nominal=value, min=50%, max=150%
      const profile = generator.getProfile('ServerTag.Name');
      expect(profile).toBeTruthy();
      expect(profile!.nominal).toBe(150.5);
      expect(profile!.min).toBe(150.5 * 0.5);
      expect(profile!.max).toBe(150.5 * 1.5);
    });

    it('resolves PI Point name via Links.Point instead of ConfigString', async () => {
      const dbs = afModel.getDatabases();
      const dbWebId = dbs[0].webId;

      const elementData = {
        WebId: 'REMOTE_LINKED',
        Name: 'LinkedElement',
        Description: '',
        Path: '\\\\R\\D\\LinkedElement',
        HasChildren: false,
      };
      const attrData = {
        Items: [
          {
            WebId: 'REMOTE_LINK_AT',
            Name: 'LinkedAttr',
            Description: '',
            Type: 'Double',
            DefaultUnitsOfMeasure: 'PSI',
            DataReferencePlugIn: 'PI Point',
            // Parametric ConfigString — cannot be parsed directly
            ConfigString: '%Element%\\%@Vessel%|%Attribute%',
            Links: {
              Self: 'https://piserver.test/piwebapi/attributes/REMOTE_LINK_AT',
              Point: 'https://piserver.test/piwebapi/points/POINT_WEB_ID_123',
            },
          },
        ],
      };
      const pointData = {
        WebId: 'POINT_WEB_ID_123',
        Name: 'BOP.ACC.SystemPressure',
        Path: '\\\\PIServer\\BOP.ACC.SystemPressure',
        PointType: 'Float32',
        EngineeringUnits: 'PSI',
      };

      // Phase 1: count — getElement
      mockFetchResponse(elementData);
      // Phase 2: import — getElement, getAttributes, getPointFromUrl(Links.Point), getStreamValue
      mockFetchResponse(elementData);
      mockFetchResponse(attrData);
      mockFetchResponse(pointData); // Links.Point fetch
      mockFetchResponse({ Value: 3000, Timestamp: '2024-01-01T00:00:00Z', UnitsAbbreviation: 'PSI', Good: true });

      const req = mockReq('POST', '/admin/import/execute', {
        connection,
        remoteElementWebId: 'REMOTE_LINKED',
        targetParentWebId: dbWebId,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      const events = parseNdjsonEvents(res);
      const result = getResultEvent(events);
      expect(result.tagsCreated).toBe(1);

      // The tag name should come from the Point object, not the ConfigString
      const tagMeta = registry.getByTagName('BOP.ACC.SystemPressure');
      expect(tagMeta).toBeTruthy();
      expect(tagMeta!.unit).toBe('PSI');

      // Verify attribute is mapped to the resolved tag name
      const roots = afModel.getRootElements(dbWebId);
      const imported = roots.find(el => el.name === 'LinkedElement');
      expect(imported!.attributes[0].piPointName).toBe('BOP.ACC.SystemPressure');

      // Verify profile
      const profile = generator.getProfile('BOP.ACC.SystemPressure');
      expect(profile!.nominal).toBe(3000);
      expect(profile!.min).toBe(1500);
      expect(profile!.max).toBe(4500);
    });

    it('keeps piPointName null for static attributes', async () => {
      const dbs = afModel.getDatabases();
      const dbWebId = dbs[0].webId;

      const elementData = {
        WebId: 'REMOTE_STATIC',
        Name: 'StaticElement',
        Description: '',
        Path: '\\\\R\\D\\StaticElement',
        HasChildren: false,
      };
      const attrData = {
        Items: [
          {
            WebId: 'REMOTE_STATIC_AT',
            Name: 'StaticAttr',
            Description: 'A static value',
            Type: 'String',
            DefaultUnitsOfMeasure: '',
            DataReferencePlugIn: '',
            ConfigString: '',
          },
        ],
      };

      // Phase 1: count — getElement
      mockFetchResponse(elementData);
      // Phase 2: import — getElement, getAttributes (no getStreamValue for static attrs)
      mockFetchResponse(elementData);
      mockFetchResponse(attrData);

      const req = mockReq('POST', '/admin/import/execute', {
        connection,
        remoteElementWebId: 'REMOTE_STATIC',
        targetParentWebId: dbWebId,
      });
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      const events = parseNdjsonEvents(res);
      const result = getResultEvent(events);
      expect(result.attributesCreated).toBe(1);
      expect(result.tagsCreated).toBe(0);

      // Static attribute should have no PI point mapping
      const roots = afModel.getRootElements(dbWebId);
      const imported = roots.find(el => el.name === 'StaticElement');
      expect(imported).toBeTruthy();
      expect(imported!.attributes[0].piPointName).toBeNull();
      expect(imported!.attributes[0].dataReference).toBe('');
    });
  });

  describe('unknown import endpoint', () => {
    it('returns 404 for unknown import paths', async () => {
      const req = mockReq('POST', '/admin/import/unknown', {});
      const res = mockRes();
      const wait = waitForResponse(res);
      handler(req, res);
      await wait;

      expect(res.statusCode).toBe(404);
    });
  });
});
