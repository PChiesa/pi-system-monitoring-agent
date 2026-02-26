import { PI_CONFIG, BOP_CONFIG, MONITORED_TAGS, THRESHOLD_RULES } from './config.js';
import { PIChannelClient } from './pi-channel-client.js';
import { PIRestClient } from './pi-rest-client.js';
import { SensorStateManager, ThresholdBreach } from './sensor-state.js';
import { AlertManager } from './alert-manager.js';
import { createBOPToolsServer } from './bop-tools.js';
import { BOPAgent } from './bop-agent.js';
import { HealthServer } from './health.js';

async function main() {
  console.log('===============================================');
  console.log('  BOP Monitoring Agent — Starting up');
  console.log('===============================================\n');

  // -- Initialize components --
  const piRest = new PIRestClient(PI_CONFIG.server, PI_CONFIG.username, PI_CONFIG.password, PI_CONFIG.rejectUnauthorized);
  const sensorState = new SensorStateManager(300);
  const alertManager = new AlertManager();

  // -- Health tracking state --
  let piChannelConnected = false;
  let lastSensorUpdate: Date | null = null;

  const healthServer = new HealthServer(
    {
      isPiChannelConnected: () => piChannelConnected,
      getSensorTagCount: () => Object.keys(MONITORED_TAGS).length,
      getLastSensorUpdate: () => lastSensorUpdate,
    },
    Number(process.env.HEALTH_PORT || 8080)
  );
  await healthServer.start();

  // -- Resolve PI tags -> WebIds --
  console.log('Resolving PI tag WebIds...');
  const tagNames = Object.keys(MONITORED_TAGS);
  const webIdMap = await piRest.resolveTagsToWebIds(PI_CONFIG.dataArchive, tagNames);

  console.log(`  Resolved ${webIdMap.size}/${tagNames.length} tags\n`);

  // Register tags with state manager
  for (const [tag, unit] of Object.entries(MONITORED_TAGS)) {
    const webId = webIdMap.get(tag);
    if (webId) {
      sensorState.registerTag(tag, webId, unit);
    } else {
      console.warn(`  Warning: Could not resolve: ${tag}`);
    }
  }

  sensorState.setThresholds(THRESHOLD_RULES);

  // -- Create MCP tools server --
  // This is the Agent SDK way: tools are bundled into an in-process
  // MCP server that the query() function automatically connects to
  const bopToolsServer = createBOPToolsServer(sensorState, piRest, alertManager);

  // -- Create the agent --
  const agent = new BOPAgent(bopToolsServer);

  // -- Connect to PI Web API channel --
  const webIds = [...webIdMap.values()];
  const piChannel = new PIChannelClient({
    server: PI_CONFIG.server,
    webIds,
    username: PI_CONFIG.username,
    password: PI_CONFIG.password,
    includeInitialValues: true,
    heartbeatRate: 5,
    rejectUnauthorized: PI_CONFIG.rejectUnauthorized,
  });

  // -- Wire: PI channel -> sensor state --
  piChannel.on('connected', () => { piChannelConnected = true; });
  piChannel.on('close', () => { piChannelConnected = false; });

  piChannel.on('value', (event: any) => {
    const numericValue =
      typeof event.Value === 'number' ? event.Value : parseFloat(String(event.Value));

    lastSensorUpdate = new Date();
    sensorState.update(event.webId, numericValue, new Date(event.Timestamp), event.Good);
  });

  // -- Wire: threshold breaches -> agent --
  let agentBusy = false;
  const breachQueue: ThresholdBreach[] = [];

  sensorState.on('threshold_breach', async (breach: ThresholdBreach) => {
    console.log(`[THRESHOLD ${breach.level}] ${breach.message}`);

    if (agentBusy) {
      // Queue breach for next analysis cycle if agent is busy
      breachQueue.push(breach);
      console.log('  -> Agent busy, queued for next cycle');
      return;
    }

    agentBusy = true;
    try {
      const context = buildBreachContext(breach);
      console.log('\n[Agent] Analyzing threshold breach...\n');
      const result = await agent.analyze(context);
      console.log('\n-- Agent Analysis --');
      console.log(result.text);
      console.log(`Tools used: ${result.toolsUsed.join(', ')}`);
      if (result.costUsd) console.log(`Cost: $${result.costUsd.toFixed(4)}`);
      console.log('--------------------\n');
    } catch (err) {
      console.error('[Agent Error]', err);
    } finally {
      agentBusy = false;

      // Process queued breaches
      if (breachQueue.length > 0) {
        const queued = breachQueue.splice(0, breachQueue.length);
        const summary = queued.map((b) => `- ${b.message}`).join('\n');
        // Fire a combined analysis for queued breaches
        agent
          .analyze(
            `While you were analyzing the previous breach, ${queued.length} additional ` +
              `threshold breaches occurred:\n\n${summary}\n\n` +
              `Use get_bop_status to get the full current state and analyze all of these together. ` +
              `Prioritize any CRITICAL conditions.`
          )
          .then((r) => console.log('[Queued Analysis]', r.text))
          .catch((e) => console.error('[Queued Analysis Error]', e));
      }
    }
  });

  // -- Periodic analysis (every N minutes) --
  setInterval(async () => {
    if (agentBusy) return;
    agentBusy = true;

    try {
      const snapshot = sensorState.getFullSnapshot();
      const context =
        `Perform a routine ${BOP_CONFIG.analysisIntervalMs / 60000}-minute BOP system health check.\n\n` +
        `Current sensor readings:\n${JSON.stringify(snapshot, null, 2)}\n\n` +
        `Analyze these readings for any concerns. Check trends by querying sensor history ` +
        `for any values that look borderline. Provide a brief status summary and flag ` +
        `any items needing attention. If everything is normal, confirm system health.`;

      console.log('\nRunning periodic BOP health check...\n');
      const result = await agent.analyze(context);
      console.log('\n-- Periodic Analysis --');
      console.log(result.text);
      console.log('------------------------\n');
    } catch (err) {
      console.error('[Periodic Analysis Error]', err);
    } finally {
      agentBusy = false;
    }
  }, BOP_CONFIG.analysisIntervalMs);

  // -- Start streaming --
  piChannel.connect();

  piChannel.on('maxReconnectReached', () => {
    console.error('FATAL: PI Web API connection lost permanently. Exiting.');
    process.exit(1);
  });

  console.log('BOP Monitoring Agent is running.\n');
  console.log(`   Monitoring ${webIds.length} tags`);
  console.log(`   Periodic analysis every ${BOP_CONFIG.analysisIntervalMs / 60000} min`);
  console.log(`   Model: ${BOP_CONFIG.agentModel}\n`);
}

function buildBreachContext(breach: ThresholdBreach): string {
  return (
    `ALERT TRIGGER: A ${breach.level} threshold breach has been detected.\n\n` +
    `Breach details:\n` +
    `  Tag: ${breach.tag}\n` +
    `  Current value: ${breach.value}\n` +
    `  Level: ${breach.level}\n` +
    `  Type: ${breach.type}\n` +
    `  Threshold: ${breach.threshold}\n` +
    `  Message: ${breach.message}\n\n` +
    `Instructions:\n` +
    `1. If this is CRITICAL, call send_alert IMMEDIATELY before further investigation.\n` +
    `2. Use get_sensor_data to check related parameters across the BOP system.\n` +
    `3. Use get_sensor_history for the breached tag (last 1h) to determine if this is sudden or gradual.\n` +
    `4. Correlate with other subsystems — is this an isolated issue or part of a broader pattern?\n` +
    `5. Determine the most likely root cause.\n` +
    `6. Provide specific, actionable recommendations referencing applicable standards.\n` +
    `7. Log a maintenance recommendation if appropriate.`
  );
}

// -- Entry point --
main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
