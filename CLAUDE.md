# CLAUDE.md

## Project Overview

BOP (Blowout Preventer) Monitoring Agent — a real-time autonomous monitoring system for drilling rig BOP equipment. Uses the Claude Agent SDK to analyze sensor data streamed from OSIsoft PI Web API, detect threshold breaches, and provide actionable recommendations to drilling crews.

The agent runs continuously: it subscribes to live sensor data via PI Web API WebSocket channels, evaluates readings against configurable thresholds, and triggers Claude-powered analysis whenever anomalies are detected or on a periodic schedule.

## Tech Stack

- **Runtime**: Bun (ESM modules, `"type": "module"`)
- **Package manager**: Bun
- **Language**: TypeScript (strict mode, ES2022 target, ESNext modules, bundler resolution)
- **AI**: `@anthropic-ai/claude-agent-sdk` — uses `query()` for agentic tool-use loops and `tool()` / `createSdkMcpServer()` for in-process MCP tool servers
- **Data Source**: OSIsoft PI Web API (REST + WebSocket channel streaming)
- **HTTP**: axios (for PI REST API calls)
- **WebSocket**: ws (for PI channel streaming)
- **Validation**: zod (tool input schemas)
- **Testing**: Bun's built-in test runner (`bun:test`)

## Repository Structure

```
src/
  index.ts              # Entry point — wires all components, starts streaming, handles breach/periodic analysis
  config.ts             # Environment config (PI_CONFIG, BOP_CONFIG), monitored tag definitions, threshold rules
  bop-agent.ts          # BOPAgent class — wraps Claude Agent SDK query() for single-pass and streaming analysis
  bop-tools.ts          # MCP tool server — 5 tools (get_sensor_data, get_sensor_history, get_bop_status, send_alert, log_recommendation)
  bop-system-prompt.ts  # Domain-specific system prompt with BOP expertise, operating parameters, severity definitions
  sensor-state.ts       # SensorStateManager — in-memory state, ring buffer history, threshold evaluation, event emitter
  alert-manager.ts      # AlertManager — stores alerts and recommendations, console logging (production: SCADA/email/SMS stubs)
  pi-channel-client.ts  # PIChannelClient — WebSocket client for PI streamsets/channel with auto-reconnect
  pi-rest-client.ts     # PIRestClient — REST client for PI Web API (tag resolution, stream values, recorded history)

simulator/
  index.ts              # Entry point — CLI arg parsing, server startup, graceful shutdown
  server.ts             # SimulatorServer — HTTPS server, admin endpoints, 1 Hz tick loop
  tag-registry.ts       # Tag metadata registry (WebId generation, path/tag/webId lookup)
  data-generator.ts     # Ornstein-Uhlenbeck data generator with scenario modifier support
  scenario-engine.ts    # Scenario lifecycle management (auto/manual modes, registration)
  rest-handler.ts       # PI Web API REST handlers (points, streams/value, streams/recorded)
  ws-handler.ts         # WebSocket channel handler (streamsets/channel, 1 Hz push to clients)
  tls.ts                # Self-signed TLS certificate generation (openssl)
  pi-time.ts            # PI time syntax parser (*-1h, *-30m, ISO 8601)
  scenarios/
    normal.ts           # Steady-state (no modifiers)
    accumulator-decay.ts # Hydraulic leak — accumulator pressure decay over 8 min
    kick-detection.ts   # Well kick — pit gain, flow increase, casing pressure rise over 5 min
    ram-slowdown.ts     # Increasing BOP close times over 10 min
    pod-failure.ts      # Blue pod battery drain and failure over 6 min

tests/
  shared-mocks.ts       # Shared mock factories for cross-file mock compatibility (Bun #12823 workaround)
  *.test.ts             # One test file per source module, 8 suites, ~80 tests
```

## Commands

### Build and Run

```bash
bun run build          # TypeScript compilation (tsc) → dist/
bun run dev            # Run with bun (no build step needed, native TS support)
bun run start          # Run compiled output (dist/index.js)
```

### Simulator

```bash
bun run simulator                     # Start PI API simulator (auto mode, port 8443)
bun run simulator -- --scenario=kick-detection  # Start with a specific fault scenario
bun run simulator -- --port=9443      # Custom port
```

Connect the agent to the simulator:

```bash
PI_SERVER=localhost:8443 PI_DATA_ARCHIVE=SIMULATOR PI_USERNAME=sim PI_PASSWORD=sim bun run dev
```

### Testing

```bash
bun test               # Run all tests with Bun's built-in test runner
```

Tests use `bun:test` module imports (`describe`, `it`, `expect`, `mock`, `jest`, `spyOn`) and `mock.module()` for module mocking with dynamic `await import()`. Tests live in `tests/`.

## Architecture

### Data Flow

```
PI Web API (WebSocket channel)
    → PIChannelClient (emits 'value' events)
        → SensorStateManager (updates state, evaluates thresholds)
            → threshold_breach event
                → BOPAgent.analyze() (Claude Agent SDK query loop)
                    → MCP tools (get_sensor_data, get_sensor_history, get_bop_status, send_alert, log_recommendation)
```

### Key Patterns

- **Event-driven**: `PIChannelClient` and `SensorStateManager` extend `EventEmitter`. Sensor updates flow as events, threshold breaches trigger agent analysis.
- **Agent queue**: Only one agent analysis runs at a time (`agentBusy` flag). Additional breaches during analysis are queued and processed as a batch afterward.
- **In-process MCP server**: Tools are defined using `tool()` from the Agent SDK and bundled into an MCP server via `createSdkMcpServer()`. The server runs in-process (no separate process/transport).
- **Ring buffer**: `SensorStateManager` maintains a fixed-size history per tag (default 300 readings = ~5 min at 1 Hz) for rate-of-change detection.
- **Threshold evaluation**: Supports static thresholds (criticalLow, criticalHigh, warningLow, warningHigh) and rate-of-change over ~5 minute windows. Critical takes precedence over warning.

### Agent SDK Usage

The `BOPAgent` class uses two patterns from the Claude Agent SDK:

1. **Single-pass analysis** (`analyze`): Calls `query()` with a string prompt, iterates over the async response stream, collects text/tool-use/result messages.
2. **Streaming analysis** (`analyzeStreaming`): Calls `query()` with an `AsyncIterable<SDKUserMessage>` for long-lived conversational agents.

Both use `permissionMode: 'bypassPermissions'` and restrict tools to the 5 BOP-specific MCP tools via `allowedTools`.

### PI Web API Simulator

The `simulator/` directory contains a standalone local PI Web API simulator for development without a real PI server. Key design points:

- **Self-signed TLS**: Generates a temporary self-signed certificate at startup (requires `openssl` on PATH). Serves HTTPS REST and WSS WebSocket on the same port.
- **Tag registry**: Mirrors all 25 monitored tags from `src/config.ts`. WebIds are deterministic (`SIM_` + base64url of tag name). The registry is self-contained — it does not import production code.
- **Data generation**: Uses an Ornstein-Uhlenbeck process (mean-reverting random walk) for continuous tags, with per-tag nominal values, noise sigma, and clamp ranges. Discrete tags (positions, pod status) hold nominal until modified by a scenario.
- **Scenario modifiers**: Scenarios register per-tag modifier functions `(nominal, elapsedMs) → newTarget` on the `DataGenerator`. The OU process then mean-reverts toward the modified target, producing smooth realistic transitions.
- **1 Hz tick**: `SimulatorServer` runs a 1-second interval that calls `generator.tick()`, advancing all tag values. WebSocket clients receive updates at the same 1 Hz rate.
- **History seeding**: On startup, 300 seconds of historical data are pre-generated so `/recorded` queries return data immediately.
- **Admin API**: REST endpoints at `/admin/status`, `/admin/scenarios`, `/admin/scenario` (POST), `/admin/scenario/stop` (POST) for runtime control.
- **Two modes**: Auto mode randomly triggers fault scenarios on a configurable interval. Manual mode (`--scenario=NAME`) runs a single scenario immediately.

## Environment Variables

Required in `.env`:

| Variable | Description |
|---|---|
| `PI_SERVER` | PI Web API server hostname |
| `PI_DATA_ARCHIVE` | PI Data Archive name for tag resolution |
| `PI_USERNAME` | PI Web API username |
| `PI_PASSWORD` | PI Web API password |

Optional:

| Variable | Default | Description |
|---|---|---|
| `BOP_RWP` | `15000` | BOP rated working pressure (PSI) |
| `MASP` | `12500` | Maximum anticipated surface pressure (PSI) |
| `ANALYSIS_INTERVAL_MS` | `300000` | Periodic analysis interval (ms, default 5 min) |
| `AGENT_MODEL` | `sonnet` | Claude model for agent analysis |

Simulator (env vars or CLI flags):

| Variable | Default | Description |
|---|---|---|
| `SIM_PORT` | `8443` | Simulator HTTPS/WSS port (CLI: `--port=`) |
| `SIM_AUTO_INTERVAL_MS` | `600000` | Auto mode scenario interval in ms (CLI: `--interval=` in seconds) |

## Testing Conventions

- One test file per source module: `tests/<module>.test.ts`
- Module mocking pattern: `mock.module()` from `bun:test` followed by dynamic `await import()` for the module under test
- **Cross-file mock safety**: Bun runs all test files in a single process and `mock.module()` patches the global module cache ([oven-sh/bun#12823](https://github.com/oven-sh/bun/issues/12823)). To prevent leakage, every `mock.module()` call must provide ALL exports the module has. Use the shared factories in `tests/shared-mocks.ts` (`configMock()`, `sdkMock()`) when mocking `config` or the Agent SDK.
- External dependencies (Agent SDK, axios, ws) are always mocked — tests never make real API calls
- Console output is suppressed in tests via `spyOn(console, 'log').mockImplementation()`
- Event-based tests use `done` callback pattern for async event assertions
- `jest.useFakeTimers()` for reconnection/timing tests

## Code Conventions

- All imports use `.js` extensions (ESM requirement, resolved natively by Bun)
- Strict TypeScript (`"strict": true`)
- Interfaces are exported alongside classes (e.g., `ThresholdBreach`, `Alert`, `PIChannelConfig`)
- `ThresholdRule` interface is defined in `config.ts` alongside the threshold data
- Tool definitions use zod schemas for input validation with descriptive `.describe()` calls
- MCP tool handlers return `{ content: [{ type: 'text', text: ... }] }` format
- No linter or formatter configuration exists in the repo — follow existing code style

## Monitored PI Tags

25 tags across 6 subsystems:
- **Accumulator** (`BOP.ACC.*`): system pressure, pre-charge, hydraulic level/temp
- **Annular preventer** (`BOP.ANN01.*`): close pressure, position, close time
- **Ram preventers** (`BOP.RAM.*`): pipe ram and BSR position/close times
- **Manifold & lines** (`BOP.MAN.*`, `BOP.CHOKE.*`, `BOP.KILL.*`): regulated/choke/kill pressures
- **Control system** (`BOP.CTRL.*`): Blue/Yellow pod status and battery voltages
- **Wellbore** (`WELL.*`): casing/SPP pressure, flow in/out/delta, pit volume/delta

## Domain Context

This is an oil & gas drilling safety system. The BOP is the primary well control barrier. Key standards referenced:
- **API 53** (5th ed.): BOP equipment systems for well control, including close time limits (<=30 seconds for rams)
- **API RP 16Q**: Design, selection, operation, and maintenance of marine drilling riser equipment
- **30 CFR 250 Subpart G**: BSEE regulations for well completions, workovers, and decommissioning
