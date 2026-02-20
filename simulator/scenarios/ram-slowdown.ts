import type { Scenario } from '../scenario-engine.js';
import type { DataGenerator } from '../data-generator.js';

/**
 * Simulates increasing BOP ram/annular close times due to seal wear
 * or nitrogen depletion in accumulator bottles.
 *
 * Triggers:
 *   BOP.ANN01.CLOSETIME WARNING @ 25 sec (~5 min)
 *   BOP.RAM.PIPE01.CLOSETIME WARNING @ 25 sec (~6 min)
 *   BOP.RAM.BSR01.CLOSETIME WARNING @ 25 sec (~5.5 min)
 *   BOP.RAM.PIPE01.CLOSETIME CRITICAL @ 30 sec (~8 min)
 *   BOP.RAM.BSR01.CLOSETIME CRITICAL @ 30 sec (~8.5 min)
 *   BOP.ANN01.CLOSETIME CRITICAL @ 30 sec (~8 min)
 */
const DURATION_MS = 10 * 60 * 1000; // 10 minutes

const AFFECTED_TAGS = [
  'BOP.RAM.PIPE01.CLOSETIME',
  'BOP.RAM.BSR01.CLOSETIME',
  'BOP.ANN01.CLOSETIME',
];

export const ramSlowdownScenario: Scenario = {
  name: 'ram-slowdown',
  description: 'Increasing BOP close times simulating seal wear or N2 depletion.',
  durationMs: DURATION_MS,
  tags: AFFECTED_TAGS,

  activate(generator: DataGenerator) {
    // Pipe ram close time: 15 → 32 sec
    generator.setModifier('BOP.RAM.PIPE01.CLOSETIME', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 15 + 17 * progress;
    });

    // BSR close time: 16 → 33 sec
    generator.setModifier('BOP.RAM.BSR01.CLOSETIME', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 16 + 17 * progress;
    });

    // Annular close time: 18 → 32 sec
    generator.setModifier('BOP.ANN01.CLOSETIME', (_nominal, elapsedMs) => {
      const progress = Math.min(elapsedMs / DURATION_MS, 1);
      return 18 + 14 * progress;
    });
  },

  deactivate(generator: DataGenerator) {
    for (const tag of AFFECTED_TAGS) {
      generator.clearModifier(tag);
    }
  },
};
