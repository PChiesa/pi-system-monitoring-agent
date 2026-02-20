import type { Scenario } from '../scenario-engine.js';
import type { DataGenerator } from '../data-generator.js';

/**
 * Simulates Blue control pod battery drain leading to pod going offline.
 * Battery voltage drops from 12V to ~5.5V, then pod status goes to 0.
 *
 * Triggers:
 *   BOP.CTRL.BATT.BLUE.VOLTS WARNING @ 7.5V (~3 min)
 *   BOP.CTRL.BATT.BLUE.VOLTS CRITICAL @ 6.0V (~4.5 min)
 *   BOP.CTRL.POD.BLUE.STATUS goes to 0 (offline) at ~5 min
 */
const DURATION_MS = 6 * 60 * 1000; // 6 minutes

const AFFECTED_TAGS = [
  'BOP.CTRL.BATT.BLUE.VOLTS',
  'BOP.CTRL.POD.BLUE.STATUS',
];

export const podFailureScenario: Scenario = {
  name: 'pod-failure',
  description: 'Blue control pod battery drain and failure. Yellow pod remains healthy.',
  durationMs: DURATION_MS,
  tags: AFFECTED_TAGS,

  activate(generator: DataGenerator) {
    // Battery voltage: 12.0 → 5.5V over 6 min
    generator.setModifier('BOP.CTRL.BATT.BLUE.VOLTS', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 12.0 - 6.5 * progress;
    });

    // Pod status: online (1) until voltage drops below 6V (~75% through), then offline (0)
    generator.setModifier('BOP.CTRL.POD.BLUE.STATUS', (_nominal, elapsedMs) => {
      const progress = elapsedMs / DURATION_MS;
      // Pod goes offline at ~83% through the scenario (when voltage ≈ 5.6V)
      return progress < 0.83 ? 1 : 0;
    });
  },

  deactivate(generator: DataGenerator) {
    for (const tag of AFFECTED_TAGS) {
      generator.clearModifier(tag);
    }
  },
};
