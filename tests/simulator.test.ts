import { describe, it, expect, beforeEach, spyOn } from 'bun:test';
import { EventEmitter } from 'events';

// Import simulator modules directly (no mocking needed — they're standalone)
import { parsePITime } from '../simulator/pi-time';
import { TagRegistry } from '../simulator/tag-registry';
import { DataGenerator } from '../simulator/data-generator';
import { ScenarioEngine } from '../simulator/scenario-engine';
import { createRestHandler } from '../simulator/rest-handler';

/** Minimal mock for http.IncomingMessage. */
function mockReq(method: string, url: string): any {
  return { method, url, headers: { host: 'localhost:8443' } };
}

/** Minimal mock for http.ServerResponse that captures writeHead and body. */
function mockRes(): any {
  const res: any = new EventEmitter();
  res.statusCode = 0;
  res.headers = {};
  res.body = '';
  res.writeHead = (status: number, headers?: Record<string, string>) => {
    res.statusCode = status;
    Object.assign(res.headers, headers);
  };
  res.end = (data?: string) => {
    res.body = data || '';
  };
  return res;
}

/** Parse the JSON body from a mock response. */
function resJson(res: any): any {
  return JSON.parse(res.body);
}

describe('parsePITime', () => {
  const now = new Date('2026-02-20T12:00:00.000Z');

  it('parses "*" as now', () => {
    const result = parsePITime('*', now);
    expect(result.getTime()).toBe(now.getTime());
  });

  it('parses "*-1h" as 1 hour ago', () => {
    const result = parsePITime('*-1h', now);
    expect(result.getTime()).toBe(now.getTime() - 3_600_000);
  });

  it('parses "*-30m" as 30 minutes ago', () => {
    const result = parsePITime('*-30m', now);
    expect(result.getTime()).toBe(now.getTime() - 1_800_000);
  });

  it('parses "*-7d" as 7 days ago', () => {
    const result = parsePITime('*-7d', now);
    expect(result.getTime()).toBe(now.getTime() - 7 * 86_400_000);
  });

  it('parses "*-120s" as 120 seconds ago', () => {
    const result = parsePITime('*-120s', now);
    expect(result.getTime()).toBe(now.getTime() - 120_000);
  });

  it('parses ISO 8601 dates', () => {
    const result = parsePITime('2026-01-15T08:00:00.000Z', now);
    expect(result.toISOString()).toBe('2026-01-15T08:00:00.000Z');
  });

  it('returns now for unrecognized formats', () => {
    const result = parsePITime('invalid', now);
    expect(result.getTime()).toBe(now.getTime());
  });
});

describe('TagRegistry', () => {
  let registry: TagRegistry;

  beforeEach(() => {
    registry = new TagRegistry('SIMULATOR');
  });

  it('registers all 25 tags', () => {
    expect(registry.size).toBe(25);
  });

  it('generates deterministic WebIds', () => {
    const meta1 = registry.getByTagName('BOP.ACC.PRESS.SYS');
    const meta2 = new TagRegistry('SIMULATOR').getByTagName('BOP.ACC.PRESS.SYS');
    expect(meta1!.webId).toBe(meta2!.webId);
  });

  it('looks up by tag name', () => {
    const meta = registry.getByTagName('BOP.ACC.PRESS.SYS');
    expect(meta).toBeDefined();
    expect(meta!.unit).toBe('PSI');
    expect(meta!.webId).toMatch(/^SIM_/);
  });

  it('looks up by WebId', () => {
    const meta = registry.getByTagName('WELL.FLOW.DELTA')!;
    const found = registry.getByWebId(meta.webId);
    expect(found).toBeDefined();
    expect(found!.tagName).toBe('WELL.FLOW.DELTA');
  });

  it('looks up by PI path format', () => {
    // PIRestClient sends: \\\\SIMULATOR\\BOP.ACC.PRESS.SYS
    const meta = registry.getByPath('\\\\SIMULATOR\\BOP.ACC.PRESS.SYS');
    expect(meta).toBeDefined();
    expect(meta!.tagName).toBe('BOP.ACC.PRESS.SYS');
  });

  it('returns undefined for unknown tags', () => {
    expect(registry.getByTagName('NONEXISTENT')).toBeUndefined();
    expect(registry.getByWebId('FAKE_WEBID')).toBeUndefined();
    expect(registry.getByPath('\\\\SIMULATOR\\NONEXISTENT')).toBeUndefined();
  });

  it('getAllMeta returns all tags', () => {
    const all = registry.getAllMeta();
    expect(all.length).toBe(25);
  });
});

describe('DataGenerator', () => {
  let registry: TagRegistry;
  let generator: DataGenerator;

  beforeEach(() => {
    registry = new TagRegistry();
    generator = new DataGenerator(registry);
  });

  it('generates values for all tags on tick', () => {
    const values = generator.tick(new Date('2026-02-20T12:00:00Z'));
    expect(values.size).toBe(25);
  });

  it('generates values near nominal for pressure tags', () => {
    // Run several ticks to build state
    for (let i = 0; i < 10; i++) {
      generator.tick(new Date(Date.now() + i * 1000));
    }

    const sv = generator.getCurrentValue('BOP.ACC.PRESS.SYS');
    expect(sv).toBeDefined();
    // Should be near 3000 PSI (nominal) — allow wide range for noise
    expect(sv!.Value).toBeGreaterThan(2800);
    expect(sv!.Value).toBeLessThan(3200);
  });

  it('discrete tags stay at nominal without modifiers', () => {
    generator.tick();
    const sv = generator.getCurrentValue('BOP.ANN01.POS');
    expect(sv).toBeDefined();
    expect(sv!.Value).toBe(0);
  });

  it('produces PI stream value format', () => {
    generator.tick();
    const sv = generator.getCurrentValue('BOP.MAN.PRESS.REG')!;
    expect(sv).toHaveProperty('Timestamp');
    expect(sv).toHaveProperty('Value');
    expect(sv).toHaveProperty('UnitsAbbreviation');
    expect(sv.Good).toBe(true);
    expect(sv.Questionable).toBe(false);
    expect(sv.Substituted).toBe(false);
    expect(sv.Annotated).toBe(false);
  });

  it('builds history over multiple ticks', () => {
    const start = new Date('2026-02-20T12:00:00Z');
    for (let i = 0; i < 60; i++) {
      generator.tick(new Date(start.getTime() + i * 1000));
    }

    const history = generator.getHistory(
      'BOP.ACC.PRESS.SYS',
      new Date('2026-02-20T12:00:00Z'),
      new Date('2026-02-20T12:01:00Z'),
      100
    );
    expect(history.length).toBe(60);
  });

  it('downsamples history when maxCount is exceeded', () => {
    const start = new Date('2026-02-20T12:00:00Z');
    for (let i = 0; i < 100; i++) {
      generator.tick(new Date(start.getTime() + i * 1000));
    }

    const history = generator.getHistory(
      'BOP.ACC.PRESS.SYS',
      new Date('2026-02-20T12:00:00Z'),
      new Date('2026-02-20T12:02:00Z'),
      10
    );
    expect(history.length).toBe(10);
  });

  it('applies scenario modifiers', () => {
    generator.setScenarioStartTime(Date.now() - 60000); // 60s ago
    generator.setModifier('BOP.ACC.PRESS.SYS', (_nominal, _elapsed) => 1500);

    generator.tick();
    const sv = generator.getCurrentValue('BOP.ACC.PRESS.SYS');
    // Should be moving toward 1500 (modifier target), not 3000 (nominal)
    expect(sv!.Value).toBeLessThan(2900);
  });

  it('clears modifiers', () => {
    generator.setScenarioStartTime(Date.now());
    generator.setModifier('BOP.ACC.PRESS.SYS', () => 500);

    // Run a few ticks with modifier
    for (let i = 0; i < 20; i++) generator.tick();

    // Clear and run more ticks — should revert toward nominal (3000)
    generator.clearAllModifiers();
    generator.clearScenarioStartTime();
    for (let i = 0; i < 100; i++) generator.tick();

    const sv = generator.getCurrentValue('BOP.ACC.PRESS.SYS');
    expect(sv!.Value).toBeGreaterThan(2000);
  });
});

describe('ScenarioEngine', () => {
  let registry: TagRegistry;
  let generator: DataGenerator;
  let engine: ScenarioEngine;

  beforeEach(() => {
    spyOn(console, 'log').mockImplementation((() => {}) as any);
    registry = new TagRegistry();
    generator = new DataGenerator(registry);
    engine = new ScenarioEngine(generator, 'manual');
  });

  it('lists all built-in scenarios', () => {
    const list = engine.listScenarios();
    const names = list.map((s) => s.name);
    expect(names).toContain('normal');
    expect(names).toContain('accumulator-decay');
    expect(names).toContain('kick-detection');
    expect(names).toContain('ram-slowdown');
    expect(names).toContain('pod-failure');
  });

  it('starts in normal state', () => {
    expect(engine.getActiveScenarioName()).toBe('normal');
  });

  it('activates a scenario', () => {
    const ok = engine.activate('kick-detection');
    expect(ok).toBe(true);
    expect(engine.getActiveScenarioName()).toBe('kick-detection');
  });

  it('deactivates a scenario', () => {
    engine.activate('kick-detection');
    engine.deactivate();
    expect(engine.getActiveScenarioName()).toBe('normal');
  });

  it('returns false for unknown scenario', () => {
    const ok = engine.activate('nonexistent');
    expect(ok).toBe(false);
  });

  it('activating normal deactivates current scenario', () => {
    engine.activate('kick-detection');
    engine.activate('normal');
    expect(engine.getActiveScenarioName()).toBe('normal');
  });

  it('switching scenarios deactivates previous', () => {
    engine.activate('kick-detection');
    engine.activate('pod-failure');
    expect(engine.getActiveScenarioName()).toBe('pod-failure');
  });
});

describe('REST Handler', () => {
  let registry: TagRegistry;
  let generator: DataGenerator;
  let handler: ReturnType<typeof createRestHandler>;
  let webId: string;

  beforeEach(() => {
    registry = new TagRegistry('SIMULATOR');
    generator = new DataGenerator(registry);
    handler = createRestHandler(registry, generator);
    webId = registry.getByTagName('BOP.ACC.PRESS.SYS')!.webId;

    // Seed some history
    const start = new Date('2026-02-20T12:00:00Z');
    for (let i = 0; i < 120; i++) {
      generator.tick(new Date(start.getTime() + i * 1000));
    }
  });

  // ── GET /piwebapi/points?path=... ─────────────────────────────

  it('GET /piwebapi/points includes Links.Self', () => {
    const req = mockReq('GET', `/piwebapi/points?path=\\\\SIMULATOR\\BOP.ACC.PRESS.SYS`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Links).toBeDefined();
    expect(body.Links.Self).toContain(`/piwebapi/points/${webId}`);
  });

  // ── GET /piwebapi/points/{webId} ──────────────────────────────

  it('GET /piwebapi/points/{webId} returns point metadata', () => {
    const req = mockReq('GET', `/piwebapi/points/${webId}`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.WebId).toBe(webId);
    expect(body.Name).toBe('BOP.ACC.PRESS.SYS');
    expect(body.EngineeringUnits).toBe('PSI');
    expect(body.Links).toBeDefined();
    expect(body.Links.Self).toContain(`/piwebapi/points/${webId}`);
  });

  it('GET /piwebapi/points/{webId} returns 404 for unknown WebId', () => {
    const req = mockReq('GET', '/piwebapi/points/FAKE_WEBID');
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  // ── GET /piwebapi/streams/{webId}/value ───────────────────────

  it('GET /streams/{webId}/value includes Links.Self', () => {
    const req = mockReq('GET', `/piwebapi/streams/${webId}/value`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Timestamp).toBeDefined();
    expect(body.Value).toBeDefined();
    expect(body.Links).toBeDefined();
    expect(body.Links.Self).toContain(`/piwebapi/streams/${webId}/value`);
  });

  // ── GET /piwebapi/streams/{webId}/end ─────────────────────────

  it('GET /streams/{webId}/end returns latest value with Links', () => {
    const req = mockReq('GET', `/piwebapi/streams/${webId}/end`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Timestamp).toBeDefined();
    expect(body.Value).toBeDefined();
    expect(body.Good).toBe(true);
    expect(body.Links).toBeDefined();
    expect(body.Links.Self).toContain(`/piwebapi/streams/${webId}/end`);
  });

  it('GET /streams/{webId}/end returns 404 for unknown stream', () => {
    const req = mockReq('GET', '/piwebapi/streams/FAKE_WEBID/end');
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  // ── GET /piwebapi/streams/{webId}/recorded ────────────────────

  it('GET /streams/{webId}/recorded includes Links.Self', () => {
    const req = mockReq('GET', `/piwebapi/streams/${webId}/recorded?startTime=2026-02-20T12:00:00Z&endTime=2026-02-20T12:02:00Z`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Items).toBeDefined();
    expect(Array.isArray(body.Items)).toBe(true);
    expect(body.Items.length).toBeGreaterThan(0);
    expect(body.Links).toBeDefined();
    expect(body.Links.Self).toContain(`/piwebapi/streams/${webId}/recorded`);
  });

  it('GET /streams/{webId}/recorded defaults maxCount to 1000', () => {
    // Seed 1200 ticks to test that default maxCount is 1000 (not 100)
    const gen2 = new DataGenerator(registry);
    const handler2 = createRestHandler(registry, gen2);
    const start = new Date('2026-02-20T12:00:00Z');
    for (let i = 0; i < 1200; i++) {
      gen2.tick(new Date(start.getTime() + i * 1000));
    }

    const req = mockReq('GET', `/piwebapi/streams/${webId}/recorded?startTime=2026-02-20T12:00:00Z&endTime=2026-02-20T12:20:00Z`);
    const res = mockRes();
    handler2(req, res);

    const body = resJson(res);
    // With 1200 data points and default maxCount=1000, we should get 1000
    expect(body.Items.length).toBe(1000);
  });

  // ── GET /piwebapi/streams/{webId}/interpolated ────────────────

  it('GET /streams/{webId}/interpolated returns interpolated values', () => {
    const req = mockReq('GET', `/piwebapi/streams/${webId}/interpolated?startTime=2026-02-20T12:00:00Z&endTime=2026-02-20T12:02:00Z&interval=30s`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Items).toBeDefined();
    expect(Array.isArray(body.Items)).toBe(true);
    // 2 minutes / 30 seconds = 4 intervals + 1 = 5 points (at t=0, 30, 60, 90, 120)
    expect(body.Items.length).toBe(5);
    expect(body.Links).toBeDefined();
    expect(body.Links.Self).toContain('/interpolated');

    // Each item should have the correct format
    for (const item of body.Items) {
      expect(item.Timestamp).toBeDefined();
      expect(typeof item.Value).toBe('number');
      expect(item.Good).toBe(true);
    }
  });

  it('GET /streams/{webId}/interpolated returns 404 for unknown stream', () => {
    const req = mockReq('GET', '/piwebapi/streams/FAKE_WEBID/interpolated');
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  it('GET /streams/{webId}/interpolated returns empty Items when no history', () => {
    // Fresh generator with no ticks
    const gen2 = new DataGenerator(registry);
    const handler2 = createRestHandler(registry, gen2);

    const req = mockReq('GET', `/piwebapi/streams/${webId}/interpolated?startTime=2026-02-20T12:00:00Z&endTime=2026-02-20T12:01:00Z&interval=30s`);
    const res = mockRes();
    handler2(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Items).toEqual([]);
  });

  // ── GET /piwebapi/streams/{webId}/plot ────────────────────────

  it('GET /streams/{webId}/plot returns significant values per interval', () => {
    const req = mockReq('GET', `/piwebapi/streams/${webId}/plot?startTime=2026-02-20T12:00:00Z&endTime=2026-02-20T12:02:00Z&intervals=4`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Items).toBeDefined();
    expect(Array.isArray(body.Items)).toBe(true);
    // Should have multiple plot points (up to 4 per interval * 4 intervals, deduplicated)
    expect(body.Items.length).toBeGreaterThan(0);
    expect(body.Links).toBeDefined();
    expect(body.Links.Self).toContain('/plot');
  });

  it('GET /streams/{webId}/plot returns 404 for unknown stream', () => {
    const req = mockReq('GET', '/piwebapi/streams/FAKE_WEBID/plot');
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(404);
  });

  // ── GET /piwebapi/streamsets/value?webId=...&webId=... ────────

  it('GET /streamsets/value returns values for multiple streams', () => {
    const webId2 = registry.getByTagName('WELL.FLOW.IN')!.webId;
    const req = mockReq('GET', `/piwebapi/streamsets/value?webId=${webId}&webId=${webId2}`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Items).toBeDefined();
    expect(body.Items.length).toBe(2);
    expect(body.Links).toBeDefined();

    // Each stream item should have the full structure
    for (const item of body.Items) {
      expect(item.WebId).toBeDefined();
      expect(item.Name).toBeDefined();
      expect(item.Path).toBeDefined();
      expect(item.Items).toBeDefined();
      expect(item.UnitsAbbreviation).toBeDefined();
      expect(item.Links).toBeDefined();
      expect(item.Links.Self).toBeDefined();
    }
  });

  it('GET /streamsets/value returns 400 when no webId provided', () => {
    const req = mockReq('GET', '/piwebapi/streamsets/value');
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  // ── GET /piwebapi/streamsets/recorded?webId=...&webId=... ─────

  it('GET /streamsets/recorded returns recorded values for multiple streams', () => {
    const webId2 = registry.getByTagName('WELL.FLOW.IN')!.webId;
    const req = mockReq('GET', `/piwebapi/streamsets/recorded?webId=${webId}&webId=${webId2}&startTime=2026-02-20T12:00:00Z&endTime=2026-02-20T12:02:00Z`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(200);
    const body = resJson(res);
    expect(body.Items).toBeDefined();
    expect(body.Items.length).toBe(2);
    expect(body.Links).toBeDefined();

    for (const item of body.Items) {
      expect(item.WebId).toBeDefined();
      expect(item.Name).toBeDefined();
      expect(item.Items.length).toBeGreaterThan(0);
      expect(item.UnitsAbbreviation).toBeDefined();
      expect(item.Links).toBeDefined();
    }
  });

  it('GET /streamsets/recorded returns 400 when no webId provided', () => {
    const req = mockReq('GET', '/piwebapi/streamsets/recorded');
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(400);
  });

  // ── WebSocket-only endpoints return 426 ───────────────────────

  it('GET /streamsets/channel returns 426 for HTTP requests', () => {
    const req = mockReq('GET', '/piwebapi/streamsets/channel');
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(426);
  });

  it('GET /streamsets/{webId}/channel returns 426 for HTTP requests', () => {
    const req = mockReq('GET', `/piwebapi/streamsets/${webId}/channel`);
    const res = mockRes();
    handler(req, res);

    expect(res.statusCode).toBe(426);
  });

  // ── Unhandled routes return false ─────────────────────────────

  it('returns false for unknown routes', () => {
    const req = mockReq('GET', '/unknown');
    const res = mockRes();
    const handled = handler(req, res);

    expect(handled).toBe(false);
  });
});
