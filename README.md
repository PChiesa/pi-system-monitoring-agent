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
- Access to an OSIsoft PI Web API server
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
