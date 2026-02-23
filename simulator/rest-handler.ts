import http from 'http';
import { TagRegistry } from './tag-registry.js';
import { DataGenerator } from './data-generator.js';
import { parsePITime } from './pi-time.js';

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
      handleGetPoint(url.searchParams, res, registry);
      return true;
    }

    // GET /piwebapi/streams/{webId}/value
    const valueMatch = path.match(/^\/piwebapi\/streams\/([^/]+)\/value$/);
    if (valueMatch && req.method === 'GET') {
      handleGetStreamValue(valueMatch[1]!, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streams/{webId}/recorded
    const recordedMatch = path.match(/^\/piwebapi\/streams\/([^/]+)\/recorded$/);
    if (recordedMatch && req.method === 'GET') {
      handleGetRecorded(recordedMatch[1]!, url.searchParams, res, registry, generator);
      return true;
    }

    // GET /piwebapi/streamsets/channel — WebSocket-only endpoint
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

    return false;
  };
}

function handleGetPoint(
  params: URLSearchParams,
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
  });
}

function handleGetStreamValue(
  webId: string,
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
  if (!sv) {
    // Generate a fresh value if no ticks have happened yet
    sendJson(res, 200, {
      Timestamp: new Date().toISOString(),
      Value: 0,
      UnitsAbbreviation: meta.unit,
      Good: true,
      Questionable: false,
      Substituted: false,
      Annotated: false,
    });
    return;
  }

  sendJson(res, 200, sv);
}

function handleGetRecorded(
  webId: string,
  params: URLSearchParams,
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
  const maxCount = parseInt(params.get('maxCount') || '100', 10);

  const items = generator.getHistory(meta.tagName, startTime, endTime, maxCount);

  sendJson(res, 200, { Items: items });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}
