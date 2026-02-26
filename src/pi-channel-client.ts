import WebSocket from 'ws';
import { EventEmitter } from 'events';

export interface PIStreamValue {
  Timestamp: string;
  Value: number | string | boolean;
  UnitsAbbreviation: string;
  Good: boolean;
  Questionable: boolean;
  Substituted: boolean;
  Annotated: boolean;
}

export interface PIChannelMessage {
  Items: Array<{
    WebId?: string;
    Name?: string;
    Path?: string;
    Items: PIStreamValue[];
  }>;
}

export interface PIChannelConfig {
  server: string;
  webIds: string[];
  username: string;
  password: string;
  includeInitialValues?: boolean;
  heartbeatRate?: number;
  maxReconnectAttempts?: number;
  rejectUnauthorized?: boolean;
}

export class PIChannelClient extends EventEmitter {
  private ws: WebSocket | null = null;
  private reconnectDelay = 1000;
  private maxReconnectDelay = 30000;
  private reconnectAttempts = 0;
  private intentionallyClosed = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private url: string;
  private authHeader: string;
  private config: PIChannelConfig;

  constructor(config: PIChannelConfig) {
    super();
    this.config = config;

    // Build the channel URL — all subscriptions are defined in the URL
    const webIdParams = config.webIds.map((id) => `webId=${id}`).join('&');
    const initValues = config.includeInitialValues !== false ? 'true' : 'false';
    const heartbeat = config.heartbeatRate ?? 5;

    // Note: wss:// not https:// — this is a raw WebSocket, not SignalR
    this.url =
      `wss://${config.server}/piwebapi/streamsets/channel` +
      `?${webIdParams}` +
      `&includeInitialValues=${initValues}` +
      `&heartbeatRate=${heartbeat}`;

    this.authHeader =
      'Basic ' + Buffer.from(`${config.username}:${config.password}`).toString('base64');
  }

  connect(): void {
    this.intentionallyClosed = false;

    // Clean up any previous socket to prevent orphaned connections
    if (this.ws) {
      this.ws.removeAllListeners();
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }

    this.ws = new WebSocket(this.url, {
      headers: { Authorization: this.authHeader },
      rejectUnauthorized: this.config.rejectUnauthorized ?? true,
    });

    this.ws.on('open', () => {
      console.log('[PI Channel] Connected — streaming sensor data');
      this.reconnectDelay = 1000;
      this.reconnectAttempts = 0;
      this.emit('connected');
    });

    this.ws.on('message', (data: WebSocket.Data) => {
      try {
        const msg: PIChannelMessage = JSON.parse(data.toString());
        // Each message can contain multiple streams, each with multiple values
        for (const stream of msg.Items) {
          for (const value of stream.Items) {
            this.emit('value', {
              webId: stream.WebId,
              name: stream.Name,
              path: stream.Path,
              ...value,
            });
          }
        }
      } catch {
        // Heartbeat or keep-alive frame — ignore
      }
    });

    this.ws.on('close', () => {
      if (!this.intentionallyClosed) this.scheduleReconnect();
    });

    this.ws.on('error', (err: Error) => {
      console.error('[PI Channel] Error:', err.message);
    });

    this.ws.on('ping', () => this.ws?.pong());
  }

  private scheduleReconnect(): void {
    // Prevent multiple concurrent reconnect timers
    if (this.reconnectTimer) return;

    const maxAttempts = this.config.maxReconnectAttempts ?? 50;
    if (this.reconnectAttempts >= maxAttempts) {
      this.emit('maxReconnectReached');
      return;
    }

    const jitter = Math.random() * 1000;
    const delay = Math.min(this.reconnectDelay + jitter, this.maxReconnectDelay);

    console.log(
      `[PI Channel] Reconnecting in ${Math.round(delay)}ms` +
        ` (attempt ${this.reconnectAttempts + 1}/${maxAttempts})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.reconnectAttempts++;
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, this.maxReconnectDelay);
      this.connect();
    }, delay);
  }

  disconnect(): void {
    this.intentionallyClosed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
  }
}
