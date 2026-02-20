import { describe, it, expect, beforeEach, afterEach, jest, mock, spyOn } from 'bun:test';
import { configMock, sdkMock } from './shared-mocks';

let lastQueryArgs: any = null;
let mockMessages: any[] = [];

mock.module('../src/config', () => configMock());

// Don't mock bop-system-prompt — let it use the real template with mocked config.
// Mocking it here would leak 'Test system prompt' into bop-system-prompt.test.ts
// because Bun's mock.module is global (oven-sh/bun#12823).

const mockQuery = jest.fn((args: any) => {
  lastQueryArgs = args;
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const msg of mockMessages) {
        yield msg;
      }
    },
  };
});

mock.module('@anthropic-ai/claude-agent-sdk', () => sdkMock({ query: mockQuery }));

const { BOPAgent } = await import('../src/bop-agent');
const { BOP_SYSTEM_PROMPT } = await import('../src/bop-system-prompt');

describe('BOPAgent', () => {
  const mockMcpServer = {
    name: 'bop-tools',
    version: '1.0.0',
    tools: [],
  } as any;

  let agent: InstanceType<typeof BOPAgent>;

  beforeEach(() => {
    lastQueryArgs = null;
    mockMessages = [];
    jest.clearAllMocks();
    spyOn(console, 'log').mockImplementation((() => {}) as any);
    agent = new BOPAgent(mockMcpServer);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('analyze', () => {
    it('passes prompt and options to query()', async () => {
      mockMessages = [
        {
          type: 'result',
          subtype: 'success',
          result: 'All clear',
        },
      ];

      await agent.analyze('Test context');

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          prompt: 'Test context',
          options: expect.objectContaining({
            systemPrompt: BOP_SYSTEM_PROMPT,
            model: 'sonnet',
            permissionMode: 'bypassPermissions',
            maxTurns: 25,
            allowedTools: expect.arrayContaining([
              'mcp__bop-tools__get_sensor_data',
              'mcp__bop-tools__get_sensor_history',
              'mcp__bop-tools__get_bop_status',
              'mcp__bop-tools__send_alert',
              'mcp__bop-tools__log_recommendation',
            ]),
          }),
        })
      );
    });

    it('collects text from assistant messages', async () => {
      mockMessages = [
        {
          type: 'assistant',
          message: {
            content: [
              { text: 'Analyzing pressure...' },
              { text: 'Found anomaly.' },
            ],
          },
        },
        {
          type: 'result',
          subtype: 'success',
          result: '',
        },
      ];

      const result = await agent.analyze('Check pressure');
      expect(result.text).toContain('Analyzing pressure...');
      expect(result.text).toContain('Found anomaly.');
    });

    it('tracks tool usage from assistant messages', async () => {
      mockMessages = [
        {
          type: 'assistant',
          message: {
            content: [
              { name: 'mcp__bop-tools__get_sensor_data', type: 'tool_use', id: '1', input: {} },
              { name: 'mcp__bop-tools__send_alert', type: 'tool_use', id: '2', input: {} },
            ],
          },
        },
        {
          type: 'assistant',
          message: {
            content: [
              { name: 'mcp__bop-tools__get_sensor_data', type: 'tool_use', id: '3', input: {} },
              { text: 'Done analyzing.' },
            ],
          },
        },
        {
          type: 'result',
          subtype: 'success',
          result: '',
        },
      ];

      const result = await agent.analyze('Check');
      // Deduplicates tool names
      expect(result.toolsUsed).toEqual([
        'mcp__bop-tools__get_sensor_data',
        'mcp__bop-tools__send_alert',
      ]);
    });

    it('captures result text from success result', async () => {
      mockMessages = [
        {
          type: 'result',
          subtype: 'success',
          result: 'Final analysis: system nominal.',
        },
      ];

      const result = await agent.analyze('Check');
      expect(result.text).toContain('Final analysis: system nominal.');
    });

    it('captures cost from result message', async () => {
      mockMessages = [
        {
          type: 'result',
          subtype: 'success',
          result: 'Done',
          total_cost_usd: 0.0142,
        },
      ];

      const result = await agent.analyze('Check');
      expect(result.costUsd).toBe(0.0142);
    });

    it('handles system init messages', async () => {
      mockMessages = [
        {
          type: 'system',
          subtype: 'init',
        },
        {
          type: 'result',
          subtype: 'success',
          result: 'Done',
        },
      ];

      const result = await agent.analyze('Check');
      expect(console.log).toHaveBeenCalledWith('[Agent] Session initialized');
      expect(result.text).toContain('Done');
    });

    it('returns empty text and tools when no messages', async () => {
      mockMessages = [];

      const result = await agent.analyze('Check');
      expect(result.text).toBe('');
      expect(result.toolsUsed).toEqual([]);
      expect(result.costUsd).toBeUndefined();
    });

    it('does not include empty result text', async () => {
      mockMessages = [
        {
          type: 'result',
          subtype: 'error',
          result: '',
        },
      ];

      const result = await agent.analyze('Check');
      expect(result.text).toBe('');
    });

    it('registers MCP server in options', async () => {
      mockMessages = [];

      await agent.analyze('Check');

      expect(lastQueryArgs.options.mcpServers).toEqual({
        'bop-tools': mockMcpServer,
      });
    });
  });

  describe('analyzeStreaming', () => {
    it('passes async iterable to query and logs assistant text', async () => {
      mockMessages = [
        {
          type: 'assistant',
          message: {
            content: [{ text: 'Streaming analysis result' }],
          },
        },
      ];

      async function* generator(): AsyncIterable<any> {
        // no messages needed for this test
      }

      await agent.analyzeStreaming(generator());

      expect(mockQuery).toHaveBeenCalledWith(
        expect.objectContaining({
          options: expect.objectContaining({
            maxTurns: 250,
          }),
        })
      );
      expect(console.log).toHaveBeenCalledWith(
        '[Agent]',
        'Streaming analysis result'
      );
    });
  });
});
