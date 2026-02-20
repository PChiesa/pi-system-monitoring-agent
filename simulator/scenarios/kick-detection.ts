import type { Scenario } from '../scenario-engine.js';
import type { DataGenerator } from '../data-generator.js';

/**
 * Simulates a well kick (formation fluid influx).
 * Pit volume increases, flow delta rises, casing pressure climbs.
 *
 * Triggers:
 *   WELL.PIT.VOL.DELTA WARNING @ 5 bbl (~1.5 min)
 *   WELL.FLOW.DELTA WARNING @ 5 GPM (~1 min)
 *   WELL.PIT.VOL.DELTA CRITICAL @ 10 bbl (~3 min)
 *   WELL.FLOW.DELTA CRITICAL @ 20 GPM (~3.5 min)
 */
const DURATION_MS = 5 * 60 * 1000; // 5 minutes

const AFFECTED_TAGS = [
  'WELL.PIT.VOL.TOTAL',
  'WELL.PIT.VOL.DELTA',
  'WELL.FLOW.IN',
  'WELL.FLOW.OUT',
  'WELL.FLOW.DELTA',
  'WELL.PRESS.CASING',
];

export const kickDetectionScenario: Scenario = {
  name: 'kick-detection',
  description: 'Simulated well kick — pit gain, flow increase, casing pressure rise.',
  durationMs: DURATION_MS,
  tags: AFFECTED_TAGS,

  activate(generator: DataGenerator) {
    // Pit volume total: 800 → 815 bbl (15 bbl gain)
    generator.setModifier('WELL.PIT.VOL.TOTAL', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 800 + 15 * progress;
    });

    // Pit volume delta: 0 → 12 bbl
    generator.setModifier('WELL.PIT.VOL.DELTA', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 12 * progress;
    });

    // Flow in stays roughly nominal
    generator.setModifier('WELL.FLOW.IN', (_nominal, _elapsedMs) => {
      return 600;
    });

    // Flow out increases (formation fluid entering wellbore)
    generator.setModifier('WELL.FLOW.OUT', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 600 + 25 * progress;
    });

    // Flow delta: 0 → 25 GPM
    generator.setModifier('WELL.FLOW.DELTA', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 25 * progress;
    });

    // Casing pressure: 500 → 800 PSI
    generator.setModifier('WELL.PRESS.CASING', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 500 + 300 * progress;
    });
  },

  deactivate(generator: DataGenerator) {
    for (const tag of AFFECTED_TAGS) {
      generator.clearModifier(tag);
    }
  },
};
