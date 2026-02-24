import { TagRegistry, TagMeta } from './tag-registry.js';
import { ScenarioEngine } from './scenario-engine.js';

/**
 * Context passed to the spec builder so it can reflect live simulator state.
 * All fields are optional — if omitted, sensible defaults are used.
 */
export interface OpenApiContext {
  port: number;
  registry?: TagRegistry;
  scenarioEngine?: ScenarioEngine;
}

/**
 * Build an OpenAPI 3.0.3 specification for the PI Web API Simulator.
 *
 * When `registry` and `scenarioEngine` are provided the spec is populated
 * with live data (real WebIds, tag list, scenario catalogue) so it stays
 * in sync with the running server automatically.
 */
export function getOpenApiSpec(ctx: OpenApiContext): object {
  const { port, registry, scenarioEngine } = ctx;

  // ── Dynamic data from the running simulator ─────────────────────
  const allTags: TagMeta[] = registry?.getAllMeta() ?? [];
  const exampleTag = allTags[0];
  const exampleWebId = exampleTag?.webId ?? 'SIM_Qk9QLkFDQy5QUkVTUy5TWVM';
  const examplePath = exampleTag?.path ?? '\\\\SIMULATOR\\BOP.ACC.PRESS.SYS';
  const exampleTagName = exampleTag?.tagName ?? 'BOP.ACC.PRESS.SYS';

  const scenarios = scenarioEngine?.listScenarios() ?? [];
  const scenarioNames = scenarios.map((s) => s.name);
  const faultScenarioNames = scenarioNames.filter((n) => n !== 'normal');
  const exampleScenario = faultScenarioNames[0] ?? 'kick-detection';

  return {
    openapi: '3.0.3',
    info: {
      title: 'PI Web API Simulator',
      description:
        'A local simulator for the OSIsoft PI Web API, providing BOP sensor data for development and testing. ' +
        'Serves PI Web API-compatible REST endpoints, a WebSocket streaming channel, and admin control endpoints.\n\n' +
        `**Registered tags:** ${allTags.length || 25}\n\n` +
        `**Available scenarios:** ${scenarioNames.length > 0 ? scenarioNames.join(', ') : 'normal, accumulator-decay, kick-detection, ram-slowdown, pod-failure'}`,
      version: '1.0.0',
    },
    servers: [
      {
        url: `https://localhost:${port}`,
        description: 'Local simulator (self-signed TLS)',
      },
    ],
    paths: {
      '/openapi.json': {
        get: {
          tags: ['Meta'],
          summary: 'OpenAPI specification',
          description: 'Returns this OpenAPI 3.0.3 specification as JSON. The spec is generated dynamically and always reflects the current simulator state (registered tags, available scenarios).',
          operationId: 'getOpenApiSpec',
          responses: {
            '200': {
              description: 'OpenAPI specification document',
              content: {
                'application/json': {
                  schema: { type: 'object' },
                },
              },
            },
          },
        },
      },

      '/docs': {
        get: {
          tags: ['Meta'],
          summary: 'Interactive API explorer',
          description: 'Serves an interactive API documentation UI (Scalar API Reference) where you can browse endpoints and try out requests.',
          operationId: 'getApiExplorer',
          responses: {
            '200': {
              description: 'HTML page with the interactive API explorer',
              content: {
                'text/html': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },

      '/ws-test': {
        get: {
          tags: ['Meta'],
          summary: 'WebSocket stream test page',
          description:
            'Interactive browser-based UI for testing the WebSocket streaming channel. ' +
            'Select tags, connect to the `wss://` channel, and view live sensor values updating at 1 Hz. ' +
            'Includes a live-updating values table and a scrolling message log.',
          operationId: 'getWsTestPage',
          responses: {
            '200': {
              description: 'HTML page with the WebSocket test UI',
              content: {
                'text/html': {
                  schema: { type: 'string' },
                },
              },
            },
          },
        },
      },

      // ── PI Web API compatible endpoints ──────────────────────────

      '/piwebapi/points': {
        get: {
          tags: ['PI Web API'],
          summary: 'Resolve a PI Point by path',
          description:
            'Look up a PI Point (tag) by its full path. Returns the WebId, name, path, and engineering units. ' +
            'Compatible with the OSIsoft PI Web API GET /points endpoint.',
          operationId: 'getPoint',
          parameters: [
            {
              name: 'path',
              in: 'query',
              required: true,
              description:
                'Full PI Point path in the format `\\\\DataArchive\\TagName`.',
              schema: { type: 'string' },
              example: examplePath,
            },
          ],
          responses: {
            '200': {
              description: 'PI Point metadata',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PIPoint' },
                  example: exampleTag
                    ? {
                        WebId: exampleTag.webId,
                        Name: exampleTag.tagName,
                        Path: exampleTag.path,
                        Descriptor: `Simulated ${exampleTag.tagName}`,
                        PointType: 'Float32',
                        EngineeringUnits: exampleTag.unit,
                        Links: { Self: `https://localhost:${port}/piwebapi/points/${exampleTag.webId}` },
                      }
                    : undefined,
                },
              },
            },
            '400': {
              description: 'Missing required `path` parameter',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'PI Point not found for the given path',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      '/piwebapi/points/{webId}': {
        get: {
          tags: ['PI Web API'],
          summary: 'Get a PI Point by WebId',
          description:
            'Look up a PI Point (tag) directly by its WebId. Returns the same metadata as the path-based lookup. ' +
            'Compatible with the OSIsoft PI Web API GET /points/{webId} endpoint.',
          operationId: 'getPointById',
          parameters: [
            {
              name: 'webId',
              in: 'path',
              required: true,
              description: 'The WebId of the PI Point.',
              schema: { type: 'string' },
              example: exampleWebId,
            },
          ],
          responses: {
            '200': {
              description: 'PI Point metadata',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PIPoint' },
                },
              },
            },
            '404': {
              description: 'PI Point not found for the given WebId',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      '/piwebapi/streams/{webId}/value': {
        get: {
          tags: ['PI Web API'],
          summary: 'Get current value for a stream',
          description:
            'Returns the most recent value for the specified stream (tag). ' +
            'Compatible with the OSIsoft PI Web API GET /streams/{webId}/value endpoint.',
          operationId: 'getStreamValue',
          parameters: [
            {
              name: 'webId',
              in: 'path',
              required: true,
              description: 'The WebId of the stream (obtained from GET /piwebapi/points).',
              schema: { type: 'string' },
              example: exampleWebId,
            },
          ],
          responses: {
            '200': {
              description: 'Current stream value',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PIStreamValue' },
                },
              },
            },
            '404': {
              description: 'Stream not found for the given WebId',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      '/piwebapi/streams/{webId}/recorded': {
        get: {
          tags: ['PI Web API'],
          summary: 'Get recorded historical values',
          description:
            'Returns historical recorded values for a stream within a time range. ' +
            'Supports PI time syntax (e.g. `*-1h`, `*-30m`) and ISO 8601 timestamps. ' +
            'Compatible with the OSIsoft PI Web API GET /streams/{webId}/recorded endpoint.',
          operationId: 'getStreamRecorded',
          parameters: [
            {
              name: 'webId',
              in: 'path',
              required: true,
              description: 'The WebId of the stream.',
              schema: { type: 'string' },
              example: exampleWebId,
            },
            {
              name: 'startTime',
              in: 'query',
              required: false,
              description: 'Start time in PI time syntax or ISO 8601 (default: `*-1h`).',
              schema: { type: 'string', default: '*-1h' },
            },
            {
              name: 'endTime',
              in: 'query',
              required: false,
              description: 'End time in PI time syntax or ISO 8601 (default: `*`).',
              schema: { type: 'string', default: '*' },
            },
            {
              name: 'maxCount',
              in: 'query',
              required: false,
              description: 'Maximum number of values to return (default: 1000).',
              schema: { type: 'integer', default: 1000, minimum: 1 },
            },
          ],
          responses: {
            '200': {
              description: 'Recorded values',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TimedValuesResponse' },
                },
              },
            },
            '404': {
              description: 'Stream not found for the given WebId',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      '/piwebapi/streams/{webId}/end': {
        get: {
          tags: ['PI Web API'],
          summary: 'Get end-of-stream value',
          description:
            'Returns the end-of-stream value (latest recorded value) for the specified stream. ' +
            'In the simulator, this returns the same as `/value`. ' +
            'Compatible with the OSIsoft PI Web API GET /streams/{webId}/end endpoint.',
          operationId: 'getStreamEnd',
          parameters: [
            {
              name: 'webId',
              in: 'path',
              required: true,
              description: 'The WebId of the stream.',
              schema: { type: 'string' },
              example: exampleWebId,
            },
          ],
          responses: {
            '200': {
              description: 'End-of-stream value',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/PIStreamValue' },
                },
              },
            },
            '404': {
              description: 'Stream not found for the given WebId',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      '/piwebapi/streams/{webId}/interpolated': {
        get: {
          tags: ['PI Web API'],
          summary: 'Get interpolated values',
          description:
            'Returns interpolated values over a time range at a specified interval. ' +
            'Uses linear interpolation between recorded values. ' +
            'Compatible with the OSIsoft PI Web API GET /streams/{webId}/interpolated endpoint.',
          operationId: 'getStreamInterpolated',
          parameters: [
            {
              name: 'webId',
              in: 'path',
              required: true,
              description: 'The WebId of the stream.',
              schema: { type: 'string' },
              example: exampleWebId,
            },
            {
              name: 'startTime',
              in: 'query',
              required: false,
              description: 'Start time in PI time syntax or ISO 8601 (default: `*-1d`).',
              schema: { type: 'string', default: '*-1d' },
            },
            {
              name: 'endTime',
              in: 'query',
              required: false,
              description: 'End time in PI time syntax or ISO 8601 (default: `*`).',
              schema: { type: 'string', default: '*' },
            },
            {
              name: 'interval',
              in: 'query',
              required: false,
              description: 'Interpolation interval in PI time syntax (default: `1h`). Examples: `5m`, `30s`, `1h`.',
              schema: { type: 'string', default: '1h' },
            },
          ],
          responses: {
            '200': {
              description: 'Interpolated values',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TimedValuesResponse' },
                },
              },
            },
            '404': {
              description: 'Stream not found for the given WebId',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      '/piwebapi/streams/{webId}/plot': {
        get: {
          tags: ['PI Web API'],
          summary: 'Get plot values',
          description:
            'Returns values suitable for plotting — significant values (first, last, min, max) per sub-interval. ' +
            'Compatible with the OSIsoft PI Web API GET /streams/{webId}/plot endpoint.',
          operationId: 'getStreamPlot',
          parameters: [
            {
              name: 'webId',
              in: 'path',
              required: true,
              description: 'The WebId of the stream.',
              schema: { type: 'string' },
              example: exampleWebId,
            },
            {
              name: 'startTime',
              in: 'query',
              required: false,
              description: 'Start time in PI time syntax or ISO 8601 (default: `*-1d`).',
              schema: { type: 'string', default: '*-1d' },
            },
            {
              name: 'endTime',
              in: 'query',
              required: false,
              description: 'End time in PI time syntax or ISO 8601 (default: `*`).',
              schema: { type: 'string', default: '*' },
            },
            {
              name: 'intervals',
              in: 'query',
              required: false,
              description: 'Number of plot intervals (default: 24).',
              schema: { type: 'integer', default: 24, minimum: 1 },
            },
          ],
          responses: {
            '200': {
              description: 'Plot values',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/TimedValuesResponse' },
                },
              },
            },
            '404': {
              description: 'Stream not found for the given WebId',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      '/piwebapi/streamsets/value': {
        get: {
          tags: ['PI Web API'],
          summary: 'Get current values for multiple streams',
          description:
            'Returns the current value for each of the specified streams. ' +
            'Pass multiple `webId` query parameters to subscribe to multiple tags. ' +
            'Compatible with the OSIsoft PI Web API GET /streamsets/value endpoint.',
          operationId: 'getStreamSetsValue',
          parameters: [
            {
              name: 'webId',
              in: 'query',
              required: true,
              description: 'One or more WebIds. Repeat the parameter for multiple tags.',
              schema: { type: 'array', items: { type: 'string' } },
              style: 'form',
              explode: true,
              example: exampleWebId,
            },
          ],
          responses: {
            '200': {
              description: 'Current values for multiple streams',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StreamSetResponse' },
                },
              },
            },
            '400': {
              description: 'Missing required `webId` parameter',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      '/piwebapi/streamsets/recorded': {
        get: {
          tags: ['PI Web API'],
          summary: 'Get recorded values for multiple streams',
          description:
            'Returns historical recorded values for each of the specified streams within a time range. ' +
            'Pass multiple `webId` query parameters. ' +
            'Compatible with the OSIsoft PI Web API GET /streamsets/recorded endpoint.',
          operationId: 'getStreamSetsRecorded',
          parameters: [
            {
              name: 'webId',
              in: 'query',
              required: true,
              description: 'One or more WebIds. Repeat the parameter for multiple tags.',
              schema: { type: 'array', items: { type: 'string' } },
              style: 'form',
              explode: true,
              example: exampleWebId,
            },
            {
              name: 'startTime',
              in: 'query',
              required: false,
              description: 'Start time in PI time syntax or ISO 8601 (default: `*-1h`).',
              schema: { type: 'string', default: '*-1h' },
            },
            {
              name: 'endTime',
              in: 'query',
              required: false,
              description: 'End time in PI time syntax or ISO 8601 (default: `*`).',
              schema: { type: 'string', default: '*' },
            },
            {
              name: 'maxCount',
              in: 'query',
              required: false,
              description: 'Maximum number of values to return per stream (default: 1000).',
              schema: { type: 'integer', default: 1000, minimum: 1 },
            },
          ],
          responses: {
            '200': {
              description: 'Recorded values for multiple streams',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/StreamSetResponse' },
                },
              },
            },
            '400': {
              description: 'Missing required `webId` parameter',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
          },
        },
      },

      // ── WebSocket endpoint (documented for reference) ────────────

      '/piwebapi/streamsets/channel': {
        get: {
          tags: ['PI Web API'],
          summary: 'WebSocket streaming channel (ad-hoc)',
          description:
            'Upgrade to a WebSocket connection to receive real-time sensor data at 1 Hz. ' +
            'Subscribe to specific tags by passing one or more `webId` query parameters. ' +
            'This endpoint requires a WebSocket upgrade (`Connection: Upgrade`) — it cannot be called as a regular HTTP request.\n\n' +
            '**Protocol:** `wss://`\n\n' +
            '**Message format:** Each message is a JSON object with an `Items` array, where each item contains ' +
            '`WebId`, `Name`, `Path`, `UnitsAbbreviation`, `Links`, and an `Items` array with the latest `PIStreamValue`. ' +
            'A top-level `Links` object is also included.\n\n' +
            `**Interactive test page:** [Open WebSocket Test UI](https://localhost:${port}/ws-test) to connect and view live streaming data in your browser.`,
          operationId: 'streamChannel',
          parameters: [
            {
              name: 'webId',
              in: 'query',
              required: true,
              description: 'One or more WebIds to subscribe to. Repeat the parameter for multiple tags.',
              schema: { type: 'array', items: { type: 'string' } },
              style: 'form',
              explode: true,
              example: exampleWebId,
            },
            {
              name: 'includeInitialValues',
              in: 'query',
              required: false,
              description: 'Whether to send a snapshot of current values immediately on connection (default: true).',
              schema: { type: 'boolean', default: true },
            },
            {
              name: 'heartbeatRate',
              in: 'query',
              required: false,
              description: 'Interval in seconds between WebSocket ping frames (default: 5).',
              schema: { type: 'integer', default: 5, minimum: 1 },
            },
          ],
          responses: {
            '101': {
              description: 'Switching Protocols — WebSocket connection established',
            },
          },
        },
      },

      '/piwebapi/streamsets/{webId}/channel': {
        get: {
          tags: ['PI Web API'],
          summary: 'WebSocket streaming channel (path-based)',
          description:
            'Upgrade to a WebSocket connection to receive real-time sensor data at 1 Hz for a specific element. ' +
            'If the `{webId}` matches a known stream, only that stream is subscribed. ' +
            'Otherwise, all tags are subscribed (element-level behavior). ' +
            'This endpoint requires a WebSocket upgrade (`Connection: Upgrade`).\n\n' +
            '**Protocol:** `wss://`\n\n' +
            '**Message format:** Same as the ad-hoc `/streamsets/channel` endpoint.\n\n' +
            `**Interactive test page:** [Open WebSocket Test UI](https://localhost:${port}/ws-test) to connect and view live streaming data in your browser.`,
          operationId: 'streamChannelByWebId',
          parameters: [
            {
              name: 'webId',
              in: 'path',
              required: true,
              description: 'The WebId of the element or stream to subscribe to.',
              schema: { type: 'string' },
              example: exampleWebId,
            },
            {
              name: 'includeInitialValues',
              in: 'query',
              required: false,
              description: 'Whether to send a snapshot of current values immediately on connection (default: true).',
              schema: { type: 'boolean', default: true },
            },
            {
              name: 'heartbeatRate',
              in: 'query',
              required: false,
              description: 'Interval in seconds between WebSocket ping frames (default: 5).',
              schema: { type: 'integer', default: 5, minimum: 1 },
            },
          ],
          responses: {
            '101': {
              description: 'Switching Protocols — WebSocket connection established',
            },
          },
        },
      },

      // ── Admin endpoints ──────────────────────────────────────────

      '/admin/status': {
        get: {
          tags: ['Admin'],
          summary: 'Get simulator status',
          description: 'Returns the current simulator status including uptime, tag count, active WebSocket clients, and scenario state.',
          operationId: 'getAdminStatus',
          responses: {
            '200': {
              description: 'Simulator status',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/AdminStatus' },
                },
              },
            },
          },
        },
      },

      '/admin/scenarios': {
        get: {
          tags: ['Admin'],
          summary: 'List available scenarios',
          description: 'Returns all registered fault scenarios with their names, descriptions, and durations.',
          operationId: 'listScenarios',
          responses: {
            '200': {
              description: 'Available scenarios',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      scenarios: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/ScenarioInfo' },
                      },
                    },
                  },
                  ...(scenarios.length > 0
                    ? { example: { scenarios } }
                    : {}),
                },
              },
            },
          },
        },
      },

      '/admin/scenario': {
        post: {
          tags: ['Admin'],
          summary: 'Activate a scenario',
          description:
            'Activate a fault scenario by name. Deactivates any currently active scenario first. ' +
            'Use GET /admin/scenarios to list available scenario names.',
          operationId: 'activateScenario',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['name'],
                  properties: {
                    name: {
                      type: 'string',
                      description: 'The scenario name to activate.',
                      ...(faultScenarioNames.length > 0
                        ? { enum: scenarioNames }
                        : {}),
                      example: exampleScenario,
                    },
                  },
                },
              },
            },
          },
          responses: {
            '200': {
              description: 'Scenario activated',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      scenario: { type: 'string', example: exampleScenario },
                    },
                  },
                },
              },
            },
            '400': {
              description: 'Invalid JSON body or missing `name` field',
              content: {
                'application/json': {
                  schema: { $ref: '#/components/schemas/ErrorResponse' },
                },
              },
            },
            '404': {
              description: 'Unknown scenario name',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      error: { type: 'string' },
                      available: {
                        type: 'array',
                        items: { type: 'string' },
                        ...(scenarioNames.length > 0
                          ? { example: scenarioNames }
                          : {}),
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },

      '/admin/scenario/stop': {
        post: {
          tags: ['Admin'],
          summary: 'Stop the active scenario',
          description: 'Deactivates the currently running scenario and returns to normal steady-state operation.',
          operationId: 'stopScenario',
          responses: {
            '200': {
              description: 'Scenario stopped',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      status: { type: 'string', example: 'ok' },
                      scenario: { type: 'string', example: 'normal' },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },

    components: {
      schemas: {
        PIPoint: {
          type: 'object',
          properties: {
            WebId: { type: 'string', description: 'Unique identifier for the PI Point.', example: exampleWebId },
            Name: { type: 'string', description: 'Tag name.', example: exampleTagName },
            Path: { type: 'string', description: 'Full path.', example: examplePath },
            Descriptor: { type: 'string', description: 'Human-readable description.' },
            PointType: { type: 'string', example: 'Float32' },
            EngineeringUnits: { type: 'string', description: 'Unit of measurement (e.g. PSI, GPM, V).', example: exampleTag?.unit ?? 'PSI' },
            Links: { $ref: '#/components/schemas/SelfLinks' },
          },
        },

        PIStreamValue: {
          type: 'object',
          properties: {
            Timestamp: { type: 'string', format: 'date-time', description: 'ISO 8601 timestamp of the reading.' },
            Value: { type: 'number', description: 'Sensor value.', example: 3000.15 },
            UnitsAbbreviation: { type: 'string', description: 'Unit of measurement.' },
            Good: { type: 'boolean', description: 'Whether the value is good quality.', example: true },
            Questionable: { type: 'boolean', example: false },
            Substituted: { type: 'boolean', example: false },
            Annotated: { type: 'boolean', example: false },
            Links: { $ref: '#/components/schemas/SelfLinks', description: 'Present on value/end/recorded/interpolated/plot responses.' },
          },
        },

        SelfLinks: {
          type: 'object',
          description: 'Standard PI Web API Links object with a Self URL.',
          properties: {
            Self: { type: 'string', format: 'uri', description: 'URL of this resource.' },
          },
        },

        TimedValuesResponse: {
          type: 'object',
          description: 'A collection of timed values with self-link.',
          properties: {
            Items: {
              type: 'array',
              items: { $ref: '#/components/schemas/PIStreamValue' },
            },
            Links: { $ref: '#/components/schemas/SelfLinks' },
          },
        },

        StreamSetItem: {
          type: 'object',
          description: 'A single stream within a streamset response.',
          properties: {
            WebId: { type: 'string', description: 'WebId of the stream.' },
            Name: { type: 'string', description: 'Tag name.' },
            Path: { type: 'string', description: 'Full path.' },
            Items: {
              type: 'array',
              items: { $ref: '#/components/schemas/PIStreamValue' },
            },
            UnitsAbbreviation: { type: 'string', description: 'Unit of measurement.' },
            Links: { $ref: '#/components/schemas/SelfLinks' },
          },
        },

        StreamSetResponse: {
          type: 'object',
          description: 'A collection of streams, each with their own values.',
          properties: {
            Items: {
              type: 'array',
              items: { $ref: '#/components/schemas/StreamSetItem' },
            },
            Links: { type: 'object', description: 'Top-level links (empty object for streamsets).' },
          },
        },

        AdminStatus: {
          type: 'object',
          properties: {
            status: { type: 'string', example: 'running' },
            uptime: { type: 'integer', description: 'Uptime in seconds.', example: 120 },
            tags: { type: 'integer', description: 'Number of registered tags.', example: allTags.length || 25 },
            wsClients: { type: 'integer', description: 'Number of active WebSocket clients.', example: 0 },
            activeScenario: { type: 'string', description: 'Name of the active scenario, or `normal`.', example: 'normal' },
            mode: { type: 'string', enum: ['auto', 'manual'], description: 'Scenario engine mode.' },
          },
        },

        ScenarioInfo: {
          type: 'object',
          properties: {
            name: { type: 'string', description: 'Scenario identifier.', example: exampleScenario },
            description: { type: 'string', description: 'Human-readable description.' },
            durationMs: { type: 'integer', description: 'Scenario duration in milliseconds (0 = indefinite).', example: 300000 },
          },
        },

        ErrorResponse: {
          type: 'object',
          properties: {
            Message: { type: 'string', description: 'Error message.' },
            Errors: {
              type: 'array',
              items: { type: 'string' },
              description: 'Detailed error messages (optional).',
            },
          },
        },

        // ── Tag reference (auto-generated from registry) ──────────
        ...(allTags.length > 0
          ? {
              TagReference: {
                type: 'object',
                description:
                  'Reference of all registered PI tags. Each property key is a tag name, and its value is the corresponding WebId. ' +
                  'Use WebIds with the `/piwebapi/streams/{webId}/value`, `/piwebapi/streams/{webId}/recorded`, `/piwebapi/streams/{webId}/end`, `/piwebapi/streams/{webId}/interpolated`, and `/piwebapi/streams/{webId}/plot` endpoints.',
                properties: Object.fromEntries(
                  allTags.map((t) => [
                    t.tagName,
                    {
                      type: 'string',
                      description: `Unit: ${t.unit || 'dimensionless'} | Path: ${t.path}`,
                      example: t.webId,
                    },
                  ])
                ),
              },
            }
          : {}),
      },
    },

    tags: [
      { name: 'PI Web API', description: 'OSIsoft PI Web API-compatible endpoints for sensor data access.' },
      { name: 'Admin', description: 'Simulator administration and scenario control.' },
      { name: 'Meta', description: 'API metadata and documentation.' },
    ],
  };
}

/**
 * Returns an HTML page for interactive WebSocket streaming testing.
 *
 * Users can select tags, connect to the WSS channel, and see live
 * sensor values updating in real-time at 1 Hz.
 */
export interface AFElementInfo {
  webId: string;
  name: string;
  path: string;
  children: AFElementInfo[];
}

export function getWsTestHtml(port: number, tags: TagMeta[], elements: AFElementInfo[] = []): string {
  const tagGroups: Record<string, TagMeta[]> = {};
  for (const t of tags) {
    const prefix = t.tagName.split('.').slice(0, 2).join('.');
    const group = ({
      'BOP.ACC': 'Accumulator',
      'BOP.ANN01': 'Annular Preventer',
      'BOP.RAM': 'Ram Preventers',
      'BOP.MAN': 'Manifold & Lines',
      'BOP.CHOKE': 'Manifold & Lines',
      'BOP.KILL': 'Manifold & Lines',
      'BOP.CTRL': 'Control System',
      'WELL.PRESS': 'Wellbore',
      'WELL.FLOW': 'Wellbore',
      'WELL.PIT': 'Wellbore',
    } as Record<string, string>)[prefix] ?? 'Other';
    (tagGroups[group] ??= []).push(t);
  }

  const tagsJson = JSON.stringify(tags.map(t => ({
    tagName: t.tagName,
    webId: t.webId,
    unit: t.unit,
  })));

  const elementsJson = JSON.stringify(elements);

  const groupCheckboxes = Object.entries(tagGroups).map(([group, groupTags]) => {
    const checkboxes = groupTags.map(t =>
      `<label class="tag-label"><input type="checkbox" value="${t.webId}" data-tag="${t.tagName}" data-unit="${t.unit}" checked />${t.tagName}${t.unit ? ' <span class="unit">(' + t.unit + ')</span>' : ''}</label>`
    ).join('\n            ');
    return `
          <div class="tag-group">
            <div class="group-header">
              <label><input type="checkbox" class="group-toggle" checked />${group}</label>
            </div>
            ${checkboxes}
          </div>`;
  }).join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PI Web API Simulator — WebSocket Test</title>
  <style>
    :root {
      --bg: #0d1117; --surface: #161b22; --border: #30363d;
      --text: #e6edf3; --text-dim: #8b949e; --accent: #58a6ff;
      --green: #3fb950; --red: #f85149; --yellow: #d29922;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg); color: var(--text); line-height: 1.5; }
    header { background: var(--surface); border-bottom: 1px solid var(--border);
      padding: 12px 24px; display: flex; align-items: center; gap: 16px; }
    header h1 { font-size: 18px; font-weight: 600; }
    header nav { display: flex; gap: 12px; margin-left: auto; }
    header nav a { color: var(--accent); text-decoration: none; font-size: 14px; }
    header nav a:hover { text-decoration: underline; }
    .container { display: grid; grid-template-columns: 280px 1fr; height: calc(100vh - 53px); }
    .sidebar { background: var(--surface); border-right: 1px solid var(--border);
      padding: 16px; overflow-y: auto; }
    .main { display: flex; flex-direction: column; overflow: hidden; }
    .controls { padding: 12px 16px; display: flex; gap: 12px; align-items: center;
      border-bottom: 1px solid var(--border); background: var(--surface); }
    .btn { padding: 6px 16px; border: 1px solid var(--border); border-radius: 6px;
      font-size: 13px; cursor: pointer; font-weight: 500; }
    .btn-connect { background: #238636; border-color: #2ea043; color: #fff; }
    .btn-connect:hover { background: #2ea043; }
    .btn-disconnect { background: #da3633; border-color: #f85149; color: #fff; }
    .btn-disconnect:hover { background: #f85149; }
    .btn-clear { background: var(--surface); color: var(--text-dim); }
    .btn-clear:hover { color: var(--text); }
    .status { font-size: 13px; color: var(--text-dim); display: flex; align-items: center; gap: 6px; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--text-dim); }
    .status-dot.connected { background: var(--green); }
    .status-dot.error { background: var(--red); }
    .tag-group { margin-bottom: 12px; }
    .group-header { font-size: 12px; font-weight: 600; text-transform: uppercase;
      color: var(--text-dim); margin-bottom: 4px; letter-spacing: 0.5px; }
    .group-header label { cursor: pointer; display: flex; align-items: center; gap: 6px; }
    .tag-label { display: block; font-size: 13px; padding: 2px 0 2px 18px;
      cursor: pointer; color: var(--text); }
    .tag-label input { margin-right: 6px; }
    .unit { color: var(--text-dim); font-size: 12px; }
    .mode-toggle { margin-bottom: 12px; display: flex; border: 1px solid var(--border);
      border-radius: 6px; overflow: hidden; }
    .mode-toggle button { flex: 1; padding: 6px 8px; font-size: 12px; background: var(--surface);
      color: var(--text-dim); border: none; cursor: pointer; font-weight: 500; }
    .mode-toggle button.active { background: var(--accent); color: #fff; }
    .element-tree { margin-bottom: 8px; }
    .tree-item { display: flex; align-items: center; padding: 3px 0; cursor: pointer;
      font-size: 13px; border-radius: 4px; color: var(--text); }
    .tree-item:hover { background: rgba(88,166,255,0.08); }
    .tree-item.selected { background: rgba(88,166,255,0.18); color: var(--accent); }
    .tree-toggle { width: 16px; text-align: center; font-size: 10px; color: var(--text-dim);
      flex-shrink: 0; cursor: pointer; user-select: none; }
    .tree-label { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .element-path-hint { font-size: 11px; color: var(--text-dim); margin-top: 4px;
      padding: 0 4px; word-break: break-all; min-height: 16px; }
    .select-actions { margin-bottom: 12px; display: flex; gap: 8px; }
    .select-actions button { background: none; border: none; color: var(--accent);
      font-size: 12px; cursor: pointer; padding: 0; }
    .select-actions button:hover { text-decoration: underline; }
    .content { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
    .tabs { display: flex; border-bottom: 1px solid var(--border); background: var(--surface); }
    .tab { padding: 8px 16px; font-size: 13px; cursor: pointer; color: var(--text-dim);
      border-bottom: 2px solid transparent; }
    .tab.active { color: var(--text); border-bottom-color: var(--accent); }
    .tab-panel { flex: 1; overflow: hidden; display: none; }
    .tab-panel.active { display: flex; flex-direction: column; }
    /* Live values table */
    .values-table { width: 100%; border-collapse: collapse; font-size: 13px; }
    .values-table th { text-align: left; padding: 8px 12px; color: var(--text-dim);
      font-weight: 500; border-bottom: 1px solid var(--border); position: sticky; top: 0;
      background: var(--bg); }
    .values-table td { padding: 6px 12px; border-bottom: 1px solid var(--border);
      font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace; font-size: 13px; }
    .values-table tr.flash { animation: flash 0.4s ease-out; }
    @keyframes flash { 0% { background: rgba(88,166,255,0.15); } 100% { background: transparent; } }
    .table-wrap { flex: 1; overflow-y: auto; }
    /* Message log */
    .log { flex: 1; overflow-y: auto; padding: 8px 12px;
      font-family: 'SF Mono', SFMono-Regular, Consolas, 'Liberation Mono', Menlo, monospace;
      font-size: 12px; line-height: 1.6; }
    .log-entry { border-bottom: 1px solid var(--border); padding: 4px 0; }
    .log-ts { color: var(--text-dim); margin-right: 8px; }
    .log-tag { color: var(--accent); }
    .log-val { color: var(--green); }
    .log-sys { color: var(--yellow); font-style: italic; }
    .msg-count { font-size: 12px; color: var(--text-dim); padding: 4px 12px;
      border-top: 1px solid var(--border); background: var(--surface); }
  </style>
</head>
<body>
  <header>
    <h1>WebSocket Stream Test</h1>
    <nav>
      <a href="/docs">API Explorer</a>
      <a href="/admin/status">Status</a>
    </nav>
  </header>
  <div class="container">
    <div class="sidebar">
      <div class="mode-toggle">
        <button id="modeTagBtn" class="active" onclick="setMode('tags')">Tags</button>
        <button id="modeElementBtn" onclick="setMode('element')">Element Path</button>
      </div>
      <div id="tagMode">
        <div class="select-actions">
          <button onclick="toggleAll(true)">Select All</button>
          <button onclick="toggleAll(false)">Deselect All</button>
        </div>
${groupCheckboxes}
      </div>
      <div id="elementMode" style="display:none;">
        <label style="font-size:12px;font-weight:600;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.5px;display:block;margin-bottom:6px;">AF Hierarchy</label>
        <div id="elementTree" class="element-tree"></div>
        <div id="elementPath" class="element-path-hint"></div>
        <div style="font-size:12px;color:var(--text-dim);margin-top:8px;">
          Connects via <code style="color:var(--accent);font-size:11px;">/streamsets/{webId}/channel</code> — subscribes to all tags under the selected element.
        </div>
      </div>
    </div>
    <div class="main">
      <div class="controls">
        <button id="connectBtn" class="btn btn-connect" onclick="toggleConnection()">Connect</button>
        <button class="btn btn-clear" onclick="clearLog()">Clear Log</button>
        <div class="status">
          <span id="statusDot" class="status-dot"></span>
          <span id="statusText">Disconnected</span>
        </div>
        <div class="status" style="margin-left: auto;">
          <span id="msgRate">0 msg/s</span>
        </div>
      </div>
      <div class="content">
        <div class="tabs">
          <div class="tab active" onclick="switchTab('values')">Live Values</div>
          <div class="tab" onclick="switchTab('log')">Message Log</div>
        </div>
        <div id="tab-values" class="tab-panel active">
          <div class="table-wrap">
            <table class="values-table">
              <thead><tr><th>Name</th><th>Value</th><th>Unit</th><th>Timestamp</th><th>Quality</th></tr></thead>
              <tbody id="valuesBody"></tbody>
            </table>
          </div>
        </div>
        <div id="tab-log" class="tab-panel">
          <div id="logPane" class="log"></div>
          <div id="msgCount" class="msg-count">0 messages</div>
        </div>
      </div>
    </div>
  </div>
<script>
const PORT = ${port};
const TAGS = ${tagsJson};
const ELEMENTS = ${elementsJson};
let ws = null;
let msgTotal = 0;
let msgWindow = [];
let connectionMode = 'tags'; // 'tags' or 'element'

let selectedElementWebId = '';
let selectedElementName = '';

// Render AF hierarchy tree
(function() {
  function renderTree(elements, container, depth) {
    for (const el of elements) {
      const hasChildren = el.children && el.children.length > 0;
      const row = document.createElement('div');
      row.className = 'tree-item';
      row.style.paddingLeft = (depth * 16 + 4) + 'px';
      row.dataset.webId = el.webId;
      row.dataset.path = el.path;

      const toggle = document.createElement('span');
      toggle.className = 'tree-toggle';
      toggle.textContent = hasChildren ? '\\u25BE' : '';
      row.appendChild(toggle);

      const label = document.createElement('span');
      label.className = 'tree-label';
      label.textContent = el.name;
      row.appendChild(label);

      container.appendChild(row);

      let childContainer = null;
      if (hasChildren) {
        childContainer = document.createElement('div');
        childContainer.className = 'tree-children';
        container.appendChild(childContainer);
        renderTree(el.children, childContainer, depth + 1);
      }

      row.addEventListener('click', () => selectElement(el.webId, el.name, el.path));
      if (hasChildren) {
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const collapsed = childContainer.style.display === 'none';
          childContainer.style.display = collapsed ? '' : 'none';
          toggle.textContent = collapsed ? '\\u25BE' : '\\u25B8';
        });
      }
    }
  }
  renderTree(ELEMENTS, document.getElementById('elementTree'), 0);
})();

function selectElement(webId, name, path) {
  if (webId === selectedElementWebId) return;
  // Highlight selected item
  document.querySelectorAll('#elementTree .tree-item').forEach(el => el.classList.remove('selected'));
  const item = document.querySelector('#elementTree .tree-item[data-web-id="' + webId + '"]');
  if (item) item.classList.add('selected');
  selectedElementWebId = webId;
  selectedElementName = name;
  document.getElementById('elementPath').textContent = path;
  // Clear live values
  clearValues();
  // Auto-reconnect if currently connected
  if (ws && ws.readyState <= 1) {
    disconnect();
    setTimeout(connect, 100);
  }
}

function clearValues() {
  valueRows.clear();
  document.getElementById('valuesBody').innerHTML = '';
}

function setMode(mode) {
  connectionMode = mode;
  document.getElementById('modeTagBtn').className = mode === 'tags' ? 'active' : '';
  document.getElementById('modeElementBtn').className = mode === 'element' ? 'active' : '';
  document.getElementById('tagMode').style.display = mode === 'tags' ? '' : 'none';
  document.getElementById('elementMode').style.display = mode === 'element' ? '' : 'none';
}

// Group toggles
document.querySelectorAll('.group-toggle').forEach(toggle => {
  toggle.addEventListener('change', e => {
    const group = e.target.closest('.tag-group');
    group.querySelectorAll('.tag-label input').forEach(cb => { cb.checked = e.target.checked; });
  });
});

function toggleAll(state) {
  document.querySelectorAll('.sidebar input[type=checkbox]').forEach(cb => { cb.checked = state; });
}

function getSelectedWebIds() {
  return [...document.querySelectorAll('.tag-label input:checked')].map(cb => cb.value);
}

function setStatus(state, text) {
  const dot = document.getElementById('statusDot');
  const txt = document.getElementById('statusText');
  dot.className = 'status-dot' + (state ? ' ' + state : '');
  txt.textContent = text;
}

function toggleConnection() {
  if (ws && ws.readyState <= 1) { disconnect(); return; }
  connect();
}

function connect() {
  let url;
  let label;

  if (connectionMode === 'element') {
    if (!selectedElementWebId) { alert('Select an AF element.'); return; }
    url = 'wss://localhost:' + PORT + '/piwebapi/streamsets/' + encodeURIComponent(selectedElementWebId) + '/channel?includeInitialValues=true';
    label = 'element: ' + selectedElementName;
  } else {
    const webIds = getSelectedWebIds();
    if (webIds.length === 0) { alert('Select at least one tag.'); return; }
    const params = webIds.map(id => 'webId=' + encodeURIComponent(id)).join('&');
    url = 'wss://localhost:' + PORT + '/piwebapi/streamsets/channel?' + params + '&includeInitialValues=true';
    label = webIds.length + ' tags';
  }

  setStatus('', 'Connecting...');
  ws = new WebSocket(url);

  ws.onopen = () => {
    setStatus('connected', 'Connected (' + label + ')');
    addLogSys('Connected to ' + url);
    document.getElementById('connectBtn').textContent = 'Disconnect';
    document.getElementById('connectBtn').className = 'btn btn-disconnect';
  };

  ws.onmessage = (evt) => {
    const now = Date.now();
    msgTotal++;
    msgWindow.push(now);
    try {
      const msg = JSON.parse(evt.data);
      if (msg.Items) {
        for (const stream of msg.Items) {
          const tagName = stream.Name;
          const attrName = stream.AttributeName || null;
          const sv = stream.Items && stream.Items[0];
          if (!sv) continue;
          updateValue(tagName, sv, stream.WebId, attrName);
          addLogValue(tagName, sv, attrName);
        }
      }
    } catch (e) {
      addLogSys('Parse error: ' + e.message);
    }
    document.getElementById('msgCount').textContent = msgTotal + ' messages';
  };

  ws.onclose = (e) => {
    setStatus('', 'Disconnected (code ' + e.code + ')');
    addLogSys('Connection closed: code=' + e.code + ' reason=' + (e.reason || 'none'));
    document.getElementById('connectBtn').textContent = 'Connect';
    document.getElementById('connectBtn').className = 'btn btn-connect';
    ws = null;
  };

  ws.onerror = () => {
    setStatus('error', 'Connection error');
    addLogSys('WebSocket error');
  };
}

function disconnect() {
  if (ws) ws.close();
}

// Live values table
const valueRows = new Map();
function updateValue(tagName, sv, webId, attrName) {
  let row = valueRows.get(tagName);
  if (!row) {
    const tbody = document.getElementById('valuesBody');
    row = document.createElement('tr');
    const nameHtml = attrName
      ? attrName + '<br><span style="font-size:11px;color:var(--text-dim)">' + tagName + '</span>'
      : tagName;
    row.innerHTML = '<td class="name-cell">' + nameHtml + '</td><td class="val"></td><td class="unit-cell"></td><td class="ts"></td><td class="q"></td>';
    const meta = TAGS.find(t => t.tagName === tagName);
    row.querySelector('.unit-cell').textContent = meta ? meta.unit : '';
    tbody.appendChild(row);
    valueRows.set(tagName, row);
  }
  const val = typeof sv.Value === 'number' ? sv.Value.toFixed(2) : String(sv.Value);
  row.querySelector('.val').textContent = val;
  row.querySelector('.ts').textContent = new Date(sv.Timestamp).toLocaleTimeString();
  row.querySelector('.q').textContent = sv.Good ? 'Good' : 'Bad';
  row.querySelector('.q').style.color = sv.Good ? 'var(--green)' : 'var(--red)';
  row.classList.remove('flash');
  void row.offsetWidth; // trigger reflow
  row.classList.add('flash');
}

// Message log
const logPane = document.getElementById('logPane');
const MAX_LOG = 500;
let logCount = 0;
function addLogValue(tagName, sv, attrName) {
  const val = typeof sv.Value === 'number' ? sv.Value.toFixed(2) : String(sv.Value);
  const ts = new Date(sv.Timestamp).toLocaleTimeString();
  const label = attrName ? attrName + ' <span style="color:var(--text-dim)">(' + tagName + ')</span>' : tagName;
  appendLog('<span class="log-ts">' + ts + '</span><span class="log-tag">' + label + '</span> = <span class="log-val">' + val + '</span>');
}
function addLogSys(text) {
  const ts = new Date().toLocaleTimeString();
  appendLog('<span class="log-ts">' + ts + '</span><span class="log-sys">' + text + '</span>');
}
function appendLog(html) {
  const el = document.createElement('div');
  el.className = 'log-entry';
  el.innerHTML = html;
  logPane.appendChild(el);
  logCount++;
  while (logCount > MAX_LOG) { logPane.removeChild(logPane.firstChild); logCount--; }
  logPane.scrollTop = logPane.scrollHeight;
}
function clearLog() {
  logPane.innerHTML = '';
  logCount = 0;
  msgTotal = 0;
  document.getElementById('msgCount').textContent = '0 messages';
}

// Tabs
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelector('.tab-panel#tab-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => {
    if (t.textContent.toLowerCase().includes(name === 'values' ? 'live' : 'log')) t.classList.add('active');
  });
}

// Message rate counter
setInterval(() => {
  const now = Date.now();
  msgWindow = msgWindow.filter(t => now - t < 1000);
  document.getElementById('msgRate').textContent = msgWindow.length + ' msg/s';
}, 500);
</script>
</body>
</html>`;
}

/**
 * Returns an HTML page that embeds the Scalar API Reference explorer.
 *
 * Scalar is loaded from the jsDelivr CDN — no npm dependencies needed.
 * It provides an interactive "try it out" client with dark mode, code
 * generation in 25+ languages, and environment variable support.
 */
export function getExplorerHtml(port: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>PI Web API Simulator — API Explorer</title>
  <style>
    body { margin: 0; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  <script>
    Scalar.createApiReference('#app', {
      url: 'https://localhost:${port}/openapi.json',
      proxyUrl: '',
      theme: 'kepler',
      darkMode: true,
      hideDownloadButton: false,
      metaData: {
        title: 'PI Web API Simulator',
      },
    })
  </script>
</body>
</html>`;
}
