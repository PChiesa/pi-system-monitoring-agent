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

The simulator also includes a **Configuration UI**, **custom scenario builder**, **PI AF (Asset Framework) hierarchy simulator**, and optional **PostgreSQL persistence** for durable state across restarts.

### Running the simulator

**Without Docker** (in-memory defaults, no persistence):

```bash
bun run simulator
```

**With Docker** (PostgreSQL persistence):

```bash
docker compose up
```

This starts PostgreSQL (empty schema, no seed data) and the simulator connected to it. Tags, AF hierarchy, and scenarios are persisted — they survive container restarts.

Then connect the agent in a separate terminal:

```bash
PI_SERVER=localhost:8443 PI_DATA_ARCHIVE=SIMULATOR PI_USERNAME=sim PI_PASSWORD=sim bun run dev
```

### Persistence

When `DATABASE_URL` is set, the simulator persists all state to PostgreSQL:
- **Tags** — tag names, units, profiles, custom groups
- **AF hierarchy** — databases, elements, attributes
- **Custom scenarios** — name, description, duration, modifiers

All admin API mutations (create/update/delete) write through to the database. On startup, data is loaded from PostgreSQL. The database starts empty — all data is created at runtime via the admin API, Configuration UI, or AF import.

When `DATABASE_URL` is not set, the simulator falls back to in-memory defaults: 25 built-in tags with a BOP AF hierarchy. No scenarios are available until created via the API.

### Configuration UI

The simulator ships with a React-based configuration UI accessible at `https://localhost:8443/ui/` once the simulator is running. The UI provides:

- **Dashboard** — live tag values across all 6 subsystems with active scenario controls
- **Tag Configuration** — edit tag profiles (nominal, sigma, min/max, discrete) at runtime; override individual tags to fixed values
- **Scenario Builder** — create custom fault scenarios with per-tag modifiers, curve types (linear, step, exponential), and visual preview
- **Asset Framework** — browse and edit the AF element hierarchy, map attributes to PI tags, view live attribute values
- **AF Import** — connect to a real PI Web API server, browse its AF hierarchy, and import a subtree (elements, attributes, and optionally PI tags with current values) into the simulator with real-time NDJSON streaming progress

To build the UI (required once, or after UI changes):

```bash
cd simulator/ui && bun install && bun run build
```

The built UI is served as static files by the simulator at `/ui/`. During development, you can run the Vite dev server separately (`cd simulator/ui && bun run dev`) — it proxies API requests to the simulator.

### CLI options

| Option | Description |
|---|---|
| `--port=PORT` | Server port (default: 8443, env: `SIM_PORT`) |
| `--scenario=NAME` | Start with a custom scenario (switches to manual mode) |
| `--auto` | Auto mode: randomly trigger custom scenarios (default) |
| `--interval=SEC` | Auto mode interval in seconds (default: 600, env: `SIM_AUTO_INTERVAL_MS`) |
| `-h, --help` | Show help |

### Custom scenarios

All scenarios are user-created — there are no built-in scenarios. Create them via the Configuration UI or the admin REST API. Each scenario defines a set of per-tag modifiers with start/end values, duration, and a curve type (linear, step, or exponential).

In **auto mode** (the default), the simulator randomly activates available custom scenarios on a configurable interval. In **manual mode** (`--scenario=NAME`), a named custom scenario runs immediately.

When running with PostgreSQL, custom scenarios are persisted and survive restarts.

### Asset Framework (AF) Simulator

The simulator includes a PI AF hierarchy that mirrors the BOP equipment structure. This enables testing of AF-aware clients without a real PI AF server.

Without `DATABASE_URL`, the default hierarchy is seeded on startup. With `DATABASE_URL`, the AF hierarchy is loaded from PostgreSQL (empty initially — populate via the admin API or AF import).

```
BOP_Database
  └─ Rig
       ├─ BOP Stack
       │    ├─ Accumulator System     (4 attributes → BOP.ACC.*)
       │    ├─ Annular Preventer      (3 attributes → BOP.ANN01.*)
       │    ├─ Pipe Ram               (2 attributes → BOP.RAM.PIPE01.*)
       │    ├─ Blind Shear Ram        (2 attributes → BOP.RAM.BSR01.*)
       │    ├─ Manifold               (3 attributes → BOP.MAN.*, BOP.CHOKE.*, BOP.KILL.*)
       │    └─ Control System
       │         ├─ Blue Pod           (2 attributes → BOP.CTRL.*.BLUE.*)
       │         └─ Yellow Pod         (2 attributes → BOP.CTRL.*.YELLOW.*)
       └─ Wellbore                    (7 attributes → WELL.*)
```

AF endpoints follow the real PI Web API conventions (`/piwebapi/assetdatabases`, `/piwebapi/elements/{webId}`, `/piwebapi/attributes/{webId}/value`, etc.). Elements and attributes can be created, updated, and deleted via the admin API or the Configuration UI.

### Admin API

While the simulator is running, use the admin endpoints to inspect and control it:

```bash
# Status & scenarios
curl -k https://localhost:8443/admin/status
curl -k https://localhost:8443/admin/scenarios
curl -k -X POST https://localhost:8443/admin/scenario -d '{"name":"my-scenario"}'
curl -k -X POST https://localhost:8443/admin/scenario/stop

# Tag configuration
curl -k https://localhost:8443/admin/tags
curl -k -X PUT https://localhost:8443/admin/tags/BOP.ACC.PRESS.SYS/profile -d '{"nominal":2500,"sigma":20}'
curl -k -X POST https://localhost:8443/admin/tags/BOP.ACC.PRESS.SYS/override -d '{"value":1000}'
curl -k -X DELETE https://localhost:8443/admin/tags/BOP.ACC.PRESS.SYS/override

# Custom scenarios
curl -k https://localhost:8443/admin/scenarios/custom
curl -k -X POST https://localhost:8443/admin/scenarios/custom -d '{"name":"my-leak","description":"Custom leak","durationMs":300000,"modifiers":[{"tagName":"BOP.ACC.PRESS.SYS","startValue":3000,"endValue":1500,"curveType":"linear"}]}'
curl -k -X DELETE https://localhost:8443/admin/scenarios/custom/my-leak

# Asset Framework
curl -k https://localhost:8443/piwebapi/assetdatabases
curl -k https://localhost:8443/piwebapi/elements/{webId}/attributes
curl -k https://localhost:8443/piwebapi/attributes/{webId}/value

# AF Import (from remote PI Web API — all POST, NDJSON streaming for execute)
curl -k -X POST https://localhost:8443/admin/import/test-connection -d '{"serverUrl":"https://piserver","username":"user","password":"pass"}'
curl -k -X POST https://localhost:8443/admin/import/browse/servers -d '{"serverUrl":"https://piserver","username":"user","password":"pass"}'
curl -k -X POST https://localhost:8443/admin/import/execute -d '{"connection":{...},"remoteElementWebId":"...","targetParentWebId":"...","importTags":true}'
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
  server.ts             # SimulatorServer — HTTPS server, admin endpoints, static UI serving, DB persistence
  tag-registry.ts       # Tag metadata registry (WebId generation, path lookup, loadFromDatabase/loadFromDefaults)
  data-generator.ts     # Ornstein-Uhlenbeck data generator with scenario modifiers, loadProfiles/loadFromDefaults
  scenario-engine.ts    # Scenario lifecycle management (auto/manual modes, custom scenarios only)
  rest-handler.ts       # PI Web API REST endpoint handlers (points, streams, recorded)
  ws-handler.ts         # WebSocket channel handler (streamsets/channel, 1 Hz push)
  af-model.ts           # PI AF hierarchy — in-memory model, loadFromDatabase/loadFromDefaults, DB ID tracking
  af-handler.ts         # PI Web API AF endpoint handlers (assetdatabases, elements, attributes)
  import-handler.ts     # AF import from remote PI Web API — server-side proxy, NDJSON streaming, DB persistence
  custom-scenario.ts    # Custom scenario builder — creates Scenario objects from JSON definitions
  utils.ts              # Shared utilities (sendJson, readBody)
  tls.ts                # Self-signed TLS certificate generation
  pi-time.ts            # PI time syntax parser (*-1h, *-30m, ISO 8601)
  db/
    schema.sql          # PostgreSQL schema (tags, af_databases, af_elements, af_attributes, custom_scenarios)
    connection.ts       # postgres connection pool, waitForDatabase with backoff, closeDatabase
    defaults.ts         # Default constants (DEFAULT_TAGS, DEFAULT_TAG_PROFILES, seedDefaultAFHierarchy)
    tag-repository.ts   # Tag CRUD: loadAllTags, insertTag, updateTagProfile, deleteTag
    af-repository.ts    # AF CRUD: loadAllDatabases/Elements/Attributes, insert/update/delete
    scenario-repository.ts # Custom scenario CRUD: loadAllCustomScenarios, insert/update/delete
  ui/                   # React configuration UI (separate Vite project)
    src/
      App.tsx           # Router: Dashboard | Tags | Scenarios | Asset Framework
      pages/            # Dashboard, tag config, scenario builder, AF browser, AF import dialog
      hooks/            # useLiveValues (WebSocket), useTags, useStatus
      lib/api.ts        # Typed fetch wrapper for admin + PI Web API endpoints
      components/ui/    # shadcn/ui primitives (button, card, dialog, table, etc.)

tests/
  shared-mocks.ts       # Shared mock factories (Bun #12823 workaround)
  *.test.ts             # One test file per source module (11 suites, ~160 tests)
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
- **Simulator DB**: PostgreSQL 17 (optional, via `postgres` v3 driver)
- **Simulator UI**: React 19, Vite, Tailwind CSS v4, shadcn/ui

## Regulatory Context

This is a drilling safety system. The BOP is the primary well control barrier. The agent's analysis and thresholds reference:

- **API 53** (5th ed.) — BOP equipment systems for well control, including close time limits (<=30 seconds for rams)
- **API RP 16Q** — Design, selection, operation, and maintenance of marine drilling riser equipment
- **30 CFR 250 Subpart G** — BSEE regulations for well completions, workovers, and decommissioning

## License

See [LICENSE](LICENSE) for details.
