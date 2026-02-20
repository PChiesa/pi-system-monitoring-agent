import { describe, it, expect, beforeEach, afterEach, jest, mock, spyOn } from 'bun:test';
import { sdkMock } from './shared-mocks';

const mockToolHandlers = new Map<string, Function>();

mock.module('@anthropic-ai/claude-agent-sdk', () => sdkMock({
  tool: (name: string, _desc: string, _schema: any, handler: Function) => {
    mockToolHandlers.set(name, handler);
    return { name, handler };
  },
  createSdkMcpServer: (config: any) => ({
    name: config.name,
    version: config.version,
    tools: config.tools,
  }),
}));

const mockAxiosGet = jest.fn<(...args: any[]) => any>();

mock.module('axios', () => ({
  default: {
    create: jest.fn(() => ({ get: mockAxiosGet })),
  },
}));

const { SensorStateManager } = await import('../src/sensor-state');
const { PIRestClient } = await import('../src/pi-rest-client');
const { AlertManager } = await import('../src/alert-manager');
const { createBOPToolsServer } = await import('../src/bop-tools');

describe('createBOPToolsServer', () => {
  let sensorState: InstanceType<typeof SensorStateManager>;
  let piRest: InstanceType<typeof PIRestClient>;
  let alertManager: InstanceType<typeof AlertManager>;

  beforeEach(() => {
    mockToolHandlers.clear();
    spyOn(console, 'log').mockImplementation((() => {}) as any);

    sensorState = new SensorStateManager(10);
    sensorState.registerTag('BOP.ACC.PRESS.SYS', 'w1', 'PSI');
    sensorState.registerTag('BOP.ANN01.POS', 'w2', '');
    sensorState.update('w1', 3000, new Date('2025-01-01T00:00:00Z'), true);
    sensorState.update('w2', 1, new Date('2025-01-01T00:00:00Z'), true);

    piRest = new PIRestClient('server', 'user', 'pass');
    alertManager = new AlertManager();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates MCP server with 5 tools', () => {
    const server = createBOPToolsServer(sensorState, piRest, alertManager) as any;
    expect(server.tools).toHaveLength(5);
    expect(server.name).toBe('bop-tools');
    expect(server.version).toBe('1.0.0');
  });

  it('registers all expected tool names', () => {
    createBOPToolsServer(sensorState, piRest, alertManager);
    expect(mockToolHandlers.has('get_sensor_data')).toBe(true);
    expect(mockToolHandlers.has('get_sensor_history')).toBe(true);
    expect(mockToolHandlers.has('get_bop_status')).toBe(true);
    expect(mockToolHandlers.has('send_alert')).toBe(true);
    expect(mockToolHandlers.has('log_recommendation')).toBe(true);
  });

  describe('get_sensor_data tool', () => {
    it('returns current values for requested tags', async () => {
      createBOPToolsServer(sensorState, piRest, alertManager);
      const handler = mockToolHandlers.get('get_sensor_data')!;

      const result = await handler({
        tags: ['BOP.ACC.PRESS.SYS', 'BOP.ANN01.POS'],
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed['BOP.ACC.PRESS.SYS'].value).toBe(3000);
      expect(parsed['BOP.ACC.PRESS.SYS'].unit).toBe('PSI');
      expect(parsed['BOP.ANN01.POS'].value).toBe(1);
    });

    it('returns error for unknown tags', async () => {
      createBOPToolsServer(sensorState, piRest, alertManager);
      const handler = mockToolHandlers.get('get_sensor_data')!;

      const result = await handler({ tags: ['NONEXISTENT'] });
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed['NONEXISTENT']).toEqual({ error: 'Unknown tag: NONEXISTENT' });
    });
  });

  describe('get_sensor_history tool', () => {
    it('returns historical data for valid tag', async () => {
      const historyItems = [
        { Timestamp: 'T1', Value: 3000 },
        { Timestamp: 'T2', Value: 2950 },
      ];
      mockAxiosGet.mockResolvedValue({
        data: { Items: historyItems },
      });

      createBOPToolsServer(sensorState, piRest, alertManager);
      const handler = mockToolHandlers.get('get_sensor_history')!;

      const result = await handler({
        tag: 'BOP.ACC.PRESS.SYS',
        startTime: '*-1h',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed).toEqual(historyItems);
    });

    it('returns error for unknown tag', async () => {
      createBOPToolsServer(sensorState, piRest, alertManager);
      const handler = mockToolHandlers.get('get_sensor_history')!;

      const result = await handler({
        tag: 'UNKNOWN.TAG',
        startTime: '*-1h',
      });

      expect(result.content[0].text).toContain('Error: Unknown tag');
    });

    it('returns error on PI query failure', async () => {
      mockAxiosGet.mockRejectedValue(new Error('Connection timeout'));

      createBOPToolsServer(sensorState, piRest, alertManager);
      const handler = mockToolHandlers.get('get_sensor_history')!;

      const result = await handler({
        tag: 'BOP.ACC.PRESS.SYS',
        startTime: '*-1h',
      });

      expect(result.content[0].text).toContain('PI query error: Connection timeout');
    });
  });

  describe('get_bop_status tool', () => {
    it('returns full snapshot with alerts', async () => {
      await alertManager.send({
        severity: 'WARNING',
        title: 'Test',
        description: 'Test',
        recommendedAction: 'Test',
        timestamp: '2025-01-01T00:00:00Z',
      });

      createBOPToolsServer(sensorState, piRest, alertManager);
      const handler = mockToolHandlers.get('get_bop_status')!;

      const result = await handler({});
      const parsed = JSON.parse(result.content[0].text);

      expect(parsed.sensors['BOP.ACC.PRESS.SYS'].value).toBe(3000);
      expect(parsed.sensors['BOP.ANN01.POS'].value).toBe(1);
      expect(parsed.activeAlerts).toHaveLength(1);
      expect(parsed.activeAlerts[0].title).toBe('Test');
      expect(parsed.timestamp).toBeDefined();
    });
  });

  describe('send_alert tool', () => {
    it('sends alert through AlertManager', async () => {
      createBOPToolsServer(sensorState, piRest, alertManager);
      const handler = mockToolHandlers.get('send_alert')!;

      const result = await handler({
        severity: 'CRITICAL',
        title: 'Low pressure',
        description: 'Accumulator below MOP',
        affectedComponents: ['Accumulator'],
        recommendedAction: 'Check hydraulics',
      });

      expect(result.content[0].text).toContain('Alert sent at');
      expect(alertManager.getActiveAlerts()).toHaveLength(1);
      expect(alertManager.getActiveAlerts()[0].severity).toBe('CRITICAL');
    });
  });

  describe('log_recommendation tool', () => {
    it('logs recommendation through AlertManager', async () => {
      createBOPToolsServer(sensorState, piRest, alertManager);
      const handler = mockToolHandlers.get('log_recommendation')!;

      const result = await handler({
        category: 'MAINTENANCE',
        component: 'Annular Preventer',
        recommendation: 'Inspect sealing element',
        priority: 'HIGH',
        dueWithinDays: 7,
      });

      expect(result.content[0].text).toContain('Recommendation logged at');
      expect(alertManager.getRecommendations()).toHaveLength(1);
      expect(alertManager.getRecommendations()[0].category).toBe('MAINTENANCE');
    });
  });
});
