import { DataGenerator } from './data-generator.js';

export interface Scenario {
  name: string;
  description: string;
  durationMs: number;
  tags: string[];
  activate(generator: DataGenerator): void;
  deactivate(generator: DataGenerator): void;
}

export class ScenarioEngine {
  private scenarios = new Map<string, Scenario>();
  private generator: DataGenerator;
  private activeScenario: { scenario: Scenario; startTime: number; timer: ReturnType<typeof setTimeout> | null } | null = null;
  private autoInterval: ReturnType<typeof setInterval> | null = null;
  private mode: 'manual' | 'auto';

  constructor(generator: DataGenerator, mode: 'auto' | 'manual' = 'auto') {
    this.generator = generator;
    this.mode = mode;
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

  /** Activate a scenario by name. Returns true if found and activated. */
  activate(name: string): boolean {
    const scenario = this.scenarios.get(name);
    if (!scenario) return false;

    // Deactivate current if any
    this.deactivate();

    console.log(`[PI Simulator] Activating scenario: ${name} (${scenario.description})`);

    const startTime = Date.now();
    this.generator.setScenarioStartTime(startTime);
    scenario.activate(this.generator);

    let timer: ReturnType<typeof setTimeout> | null = null;
    if (scenario.durationMs > 0) {
      timer = setTimeout(() => {
        console.log(`[PI Simulator] Scenario "${name}" complete, returning to idle`);
        this.deactivate();
      }, scenario.durationMs);
    }

    this.activeScenario = { scenario, startTime, timer };
    return true;
  }

  /** Deactivate the current scenario and return to idle. */
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

    console.log(
      `[PI Simulator] Auto mode: random scenarios every ~${Math.round(intervalMs / 60000)} min`
    );

    this.autoInterval = setInterval(() => {
      if (this.activeScenario) return; // Don't overlap scenarios

      const available = [...this.scenarios.values()].filter((s) => s.durationMs > 0);
      if (available.length === 0) return;

      const scenario = available[Math.floor(Math.random() * available.length)]!;
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

  /** Get the current scenario name, or 'none' if none active. */
  getActiveScenarioName(): string {
    return this.activeScenario?.scenario.name ?? 'none';
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
