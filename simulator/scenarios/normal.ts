import type { Scenario } from '../scenario-engine.js';

export const normalScenario: Scenario = {
  name: 'normal',
  description: 'Normal steady-state BOP operation. All parameters at nominal values with standard noise.',
  durationMs: 0, // Indefinite — this is the default state
  tags: [],

  activate(_generator) {
    // No modifiers needed — generator runs at nominal by default
  },

  deactivate(_generator) {
    // Nothing to clean up
  },
};
