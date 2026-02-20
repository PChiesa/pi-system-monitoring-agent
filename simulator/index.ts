import { SimulatorServer } from './server.js';

function parseArgs(): { port: number; mode: 'auto' | 'manual'; scenario?: string; autoIntervalMs: number } {
  const args = process.argv.slice(2);
  let port = Number(process.env.SIM_PORT || 8443);
  let mode: 'auto' | 'manual' = 'auto';
  let scenario: string | undefined;
  let autoIntervalMs = Number(process.env.SIM_AUTO_INTERVAL_MS || 600_000);

  for (const arg of args) {
    if (arg.startsWith('--port=')) {
      port = parseInt(arg.split('=')[1]!, 10);
    } else if (arg.startsWith('--scenario=')) {
      scenario = arg.split('=')[1]!;
      mode = 'manual';
    } else if (arg === '--auto') {
      mode = 'auto';
    } else if (arg.startsWith('--interval=')) {
      autoIntervalMs = parseInt(arg.split('=')[1]!, 10) * 1000; // seconds → ms
    } else if (arg === '--help' || arg === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  return { port, mode, scenario, autoIntervalMs };
}

function printUsage(): void {
  console.log(`
PI Web API Simulator — local BOP sensor data simulator

Usage:
  bun run simulator/index.ts [options]

Options:
  --port=PORT         Server port (default: 8443, env: SIM_PORT)
  --scenario=NAME     Start with a specific scenario (switches to manual mode)
  --auto              Auto mode: randomly trigger scenarios (default)
  --interval=SEC      Auto mode interval in seconds (default: 600, env: SIM_AUTO_INTERVAL_MS)
  -h, --help          Show this help

Available scenarios:
  normal              Normal steady-state operation
  accumulator-decay   Gradual accumulator pressure loss (8 min)
  kick-detection      Well kick event (5 min)
  ram-slowdown        Increasing BOP close times (10 min)
  pod-failure         Blue control pod battery drain (6 min)

Runtime control (while running):
  curl -k https://localhost:PORT/admin/status
  curl -k -X POST https://localhost:PORT/admin/scenario -d '{"name":"kick-detection"}'
  curl -k -X POST https://localhost:PORT/admin/scenario/stop
  curl -k https://localhost:PORT/admin/scenarios

Agent connection:
  PI_SERVER=localhost:8443 PI_DATA_ARCHIVE=SIMULATOR PI_USERNAME=sim PI_PASSWORD=sim bun run dev
`);
}

async function main() {
  const config = parseArgs();

  console.log('===============================================');
  console.log('  PI Web API Simulator');
  console.log('===============================================\n');

  const server = new SimulatorServer(config);
  await server.start();

  // Graceful shutdown
  const shutdown = async () => {
    console.log('\n[PI Simulator] Shutting down...');
    await server.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
