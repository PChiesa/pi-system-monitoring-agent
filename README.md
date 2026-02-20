# BOP Monitoring Agent

Real-time autonomous monitoring system for drilling rig Blowout Preventer (BOP) equipment. Uses the Claude Agent SDK to analyze sensor data streamed from OSIsoft PI Web API, detect threshold breaches, and provide actionable recommendations to drilling crews.

The agent runs continuously — it subscribes to live sensor data via PI Web API WebSocket channels, evaluates readings against configurable thresholds, and triggers Claude-powered analysis whenever anomalies are detected or on a periodic schedule.

## Architecture

```
PI Web API (WebSocket channel)
    → PIChannelClient (emits 'value' events)
        → SensorStateManager (updates state, evaluates thresholds)
            → threshold_breach event
                → BOPAgent.analyze() (Claude Agent SDK query loop)
                    → MCP tools (get_sensor_data, get_sensor_history,
                       get_bop_status, send_alert, log_recommendation)
```

**Event-driven** — sensor updates flow as events through the system. Threshold breaches trigger agent analysis, with an internal queue ensuring only one analysis runs at a time. Additional breaches during analysis are batched and processed afterward.

**In-process MCP server** — five domain-specific tools are defined using the Agent SDK's `tool()` helper and bundled into an MCP server via `createSdkMcpServer()`. The server runs in-process with no separate transport.

**Ring buffer history** — `SensorStateManager` maintains a fixed-size history per tag (default 300 readings at 1 Hz) for rate-of-change detection.

**Threshold evaluation** — supports static thresholds (criticalLow/criticalHigh, warningLow/warningHigh) and rate-of-change limits over rolling windows. Critical severity takes precedence over warning.

## Prerequisites

- [Bun](https://bun.sh/) (v1.0+)
- Access to an OSIsoft PI Web API server **or** the included PI API simulator for local development
- An Anthropic API key (for the Claude Agent SDK)

## Setup

1. Clone the repository:

```bash
git clone <repository-url>
cd bop-monitoring-agent
```

2. Install dependencies:

```bash
bun install
```

3. Create a `.env` file in the project root with your configuration:

```env
# Required
PI_SERVER=your-pi-server-hostname
PI_DATA_ARCHIVE=your-data-archive-name
PI_USERNAME=your-username
PI_PASSWORD=your-password

# Optional
BOP_RWP=15000                # Rated working pressure (PSI), default 15000
MASP=12500                   # Max anticipated surface pressure (PSI), default 12500
ANALYSIS_INTERVAL_MS=300000  # Periodic analysis interval (ms), default 5 min
AGENT_MODEL=sonnet           # Claude model for analysis, default sonnet
```

## Usage

Development mode (runs directly via Bun, no build step needed):

```bash
bun run dev
```

Production build and run:

```bash
bun run build
bun run start
```

Once running, the agent will:

1. Resolve all configured PI tag names to WebIds via the PI REST API
2. Open a WebSocket channel subscription for live sensor data
3. Evaluate each incoming reading against configured thresholds
4. Trigger Claude-powered analysis on threshold breaches
5. Run periodic health-check analyses on a configurable interval

## PI Web API Simulator

A local simulator is included for development and testing without a real PI Web API server. It generates realistic BOP sensor data using an Ornstein-Uhlenbeck process (mean-reverting random walk) for continuous tags and provides the same REST and WebSocket interfaces the agent expects.

### Running the simulator

```bash
bun run simulator
```

Then connect the agent in a separate terminal:

```bash
PI_SERVER=localhost:8443 PI_DATA_ARCHIVE=SIMULATOR PI_USERNAME=sim PI_PASSWORD=sim bun run dev
```

### CLI options

| Option | Description |
|---|---|
| `--port=PORT` | Server port (default: 8443, env: `SIM_PORT`) |
| `--scenario=NAME` | Start with a specific scenario (switches to manual mode) |
| `--auto` | Auto mode: randomly trigger fault scenarios (default) |
| `--interval=SEC` | Auto mode interval in seconds (default: 600, env: `SIM_AUTO_INTERVAL_MS`) |
| `-h, --help` | Show help |

### Fault scenarios

The simulator ships with five built-in scenarios that progressively push sensor values through warning and critical thresholds:

| Scenario | Duration | Description |
|---|---|---|
| `normal` | indefinite | Steady-state operation — all parameters at nominal with standard noise |
| `accumulator-decay` | 8 min | Gradual accumulator pressure loss simulating a hydraulic leak |
| `kick-detection` | 5 min | Well kick event — pit gain, flow increase, casing pressure rise |
| `ram-slowdown` | 10 min | Increasing BOP close times simulating seal wear or N2 depletion |
| `pod-failure` | 6 min | Blue control pod battery drain and failure |

In **auto mode** (the default), the simulator randomly activates fault scenarios on a configurable interval. In **manual mode** (`--scenario=NAME`), a single scenario runs immediately.

### Admin API

While the simulator is running, use the admin endpoints to inspect and control it:

```bash
curl -k https://localhost:8443/admin/status                                      # Server status
curl -k https://localhost:8443/admin/scenarios                                   # List available scenarios
curl -k -X POST https://localhost:8443/admin/scenario -d '{"name":"kick-detection"}'  # Activate a scenario
curl -k -X POST https://localhost:8443/admin/scenario/stop                       # Stop active scenario
```

## Monitored Tags

25 PI tags across 6 BOP subsystems:

| Subsystem | Tag prefix | Sensors |
|---|---|---|
| Accumulator | `BOP.ACC.*` | System pressure, pre-charge, hydraulic level & temp |
| Annular preventer | `BOP.ANN01.*` | Close pressure, position, close time |
| Ram preventers | `BOP.RAM.*` | Pipe ram & BSR position, close times |
| Manifold & lines | `BOP.MAN.*`, `BOP.CHOKE.*`, `BOP.KILL.*` | Regulated, choke, and kill pressures |
| Control system | `BOP.CTRL.*` | Blue/Yellow pod status, battery voltages |
| Wellbore | `WELL.*` | Casing/SPP pressure, flow in/out/delta, pit volume/delta |

## Project Structure

```
src/
  index.ts              # Entry point — wires components, starts streaming, handles analysis
  config.ts             # Environment config, monitored tag definitions, threshold rules
  bop-agent.ts          # BOPAgent class — wraps Claude Agent SDK query()
  bop-tools.ts          # MCP tool server — 5 BOP-specific tools
  bop-system-prompt.ts  # Domain-specific system prompt with BOP expertise
  sensor-state.ts       # SensorStateManager — in-memory state, ring buffer, thresholds
  alert-manager.ts      # AlertManager — stores alerts/recommendations, console logging
  pi-channel-client.ts  # PIChannelClient — WebSocket client with auto-reconnect
  pi-rest-client.ts     # PIRestClient — REST client for PI Web API

simulator/
  index.ts              # Entry point — CLI argument parsing, server startup
  server.ts             # SimulatorServer — HTTPS server, admin endpoints, 1 Hz tick loop
  tag-registry.ts       # Tag metadata registry (WebId generation, path lookup)
  data-generator.ts     # Ornstein-Uhlenbeck data generator with scenario modifiers
  scenario-engine.ts    # Scenario lifecycle management (auto/manual modes)
  rest-handler.ts       # PI Web API REST endpoint handlers (points, streams, recorded)
  ws-handler.ts         # WebSocket channel handler (streamsets/channel, 1 Hz push)
  tls.ts                # Self-signed TLS certificate generation
  pi-time.ts            # PI time syntax parser (*-1h, *-30m, ISO 8601)
  scenarios/
    normal.ts           # Steady-state operation (no modifiers)
    accumulator-decay.ts # Hydraulic leak — accumulator pressure decay
    kick-detection.ts   # Well kick — pit gain, flow increase, casing pressure rise
    ram-slowdown.ts     # Increasing BOP close times — seal wear / N2 depletion
    pod-failure.ts      # Blue pod battery drain and failure

tests/
  shared-mocks.ts       # Shared mock factories (Bun #12823 workaround)
  *.test.ts             # One test file per source module (8 suites)
```

## Testing

```bash
bun test
```

Tests run with Bun's built-in test runner (`bun:test`). All external dependencies (Agent SDK, axios, ws) are mocked — tests never make real API calls.

## Tech Stack

- **Runtime**: Bun (ESM)
- **Package manager**: Bun
- **Language**: TypeScript (strict mode)
- **AI**: Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- **Data Source**: OSIsoft PI Web API (REST + WebSocket)
- **HTTP**: axios
- **WebSocket**: ws
- **Validation**: zod
- **Testing**: Bun's built-in test runner (`bun:test`)

## Regulatory Context

This is a drilling safety system. The BOP is the primary well control barrier. The agent's analysis and thresholds reference:

- **API 53** (5th ed.) — BOP equipment systems for well control, including close time limits (<=30 seconds for rams)
- **API RP 16Q** — Design, selection, operation, and maintenance of marine drilling riser equipment
- **30 CFR 250 Subpart G** — BSEE regulations for well completions, workovers, and decommissioning

## License

See [LICENSE](LICENSE) for details.
