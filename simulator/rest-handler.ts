import http from 'http';
import { TagRegistry } from './tag-registry.js';
import { DataGenerator, PIStreamValue } from './data-generator.js';
import { parsePITime } from './pi-time.js';

/** Parse a PI time interval string (e.g. "1h", "5m", "30s") to milliseconds. */
function parseInterval(interval: string): number {
  const match = interval.match(/^(\d+)([smhd])$/);
  if (!match) return 3_600_000; // default 1h
  const amount = parseInt(match[1]!, 10);
  const units: Record<string, number> = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return amount * (units[match[2]!] ?? 3_600_000);
}

/** Build a PI Web API-style self link URL. */
function selfUrl(req: http.IncomingMessage, path: string): string {
  const host = req.headers.host || 'localhost';
  return `https://${host}${path}`;
}

/** Build a Links object with a Self property. */
function selfLinks(req: http.IncomingMessage, path: string): { Self: string } {
  return { Self: selfUrl(req, path) };
}

export function createRestHandler(
  registry: TagRegistry,
  generator: DataGenerator
): (req: http.IncomingMessage, res: http.ServerResponse) => boolean {
  /**
   * Handle PI Web API REST requests. Returns true if the request was handled,
   * false if it should be passed to the next handler (e.g., admin routes).
   */
  return function handleRest(req: http.IncomingMessage, res: http.ServerResponse): boolean {
    const url = new URL(req.url!, `https://${req.headers.host || 'localhost'}`);
    const path = url.pathname;

    // GET /piwebapi/points?path=\\DataArchive\TagName
    if (path === '/piwebapi/points' && req.method === 'GET') {
      handleGetPoint(url.searchParams, req, res, registry);
      return true;
    }

    // GET /piwebapi/points/{webId}
    const pointByIdMatch = path.match(/^\/piwebapi\/points\/([^/]+)$/);
    if (pointByIdMatch && req.method === 'GET') {
      handleGetPointById(pointByIdMatch[1]!, req, res, registry);
      return true;
    }

    // GET /piwebapi/streams/{webId}/value
    const valueMatch = path.match(/^\/piwebapi\/streams\/([^/]+)\/value$/);
    if (valueMatch && req.method === 'GET') {
      handleGetStreamValue(valueMatch[1]!, req, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streams/{webId}/end
    const endMatch = path.match(/^\/piwebapi\/streams\/([^/]+)\/end$/);
    if (endMatch && req.method === 'GET') {
      handleGetStreamEnd(endMatch[1]!, req, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streams/{webId}/recorded
    const recordedMatch = path.match(/^\/piwebapi\/streams\/([^/]+)\/recorded$/);
    if (recordedMatch && req.method === 'GET') {
      handleGetRecorded(recordedMatch[1]!, url.searchParams, req, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streams/{webId}/interpolated
    const interpolatedMatch = path.match(/^\/piwebapi\/streams\/([^/]+)\/interpolated$/);
    if (interpolatedMatch && req.method === 'GET') {
      handleGetInterpolated(interpolatedMatch[1]!, url.searchParams, req, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streams/{webId}/plot
    const plotMatch = path.match(/^\/piwebapi\/streams\/([^/]+)\/plot$/);
    if (plotMatch && req.method === 'GET') {
      handleGetPlot(plotMatch[1]!, url.searchParams, req, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streamsets/value?webId=...&webId=...
    if (path === '/piwebapi/streamsets/value' && req.method === 'GET') {
      handleGetStreamSetsValue(url.searchParams, req, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streamsets/recorded?webId=...&webId=...
    if (path === '/piwebapi/streamsets/recorded' && req.method === 'GET') {
      handleGetStreamSetsRecorded(url.searchParams, req, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streamsets/channel — WebSocket-only endpoint (ad-hoc)
    if (path === '/piwebapi/streamsets/channel' && req.method === 'GET') {
      res.writeHead(426, {
        'Content-Type': 'application/json',
        'Upgrade': 'websocket',
      });
      res.end(JSON.stringify({
        Message: 'This endpoint requires a WebSocket connection. Use wss:// protocol with a WebSocket client, or open /ws-test in your browser for an interactive test UI.',
      }));
      return true;
    }

    // GET /piwebapi/streamsets/{webId}/channel — WebSocket-only endpoint (path-based)
    const streamsetChannelMatch = path.match(/^\/piwebapi\/streamsets\/([^/]+)\/channel$/);
    if (streamsetChannelMatch && req.method === 'GET') {
      res.writeHead(426, {
        'Content-Type': 'application/json',
        'Upgrade': 'websocket',
      });
      res.end(JSON.stringify({
        Message: 'This endpoint requires a WebSocket connection. Use wss:// protocol with a WebSocket client, or open /ws-test in your browser for an interactive test UI.',
      }));
      return true;
    }

    return false;
  };
}

function handleGetPoint(
  params: URLSearchParams,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry
): void {
  const tagPath = params.get('path');
  if (!tagPath) {
    sendJson(res, 400, { Message: 'Missing required parameter: path' });
    return;
  }

  const meta = registry.getByPath(tagPath);
  if (!meta) {
    sendJson(res, 404, {
      Message: `PI Point not found for path '${tagPath}'`,
      Errors: [`No PI Point matching '${tagPath}' was found.`],
    });
    return;
  }

  sendJson(res, 200, {
    WebId: meta.webId,
    Name: meta.tagName,
    Path: meta.path,
    Descriptor: `Simulated ${meta.tagName}`,
    PointType: 'Float32',
    EngineeringUnits: meta.unit,
    Links: selfLinks(req, `/piwebapi/points/${meta.webId}`),
  });
}

function handleGetPointById(
  webId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry
): void {
  const meta = registry.getByWebId(webId);
  if (!meta) {
    sendJson(res, 404, {
      Message: `PI Point not found for WebId '${webId}'`,
      Errors: [`No PI Point matching WebId '${webId}' was found.`],
    });
    return;
  }

  sendJson(res, 200, {
    WebId: meta.webId,
    Name: meta.tagName,
    Path: meta.path,
    Descriptor: `Simulated ${meta.tagName}`,
    PointType: 'Float32',
    EngineeringUnits: meta.unit,
    Links: selfLinks(req, `/piwebapi/points/${meta.webId}`),
  });
}

function handleGetStreamValue(
  webId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry,
  generator: DataGenerator
): void {
  const meta = registry.getByWebId(webId);
  if (!meta) {
    sendJson(res, 404, { Message: `Stream not found for WebId '${webId}'` });
    return;
  }

  const sv = generator.getCurrentValue(meta.tagName);
  const value = sv ?? {
    Timestamp: new Date().toISOString(),
    Value: 0,
    UnitsAbbreviation: meta.unit,
    Good: true,
    Questionable: false,
    Substituted: false,
    Annotated: false,
  };

  sendJson(res, 200, {
    ...value,
    Links: selfLinks(req, `/piwebapi/streams/${webId}/value`),
  });
}

function handleGetStreamEnd(
  webId: string,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry,
  generator: DataGenerator
): void {
  const meta = registry.getByWebId(webId);
  if (!meta) {
    sendJson(res, 404, { Message: `Stream not found for WebId '${webId}'` });
    return;
  }

  const sv = generator.getCurrentValue(meta.tagName);
  const value = sv ?? {
    Timestamp: new Date().toISOString(),
    Value: 0,
    UnitsAbbreviation: meta.unit,
    Good: true,
    Questionable: false,
    Substituted: false,
    Annotated: false,
  };

  sendJson(res, 200, {
    ...value,
    Links: selfLinks(req, `/piwebapi/streams/${webId}/end`),
  });
}

function handleGetRecorded(
  webId: string,
  params: URLSearchParams,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry,
  generator: DataGenerator
): void {
  const meta = registry.getByWebId(webId);
  if (!meta) {
    sendJson(res, 404, { Message: `Stream not found for WebId '${webId}'` });
    return;
  }

  const now = new Date();
  const startTime = parsePITime(params.get('startTime') || '*-1h', now);
  const endTime = parsePITime(params.get('endTime') || '*', now);
  const maxCount = parseInt(params.get('maxCount') || '1000', 10);

  const items = generator.getHistory(meta.tagName, startTime, endTime, maxCount);

  sendJson(res, 200, {
    Items: items,
    Links: selfLinks(req, `/piwebapi/streams/${webId}/recorded`),
  });
}

function handleGetInterpolated(
  webId: string,
  params: URLSearchParams,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry,
  generator: DataGenerator
): void {
  const meta = registry.getByWebId(webId);
  if (!meta) {
    sendJson(res, 404, { Message: `Stream not found for WebId '${webId}'` });
    return;
  }

  const now = new Date();
  const startTime = parsePITime(params.get('startTime') || '*-1d', now);
  const endTime = parsePITime(params.get('endTime') || '*', now);
  const intervalMs = parseInterval(params.get('interval') || '1h');

  // Get raw history for the time range (generous maxCount for interpolation source)
  const raw = generator.getHistory(meta.tagName, startTime, endTime, 10_000);

  if (raw.length === 0) {
    sendJson(res, 200, {
      Items: [],
      Links: selfLinks(req, `/piwebapi/streams/${webId}/interpolated`),
    });
    return;
  }

  // Generate interpolated values at the requested interval spacing
  const items: PIStreamValue[] = [];
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();

  for (let t = startMs; t <= endMs; t += intervalMs) {
    const interpolated = linearInterpolate(raw, t);
    if (interpolated !== null) {
      items.push({
        Timestamp: new Date(t).toISOString(),
        Value: Math.round(interpolated * 100) / 100,
        UnitsAbbreviation: meta.unit,
        Good: true,
        Questionable: false,
        Substituted: false,
        Annotated: false,
      });
    }
  }

  sendJson(res, 200, {
    Items: items,
    Links: selfLinks(req, `/piwebapi/streams/${webId}/interpolated`),
  });
}

/** Linear interpolation between two nearest history points for a given timestamp. */
function linearInterpolate(history: PIStreamValue[], targetMs: number): number | null {
  if (history.length === 0) return null;

  // Find bracketing points
  let before: PIStreamValue | null = null;
  let after: PIStreamValue | null = null;

  for (const sv of history) {
    const t = new Date(sv.Timestamp).getTime();
    if (t <= targetMs) {
      before = sv;
    }
    if (t >= targetMs && !after) {
      after = sv;
      break;
    }
  }

  // Exact match or only one side available
  if (before && after) {
    const t1 = new Date(before.Timestamp).getTime();
    const t2 = new Date(after.Timestamp).getTime();
    if (t1 === t2) return before.Value;
    const ratio = (targetMs - t1) / (t2 - t1);
    return before.Value + ratio * (after.Value - before.Value);
  }

  if (before) return before.Value;
  if (after) return after.Value;
  return null;
}

function handleGetPlot(
  webId: string,
  params: URLSearchParams,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry,
  generator: DataGenerator
): void {
  const meta = registry.getByWebId(webId);
  if (!meta) {
    sendJson(res, 404, { Message: `Stream not found for WebId '${webId}'` });
    return;
  }

  const now = new Date();
  const startTime = parsePITime(params.get('startTime') || '*-1d', now);
  const endTime = parsePITime(params.get('endTime') || '*', now);
  const intervals = parseInt(params.get('intervals') || '24', 10);

  // Get raw history for the time range
  const raw = generator.getHistory(meta.tagName, startTime, endTime, 10_000);

  if (raw.length === 0) {
    sendJson(res, 200, {
      Items: [],
      Links: selfLinks(req, `/piwebapi/streams/${webId}/plot`),
    });
    return;
  }

  // Divide time range into N intervals, pick significant values per interval
  const startMs = startTime.getTime();
  const endMs = endTime.getTime();
  const intervalWidth = (endMs - startMs) / intervals;

  const items: PIStreamValue[] = [];
  const seen = new Set<string>(); // dedup by timestamp

  for (let i = 0; i < intervals; i++) {
    const iStart = startMs + i * intervalWidth;
    const iEnd = startMs + (i + 1) * intervalWidth;

    const bucket = raw.filter((sv) => {
      const t = new Date(sv.Timestamp).getTime();
      return t >= iStart && t < iEnd;
    });

    if (bucket.length === 0) continue;

    // Pick significant values: first, last, min, max
    const significant: PIStreamValue[] = [];

    // First
    significant.push(bucket[0]!);

    // Min and max
    let minSv = bucket[0]!;
    let maxSv = bucket[0]!;
    for (const sv of bucket) {
      if (sv.Value < minSv.Value) minSv = sv;
      if (sv.Value > maxSv.Value) maxSv = sv;
    }
    significant.push(minSv);
    significant.push(maxSv);

    // Last
    significant.push(bucket[bucket.length - 1]!);

    // Sort by timestamp and deduplicate
    significant.sort((a, b) => new Date(a.Timestamp).getTime() - new Date(b.Timestamp).getTime());
    for (const sv of significant) {
      if (!seen.has(sv.Timestamp)) {
        seen.add(sv.Timestamp);
        items.push(sv);
      }
    }
  }

  sendJson(res, 200, {
    Items: items,
    Links: selfLinks(req, `/piwebapi/streams/${webId}/plot`),
  });
}

function handleGetStreamSetsValue(
  params: URLSearchParams,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry,
  generator: DataGenerator
): void {
  const webIds = params.getAll('webId');
  if (webIds.length === 0) {
    sendJson(res, 400, { Message: 'Missing required parameter: webId' });
    return;
  }

  const items: Array<{
    WebId: string;
    Name: string;
    Path: string;
    Items: PIStreamValue[];
    UnitsAbbreviation: string;
    Links: { Self: string };
  }> = [];

  for (const webId of webIds) {
    const meta = registry.getByWebId(webId);
    if (!meta) continue;

    const sv = generator.getCurrentValue(meta.tagName);
    items.push({
      WebId: webId,
      Name: meta.tagName,
      Path: meta.path,
      Items: sv ? [sv] : [],
      UnitsAbbreviation: meta.unit,
      Links: selfLinks(req, `/piwebapi/streams/${webId}/value`),
    });
  }

  sendJson(res, 200, {
    Items: items,
    Links: {},
  });
}

function handleGetStreamSetsRecorded(
  params: URLSearchParams,
  req: http.IncomingMessage,
  res: http.ServerResponse,
  registry: TagRegistry,
  generator: DataGenerator
): void {
  const webIds = params.getAll('webId');
  if (webIds.length === 0) {
    sendJson(res, 400, { Message: 'Missing required parameter: webId' });
    return;
  }

  const now = new Date();
  const startTime = parsePITime(params.get('startTime') || '*-1h', now);
  const endTime = parsePITime(params.get('endTime') || '*', now);
  const maxCount = parseInt(params.get('maxCount') || '1000', 10);

  const items: Array<{
    WebId: string;
    Name: string;
    Path: string;
    Items: PIStreamValue[];
    UnitsAbbreviation: string;
    Links: { Self: string };
  }> = [];

  for (const webId of webIds) {
    const meta = registry.getByWebId(webId);
    if (!meta) continue;

    const history = generator.getHistory(meta.tagName, startTime, endTime, maxCount);
    items.push({
      WebId: webId,
      Name: meta.tagName,
      Path: meta.path,
      Items: history,
      UnitsAbbreviation: meta.unit,
      Links: selfLinks(req, `/piwebapi/streams/${webId}/recorded`),
    });
  }

  sendJson(res, 200, {
    Items: items,
    Links: {},
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
