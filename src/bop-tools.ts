import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { SensorStateManager } from './sensor-state.js';
import { PIRestClient } from './pi-rest-client.js';
import { AlertManager } from './alert-manager.js';

/**
 * Creates the in-process MCP server with all BOP monitoring tools.
 *
 * The Agent SDK automatically:
 * - Exposes these tools to Claude during the query() loop
 * - Dispatches tool calls to the handler functions
 * - Feeds tool results back to Claude for reasoning
 * - Continues the loop until Claude finishes (stop_reason: end_turn)
 */
export function createBOPToolsServer(
  sensorState: SensorStateManager,
  piRest: PIRestClient,
  alertManager: AlertManager
) {
  // -- Tool: get_sensor_data --
  const getSensorData = tool(
    'get_sensor_data',
    'Get current real-time values for one or more BOP sensor tags. ' +
      'Returns latest value, timestamp, unit, and data quality for each tag. ' +
      'Use to check accumulator pressure, ram positions, flow rates, wellbore pressures, etc. ' +
      'Tags follow naming convention: BOP.ACC.PRESS.SYS, BOP.ANN01.POS, WELL.FLOW.DELTA',
    {
      tags: z
        .array(z.string())
        .describe('Array of PI tag names, e.g. ["BOP.ACC.PRESS.SYS", "BOP.ANN01.POS"]'),
    },
    async (args) => {
      const results: Record<string, unknown> = {};
      for (const tag of args.tags) {
        results[tag] = sensorState.getCurrentValue(tag);
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }],
      };
    }
  );

  // -- Tool: get_sensor_history --
  const getSensorHistory = tool(
    'get_sensor_history',
    'Retrieve historical recorded values for a BOP sensor tag over a time range. ' +
      'Use to analyze trends, detect gradual degradation, or compare against baselines. ' +
      'Time parameters use PI time syntax: "*" = now, "*-1h" = 1 hour ago, "*-7d" = 7 days ago.',
    {
      tag: z.string().describe('PI tag name, e.g. "BOP.ACC.PRESS.SYS"'),
      startTime: z.string().describe('Start time in PI syntax, e.g. "*-1h", "*-24h"'),
      endTime: z.string().optional().describe('End time. Defaults to "*" (now).'),
      maxCount: z.number().optional().describe('Max data points. Defaults to 100.'),
    },
    async (args) => {
      const webId = sensorState.getWebId(args.tag);
      if (!webId) {
        return {
          content: [{ type: 'text' as const, text: `Error: Unknown tag "${args.tag}"` }],
        };
      }
      try {
        const data = await piRest.getRecordedValues(
          webId,
          args.startTime,
          args.endTime || '*',
          args.maxCount || 100
        );
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
        };
      } catch (err: any) {
        return {
          content: [{ type: 'text' as const, text: `PI query error: ${err.message}` }],
        };
      }
    }
  );

  // -- Tool: get_bop_status --
  const getBopStatus = tool(
    'get_bop_status',
    'Get a comprehensive snapshot of the entire BOP system. ' +
      'Returns current values for ALL monitored parameters organized by subsystem: ' +
      'accumulator, annular, rams, choke/kill, wellbore, control system. ' +
      'Also includes any active alerts and recent test results.',
    {}, // No input parameters needed
    async () => {
      const snapshot = sensorState.getFullSnapshot();
      const activeAlerts = alertManager.getActiveAlerts();
      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                timestamp: new Date().toISOString(),
                sensors: snapshot,
                activeAlerts: activeAlerts.slice(-10),
              },
              null,
              2
            ),
          },
        ],
      };
    }
  );

  // -- Tool: send_alert --
  const sendAlert = tool(
    'send_alert',
    'Send an alert notification to drilling crew and operations center. ' +
      'CRITICAL: immediate-action (BOP cannot function, active well control event). ' +
      'WARNING: degraded condition requiring attention within 1-4 hours. ' +
      'INFO: trend observations and routine status. ' +
      'Every alert MUST include a clear description and specific recommended action.',
    {
      severity: z.enum(['CRITICAL', 'WARNING', 'INFO']).describe('Alert severity level'),
      title: z.string().max(100).describe('Short alert title'),
      description: z.string().describe('Detailed description of the condition detected'),
      affectedComponents: z
        .array(z.string())
        .optional()
        .describe('BOP components affected, e.g. ["Accumulator", "Annular Preventer #1"]'),
      recommendedAction: z
        .string()
        .describe('Specific recommended action for the drilling crew'),
    },
    async (args) => {
      const result = await alertManager.send({
        severity: args.severity,
        title: args.title,
        description: args.description,
        affectedComponents: args.affectedComponents,
        recommendedAction: args.recommendedAction,
        timestamp: new Date().toISOString(),
      });
      return {
        content: [{ type: 'text' as const, text: result }],
      };
    }
  );

  // -- Tool: log_recommendation --
  const logRecommendation = tool(
    'log_recommendation',
    'Log a maintenance or operational recommendation to the BOP record. ' +
      'Use for non-urgent observations: gradual seal wear, approaching test intervals, ' +
      'component aging patterns, condition-based maintenance suggestions.',
    {
      category: z
        .enum(['MAINTENANCE', 'TESTING', 'INSPECTION', 'OPERATIONAL', 'COMPLIANCE'])
        .describe('Recommendation category'),
      component: z.string().describe('BOP component this applies to'),
      recommendation: z.string().describe('Detailed recommendation text'),
      priority: z.enum(['HIGH', 'MEDIUM', 'LOW']).describe('Scheduling priority'),
      dueWithinDays: z
        .number()
        .optional()
        .describe('Recommended completion timeframe in days'),
    },
    async (args) => {
      const result = await alertManager.logRecommendation({
        category: args.category,
        component: args.component,
        recommendation: args.recommendation,
        priority: args.priority,
        dueWithinDays: args.dueWithinDays,
        timestamp: new Date().toISOString(),
      });
      return {
        content: [{ type: 'text' as const, text: result }],
      };
    }
  );

  // -- Bundle into MCP server --
  return createSdkMcpServer({
    name: 'bop-tools',
    version: '1.0.0',
    tools: [getSensorData, getSensorHistory, getBopStatus, sendAlert, logRecommendation],
  });
}
