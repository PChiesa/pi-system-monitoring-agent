import { query } from '@anthropic-ai/claude-agent-sdk';
import type { McpSdkServerConfigWithInstance, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { BOP_SYSTEM_PROMPT } from './bop-system-prompt.js';
import { BOP_CONFIG } from './config.js';

interface AnalysisResult {
  text: string;
  toolsUsed: string[];
  costUsd?: number;
}

export class BOPAgent {
  private mcpServer: McpSdkServerConfigWithInstance;

  constructor(mcpServer: McpSdkServerConfigWithInstance) {
    this.mcpServer = mcpServer;
  }

  /**
   * Run a single analysis pass. The Agent SDK manages the entire
   * tool-use loop internally — we just provide the prompt and tools,
   * then iterate over streamed messages.
   */
  async analyze(triggerContext: string): Promise<AnalysisResult> {
    const outputParts: string[] = [];
    const toolsUsed: string[] = [];
    let costUsd: number | undefined;

    for await (const message of query({
      prompt: triggerContext,
      options: {
        // Fully custom system prompt — NOT the claude_code preset
        systemPrompt: BOP_SYSTEM_PROMPT,

        // Model selection (sonnet for cost efficiency, opus for complex analysis)
        model: BOP_CONFIG.agentModel,

        // Register our custom MCP tools server
        mcpServers: {
          'bop-tools': this.mcpServer,
        },

        // Explicitly allow only our BOP tools — no file system, no bash
        allowedTools: [
          'mcp__bop-tools__get_sensor_data',
          'mcp__bop-tools__get_sensor_history',
          'mcp__bop-tools__get_bop_status',
          'mcp__bop-tools__send_alert',
          'mcp__bop-tools__log_recommendation',
        ],

        // Bypass permission prompts (autonomous monitoring agent)
        permissionMode: 'bypassPermissions',

        // Limit turns to prevent runaway analysis
        maxTurns: 25,
      },
    })) {
      // Process different message types from the SDK
      switch (message.type) {
        case 'assistant':
          // Claude's reasoning and responses
          for (const block of message.message.content) {
            if ('text' in block && block.text) {
              outputParts.push(block.text);
            }
            if ('name' in block) {
              // Tool use block — track which tools were called
              toolsUsed.push(block.name);
            }
          }
          break;

        case 'result':
          // Final result from the agent
          if (message.subtype === 'success' && message.result) {
            outputParts.push(message.result);
          }
          if ('total_cost_usd' in message) {
            costUsd = message.total_cost_usd as number;
          }
          break;

        case 'system':
          // System messages (init, MCP connection status, etc.)
          if (message.subtype === 'init') {
            console.log('[Agent] Session initialized');
          }
          break;
      }
    }

    return {
      text: outputParts.join('\n'),
      toolsUsed: [...new Set(toolsUsed)],
      costUsd,
    };
  }

  /**
   * Streaming analysis using AsyncIterable input.
   * This enables a long-lived agent that receives sensor events continuously.
   * Each yielded message becomes a new user turn in the conversation.
   */
  async analyzeStreaming(
    messageGenerator: AsyncIterable<SDKUserMessage>
  ): Promise<void> {
    for await (const message of query({
      prompt: messageGenerator,
      options: {
        systemPrompt: BOP_SYSTEM_PROMPT,
        model: BOP_CONFIG.agentModel,
        mcpServers: { 'bop-tools': this.mcpServer },
        allowedTools: [
          'mcp__bop-tools__get_sensor_data',
          'mcp__bop-tools__get_sensor_history',
          'mcp__bop-tools__get_bop_status',
          'mcp__bop-tools__send_alert',
          'mcp__bop-tools__log_recommendation',
        ],
        permissionMode: 'bypassPermissions',
        maxTurns: 250,
      },
    })) {
      if (message.type === 'assistant') {
        for (const block of message.message.content) {
          if ('text' in block && block.text) {
            console.log('[Agent]', block.text);
          }
        }
      }
    }
  }
}
