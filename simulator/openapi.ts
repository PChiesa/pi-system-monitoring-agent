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
              description: 'Maximum number of values to return (default: 100).',
              schema: { type: 'integer', default: 100, minimum: 1 },
            },
          ],
          responses: {
            '200': {
              description: 'Recorded values',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      Items: {
                        type: 'array',
                        items: { $ref: '#/components/schemas/PIStreamValue' },
                      },
                    },
                  },
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

      // ── WebSocket endpoint (documented for reference) ────────────

      '/piwebapi/streamsets/channel': {
        get: {
          tags: ['PI Web API'],
          summary: 'WebSocket streaming channel',
          description:
            'Upgrade to a WebSocket connection to receive real-time sensor data at 1 Hz. ' +
            'Subscribe to specific tags by passing one or more `webId` query parameters. ' +
            'This endpoint requires a WebSocket upgrade (`Connection: Upgrade`) — it cannot be called as a regular HTTP request.\n\n' +
            '**Protocol:** `wss://`\n\n' +
            '**Message format:** Each message is a JSON object with an `Items` array, where each item contains ' +
            '`WebId`, `Name`, `Path`, and an `Items` array with the latest `PIStreamValue`.',
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
                  'Use WebIds with the `/piwebapi/streams/{webId}/value` and `/piwebapi/streams/{webId}/recorded` endpoints.',
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
