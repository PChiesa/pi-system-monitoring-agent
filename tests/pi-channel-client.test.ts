import { describe, it, expect, beforeEach, afterEach, jest, mock, spyOn } from 'bun:test';
import { EventEmitter } from 'events';

const MockWebSocketConstructor = jest.fn();

mock.module('ws', () => ({
  default: MockWebSocketConstructor,
}));

// Dynamic import after mock setup
const { PIChannelClient } = await import('../src/pi-channel-client');

function createMockWs(): EventEmitter & { close: ReturnType<typeof jest.fn>; pong: ReturnType<typeof jest.fn> } {
  const emitter = new EventEmitter() as EventEmitter & {
    close: ReturnType<typeof jest.fn>;
    pong: ReturnType<typeof jest.fn>;
  };
  emitter.close = jest.fn();
  emitter.pong = jest.fn();
  return emitter;
}

describe('PIChannelClient', () => {
  const defaultConfig = {
    server: 'piwebapi.example.com',
    webIds: ['WEBID_A', 'WEBID_B'],
    username: 'DOMAIN\\user',
    password: 'secret',
    includeInitialValues: true as boolean | undefined,
    heartbeatRate: 10,
    maxReconnectAttempts: 3,
  };

  let mockWs: ReturnType<typeof createMockWs>;

  beforeEach(() => {
    jest.useFakeTimers();
    spyOn(console, 'log').mockImplementation((() => {}) as any);
    spyOn(console, 'error').mockImplementation((() => {}) as any);

    mockWs = createMockWs();
    MockWebSocketConstructor.mockImplementation(() => mockWs);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    MockWebSocketConstructor.mockReset();
  });

  describe('constructor', () => {
    it('builds correct WebSocket URL with webId params', () => {
      const client = new PIChannelClient(defaultConfig);
      client.connect();

      const url = MockWebSocketConstructor.mock.calls[0][0] as string;
      expect(url).toContain('wss://piwebapi.example.com/piwebapi/streamsets/channel');
      expect(url).toContain('webId=WEBID_A');
      expect(url).toContain('webId=WEBID_B');
      expect(url).toContain('includeInitialValues=true');
      expect(url).toContain('heartbeatRate=10');
    });

    it('sets Basic auth header', () => {
      const client = new PIChannelClient(defaultConfig);
      client.connect();

      const opts = MockWebSocketConstructor.mock.calls[0][1] as any;
      const expected = 'Basic ' + Buffer.from('DOMAIN\\user:secret').toString('base64');
      expect(opts.headers.Authorization).toBe(expected);
    });

    it('defaults includeInitialValues to true', () => {
      const config = { ...defaultConfig, includeInitialValues: undefined };
      const client = new PIChannelClient(config);
      client.connect();

      const url = MockWebSocketConstructor.mock.calls[0][0] as string;
      expect(url).toContain('includeInitialValues=true');
    });

    it('sets includeInitialValues=false when configured', () => {
      const config = { ...defaultConfig, includeInitialValues: false };
      const client = new PIChannelClient(config);
      client.connect();

      const url = MockWebSocketConstructor.mock.calls[0][0] as string;
      expect(url).toContain('includeInitialValues=false');
    });
  });

  describe('connect — message handling', () => {
    it('emits connected on open', (done) => {
      const client = new PIChannelClient(defaultConfig);
      client.on('connected', done);
      client.connect();
      mockWs.emit('open');
    });

    it('emits value events for each stream item', () => {
      const client = new PIChannelClient(defaultConfig);
      const handler = jest.fn();
      client.on('value', handler);
      client.connect();

      const message = JSON.stringify({
        Items: [
          {
            WebId: 'WEBID_A',
            Name: 'BOP.ACC.PRESS.SYS',
            Path: '\\\\SRV\\BOP.ACC.PRESS.SYS',
            Items: [
              {
                Timestamp: '2025-01-01T00:00:00Z',
                Value: 3000,
                UnitsAbbreviation: 'psi',
                Good: true,
                Questionable: false,
                Substituted: false,
                Annotated: false,
              },
            ],
          },
        ],
      });

      mockWs.emit('message', message);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          webId: 'WEBID_A',
          name: 'BOP.ACC.PRESS.SYS',
          Value: 3000,
          Good: true,
        })
      );
    });

    it('emits multiple value events for multiple streams/items', () => {
      const client = new PIChannelClient(defaultConfig);
      const handler = jest.fn();
      client.on('value', handler);
      client.connect();

      const message = JSON.stringify({
        Items: [
          {
            WebId: 'WEBID_A',
            Items: [
              { Timestamp: 'T1', Value: 100, Good: true, UnitsAbbreviation: '', Questionable: false, Substituted: false, Annotated: false },
              { Timestamp: 'T2', Value: 200, Good: true, UnitsAbbreviation: '', Questionable: false, Substituted: false, Annotated: false },
            ],
          },
          {
            WebId: 'WEBID_B',
            Items: [
              { Timestamp: 'T3', Value: 300, Good: false, UnitsAbbreviation: '', Questionable: false, Substituted: false, Annotated: false },
            ],
          },
        ],
      });

      mockWs.emit('message', message);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('ignores non-JSON messages (heartbeats)', () => {
      const client = new PIChannelClient(defaultConfig);
      const handler = jest.fn();
      client.on('value', handler);
      client.connect();

      mockWs.emit('message', 'not-json');
      expect(handler).not.toHaveBeenCalled();
    });

    it('responds to ping with pong', () => {
      const client = new PIChannelClient(defaultConfig);
      client.connect();
      mockWs.emit('ping');
      expect(mockWs.pong).toHaveBeenCalled();
    });
  });

  describe('reconnection', () => {
    it('schedules reconnect on unexpected close', () => {
      const client = new PIChannelClient(defaultConfig);
      client.connect();

      spyOn(Math, 'random').mockReturnValue(0);

      mockWs.emit('close');

      jest.advanceTimersByTime(1000);
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(2);
    });

    it('does not reconnect on intentional disconnect', () => {
      const client = new PIChannelClient(defaultConfig);
      client.connect();

      client.disconnect();
      expect(mockWs.close).toHaveBeenCalled();

      mockWs.emit('close');
      jest.advanceTimersByTime(60000);
      expect(MockWebSocketConstructor).toHaveBeenCalledTimes(1);
    });

    it('emits maxReconnectReached after max attempts', () => {
      const config = { ...defaultConfig, maxReconnectAttempts: 2 };
      const client = new PIChannelClient(config);
      const maxHandler = jest.fn();
      client.on('maxReconnectReached', maxHandler);

      spyOn(Math, 'random').mockReturnValue(0);

      client.connect();

      // First close — attempt 1
      mockWs.emit('close');
      jest.advanceTimersByTime(1000);

      const mockWs2 = createMockWs();
      MockWebSocketConstructor.mockImplementation(() => mockWs2);

      // Second close — attempt 2
      mockWs.emit('close');
      jest.advanceTimersByTime(2000);

      const mockWs3 = createMockWs();
      MockWebSocketConstructor.mockImplementation(() => mockWs3);

      // Third close — should hit max
      mockWs2.emit('close');
      expect(maxHandler).toHaveBeenCalled();
    });
  });

  describe('error handling', () => {
    it('logs WebSocket errors', () => {
      const client = new PIChannelClient(defaultConfig);
      client.connect();
      mockWs.emit('error', new Error('Connection refused'));
      expect(console.error).toHaveBeenCalledWith(
        '[PI Channel] Error:',
        'Connection refused'
      );
    });
  });
});
