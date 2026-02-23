import { DataGenerator } from './data-generator.js';

import { normalScenario } from './scenarios/normal.js';
import { accumulatorDecayScenario } from './scenarios/accumulator-decay.js';
import { kickDetectionScenario } from './scenarios/kick-detection.js';
import { ramSlowdownScenario } from './scenarios/ram-slowdown.js';
import { podFailureScenario } from './scenarios/pod-failure.js';

export interface Scenario {
  name: string;
  description: string;
  durationMs: number;
  tags: string[];
  activate(generator: DataGenerator): void;
  deactivate(generator: DataGenerator): void;
}

const BUILT_IN_SCENARIOS = ['normal', 'accumulator-decay', 'kick-detection', 'ram-slowdown', 'pod-failure'];

export class ScenarioEngine {
  private scenarios = new Map<string, Scenario>();
  private generator: DataGenerator;
  private activeScenario: { scenario: Scenario; startTime: number; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private autoInterval: ReturnType<typeof setInterval> | null = null;
  private mode: 'manual' | 'auto';

  constructor(generator: DataGenerator, mode: 'auto' | 'manual' = 'auto') {
    this.generator = generator;
    this.mode = mode;

    // Register built-in scenarios
    this.register(normalScenario);
    this.register(accumulatorDecayScenario);
    this.register(kickDetectionScenario);
    this.register(ramSlowdownScenario);
    this.register(podFailureScenario);
  }

  register(scenario: Scenario): void {
    this.scenarios.set(scenario.name, scenario);
  }

  /** Remove a scenario by name. Deactivates it first if active. Returns true if found. */
  unregister(name: string): boolean {
    if (this.activeScenario?.scenario.name === name) {
      this.deactivate();
    }
    return this.scenarios.delete(name);
  }

  /** Check if a scenario is a built-in (non-removable) scenario. */
  isBuiltIn(name: string): boolean {
    return BUILT_IN_SCENARIOS.includes(name);
  }

  /** Activate a scenario by name. Returns true if found and activated. */
  activate(name: string): boolean {
    const scenario = this.scenarios.get(name);
    if (!scenario) return false;

    // Deactivate current if any
    this.deactivate();

    if (name === 'normal') return true; // Normal = no modifiers

    console.log(`[PI Simulator] Activating scenario: ${name} (${scenario.description})`);

    const startTime = Date.now();
    this.generator.setScenarioStartTime(startTime);
    scenario.activate(this.generator);

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (scenario.durationMs > 0) {
      timer = setTimeout(() => {
        console.log(`[PI Simulator] Scenario "${name}" complete, returning to normal`);
        this.deactivate();
      }, scenario.durationMs);
    }

    this.activeScenario = { scenario, startTime, timer };
    return true;
  }

  /** Deactivate the current scenario and return to normal. */
  deactivate(): void {
    if (!this.activeScenario) return;

    const { scenario, timer } = this.activeScenario;
    if (timer) clearTimeout(timer);
    scenario.deactivate(this.generator);
    this.generator.clearAllModifiers();
    this.generator.clearScenarioStartTime();
    this.activeScenario = null;
  }

  /** Start auto mode — randomly activates scenarios on an interval. */
  startAuto(intervalMs = 600_000): void {
    if (this.autoInterval) return;
    this.mode = 'auto';

    const faultScenarios = [...this.scenarios.values()].filter(
      (s) => s.name !== 'normal' && s.durationMs > 0
    );

    console.log(
      `[PI Simulator] Auto mode: random scenarios every ~${Math.round(intervalMs / 60000)} min`
    );

    this.autoInterval = setInterval(() => {
      if (this.activeScenario) return; // Don't overlap scenarios

      const scenario = faultScenarios[Math.floor(Math.random() * faultScenarios.length)]!;
      this.activate(scenario.name);
    }, intervalMs);
  }

  /** Stop auto mode. */
  stopAuto(): void {
    if (this.autoInterval) {
      clearInterval(this.autoInterval);
      this.autoInterval = null;
    }
  }

  /** Get the current scenario name, or 'normal' if none active. */
  getActiveScenarioName(): string {
    return this.activeScenario?.scenario.name ?? 'normal';
  }

  /** Get all registered scenario names and descriptions. */
  listScenarios(): Array<{ name: string; description: string; durationMs: number }> {
    return [...this.scenarios.values()].map((s) => ({
      name: s.name,
      description: s.description,
      durationMs: s.durationMs,
    }));
  }

  getMode(): string {
    return this.mode;
  }
}
