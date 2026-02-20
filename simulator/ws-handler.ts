import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import { TagRegistry } from './tag-registry.js';
import { DataGenerator, PIStreamValue } from './data-generator.js';

export interface ChannelSession {
  ws: WebSocket;
  subscribedWebIds: string[];
  interval: ReturnType<typeof setInterval> | null;
  heartbeatInterval: ReturnType<typeof setInterval> | null;
}

export class WSHandler {
  private wss: WebSocketServer;
  private registry: TagRegistry;
  private generator: DataGenerator;
  private sessions: Set<ChannelSession> = new Set();

  constructor(registry: TagRegistry, generator: DataGenerator) {
    this.registry = registry;
    this.generator = generator;
    this.wss = new WebSocketServer({ noServer: true });

    this.wss.on('connection', (ws: WebSocket, req: http.IncomingMessage) => {
      this.handleConnection(ws, req);
    });
  }

  /** Handle HTTP upgrade requests — call from the server's 'upgrade' event. */
  handleUpgrade(req: http.IncomingMessage, socket: any, head: Buffer): boolean {
    const url = new URL(req.url!, `wss://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/piwebapi/streamsets/channel') {
      return false;
    }

    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.wss.emit('connection', ws, req);
    });
    return true;
  }

  /** Number of active WebSocket sessions. */
  get sessionCount(): number {
    return this.sessions.size;
  }

  /** Shut down all sessions. */
  closeAll(): void {
    for (const session of this.sessions) {
      if (session.interval) clearInterval(session.interval);
      if (session.heartbeatInterval) clearInterval(session.heartbeatInterval);
      session.ws.close();
    }
    this.sessions.clear();
  }

  private handleConnection(ws: WebSocket, req: http.IncomingMessage): void {
    const url = new URL(req.url!, `wss://${req.headers.host || 'localhost'}`);
    const webIds = url.searchParams.getAll('webId');
    const includeInitial = url.searchParams.get('includeInitialValues') !== 'false';
    const heartbeatRate = parseInt(url.searchParams.get('heartbeatRate') || '5', 10);

    // Validate subscribed WebIds
    const validWebIds = webIds.filter((id) => this.registry.getByWebId(id));

    console.log(
      `[PI Simulator] WebSocket: Client connected, subscribed to ${validWebIds.length} tags`
    );

    const session: ChannelSession = {
      ws,
      subscribedWebIds: validWebIds,
      interval: null,
      heartbeatInterval: null,
    };
    this.sessions.add(session);

    // Send initial values if requested
    if (includeInitial) {
      this.sendSnapshot(session);
    }

    // Stream at 1 Hz
    session.interval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        this.sendUpdate(session);
      }
    }, 1000);

    // Heartbeat ping
    session.heartbeatInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.ping();
      }
    }, heartbeatRate * 1000);

    ws.on('close', () => {
      console.log('[PI Simulator] WebSocket: Client disconnected');
      if (session.interval) clearInterval(session.interval);
      if (session.heartbeatInterval) clearInterval(session.heartbeatInterval);
      this.sessions.delete(session);
    });

    ws.on('error', (err) => {
      console.error('[PI Simulator] WebSocket error:', err.message);
    });
  }

  private sendSnapshot(session: ChannelSession): void {
    const msg = this.buildMessage(session.subscribedWebIds);
    if (msg && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(msg));
    }
  }

  private sendUpdate(session: ChannelSession): void {
    // The server.ts tick() call already generated new values via generator.tick().
    // We just read the latest from the generator.
    const msg = this.buildMessage(session.subscribedWebIds);
    if (msg && session.ws.readyState === WebSocket.OPEN) {
      session.ws.send(JSON.stringify(msg));
    }
  }

  private buildMessage(webIds: string[]): object | null {
    const items: Array<{
      WebId: string;
      Name: string;
      Path: string;
      Items: PIStreamValue[];
    }> = [];

    for (const webId of webIds) {
      const meta = this.registry.getByWebId(webId);
      if (!meta) continue;

      const sv = this.generator.getCurrentValue(meta.tagName);
      if (!sv) continue;

      items.push({
        WebId: webId,
        Name: meta.tagName,
        Path: meta.path,
        Items: [sv],
      });
    }

    if (items.length === 0) return null;
    return { Items: items };
  }
}
