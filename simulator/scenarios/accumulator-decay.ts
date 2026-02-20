import type { Scenario } from '../scenario-engine.js';
import type { DataGenerator } from '../data-generator.js';

/**
 * Simulates a hydraulic leak in the accumulator system.
 * System pressure decays from 3000 to ~1100 PSI over 8 minutes.
 * Pre-charge drops from 1000 to ~780 PSI.
 * Hydraulic level drops from 80 to ~55 gal.
 *
 * Triggers:
 *   BOP.ACC.PRESS.SYS WARNING @ 2200 PSI (~2.7 min)
 *   BOP.ACC.PRESS.SYS rate-of-change breach
 *   BOP.ACC.PRESS.SYS CRITICAL @ 1200 PSI (~6 min)
 *   BOP.ACC.PRESS.PRCHG WARNING @ 900 PSI (~4.5 min)
 *   BOP.ACC.PRESS.PRCHG CRITICAL @ 800 PSI (~7 min)
 */
const DURATION_MS = 8 * 60 * 1000; // 8 minutes

const AFFECTED_TAGS = [
  'BOP.ACC.PRESS.SYS',
  'BOP.ACC.PRESS.PRCHG',
  'BOP.ACC.HYD.LEVEL',
];

export const accumulatorDecayScenario: Scenario = {
  name: 'accumulator-decay',
  description: 'Gradual accumulator pressure loss simulating a hydraulic leak.',
  durationMs: DURATION_MS,
  tags: AFFECTED_TAGS,

  activate(generator: DataGenerator) {
    // System pressure: 3000 → 1100 over 8 min
    generator.setModifier('BOP.ACC.PRESS.SYS', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 3000 - 1900 * progress;
    });

    // Pre-charge: 1000 → 780 over 8 min
    generator.setModifier('BOP.ACC.PRESS.PRCHG', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 1000 - 220 * progress;
    });

    // Hydraulic level: 80 → 55 gal over 8 min
    generator.setModifier('BOP.ACC.HYD.LEVEL', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 80 - 25 * progress;
    });
  },

  deactivate(generator: DataGenerator) {
    for (const tag of AFFECTED_TAGS) {
      generator.clearModifier(tag);
    }
  },
};
