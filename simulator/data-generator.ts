import { TagRegistry } from './tag-registry.js';

export interface TagProfile {
  nominal: number;
  sigma: number;
  min?: number;
  max?: number;
  discrete?: boolean;
}

export interface PIStreamValue {
  Timestamp: string;
  Value: number;
  UnitsAbbreviation: string;
  Good: boolean;
  Questionable: boolean;
  Substituted: boolean;
  Annotated: boolean;
}

/** Per-tag nominal values, noise profiles, and clamp ranges. */
const TAG_PROFILES: Record<string, TagProfile> = {
  'BOP.ACC.PRESS.SYS':          { nominal: 3000,  sigma: 15,  min: 0 },
  'BOP.ACC.PRESS.PRCHG':        { nominal: 1000,  sigma: 5,   min: 0 },
  'BOP.ACC.HYD.LEVEL':          { nominal: 80,    sigma: 2,   min: 0, max: 100 },
  'BOP.ACC.HYD.TEMP':           { nominal: 120,   sigma: 3,   min: 50 },
  'BOP.ANN01.PRESS.CL':         { nominal: 750,   sigma: 10,  min: 0 },
  'BOP.ANN01.POS':              { nominal: 0,     sigma: 0,   min: 0, max: 100, discrete: true },
  'BOP.ANN01.CLOSETIME':        { nominal: 18,    sigma: 1.5, min: 0 },
  'BOP.RAM.PIPE01.POS':         { nominal: 0,     sigma: 0,   min: 0, max: 100, discrete: true },
  'BOP.RAM.PIPE01.CLOSETIME':   { nominal: 15,    sigma: 1.0, min: 0 },
  'BOP.RAM.BSR01.POS':          { nominal: 0,     sigma: 0,   min: 0, max: 100, discrete: true },
  'BOP.RAM.BSR01.CLOSETIME':    { nominal: 16,    sigma: 1.2, min: 0 },
  'BOP.MAN.PRESS.REG':          { nominal: 1500,  sigma: 8,   min: 0 },
  'BOP.CHOKE.PRESS':            { nominal: 200,   sigma: 15,  min: 0 },
  'BOP.KILL.PRESS':             { nominal: 200,   sigma: 15,  min: 0 },
  'BOP.CTRL.POD.BLUE.STATUS':   { nominal: 1,     sigma: 0,   min: 0, max: 1, discrete: true },
  'BOP.CTRL.POD.YELLOW.STATUS': { nominal: 1,     sigma: 0,   min: 0, max: 1, discrete: true },
  'BOP.CTRL.BATT.BLUE.VOLTS':   { nominal: 12.0,  sigma: 0.1, min: 0 },
  'BOP.CTRL.BATT.YELLOW.VOLTS': { nominal: 12.0,  sigma: 0.1, min: 0 },
  'WELL.PRESS.CASING':          { nominal: 500,   sigma: 20,  min: 0 },
  'WELL.PRESS.SPP':             { nominal: 3200,  sigma: 50,  min: 0 },
  'WELL.FLOW.IN':               { nominal: 600,   sigma: 10,  min: 0 },
  'WELL.FLOW.OUT':              { nominal: 600,   sigma: 10,  min: 0 },
  'WELL.FLOW.DELTA':            { nominal: 0,     sigma: 1.5 },
  'WELL.PIT.VOL.TOTAL':         { nominal: 800,   sigma: 0.5, min: 0 },
  'WELL.PIT.VOL.DELTA':         { nominal: 0,     sigma: 0.3 },
};

/** Mean-reversion speed for the Ornstein-Uhlenbeck process. */
const THETA = 0.1;

/** Standard normal random variable (Box-Muller). */
function randn(): number {
  const u1 = Math.random();
  const u2 = Math.random();
  return Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
}

export type ScenarioModifier = (currentNominal: number, elapsedMs: number) => number;

interface TagState {
  value: number;
  profile: TagProfile;
  modifier: ScenarioModifier | null;
}

export class DataGenerator {
  private tags = new Map<string, TagState>();
  private history = new Map<string, PIStreamValue[]>();
  private registry: TagRegistry;
  private scenarioStartTime: number | null = null;

  /** Max history entries per tag (1 hour at 1 Hz). */
  private maxHistory = 3600;

  constructor(registry: TagRegistry) {
    this.registry = registry;

    for (const meta of registry.getAllMeta()) {
      const profile = TAG_PROFILES[meta.tagName];
      if (!profile) continue;

      this.tags.set(meta.tagName, {
        value: profile.nominal,
        profile,
        modifier: null,
      });
      this.history.set(meta.tagName, []);
    }
  }

  /** Advance all tags by one tick and record history. */
  tick(timestamp = new Date()): Map<string, PIStreamValue> {
    const results = new Map<string, PIStreamValue>();

    for (const [tagName, state] of this.tags) {
      const value = this.generateNext(tagName, state);
      state.value = value;

      const meta = this.registry.getByTagName(tagName);
      const sv: PIStreamValue = {
        Timestamp: timestamp.toISOString(),
        Value: Math.round(value * 100) / 100,
        UnitsAbbreviation: meta?.unit ?? '',
        Good: true,
        Questionable: false,
        Substituted: false,
        Annotated: false,
      };

      results.set(tagName, sv);

      // Append to history ring buffer
      const hist = this.history.get(tagName)!;
      hist.push(sv);
      if (hist.length > this.maxHistory) {
        hist.shift();
      }
    }

    return results;
  }

  /** Get the current value for a tag. */
  getCurrentValue(tagName: string): PIStreamValue | undefined {
    const hist = this.history.get(tagName);
    if (!hist || hist.length === 0) return undefined;
    return hist[hist.length - 1];
  }

  /** Get historical values within a time range, up to maxCount. */
  getHistory(tagName: string, startTime: Date, endTime: Date, maxCount: number): PIStreamValue[] {
    const hist = this.history.get(tagName);
    if (!hist) return [];

    const startMs = startTime.getTime();
    const endMs = endTime.getTime();

    // Filter to time range
    const filtered = hist.filter((sv) => {
      const t = new Date(sv.Timestamp).getTime();
      return t >= startMs && t <= endMs;
    });

    // Downsample if needed
    if (filtered.length <= maxCount) return filtered;

    const step = filtered.length / maxCount;
    const sampled: PIStreamValue[] = [];
    for (let i = 0; i < maxCount; i++) {
      sampled.push(filtered[Math.floor(i * step)]!);
    }
    return sampled;
  }

  /** Apply a scenario modifier to a tag. */
  setModifier(tagName: string, modifier: ScenarioModifier): void {
    const state = this.tags.get(tagName);
    if (state) {
      state.modifier = modifier;
    }
  }

  /** Remove modifier from a tag and return it to nominal. */
  clearModifier(tagName: string): void {
    const state = this.tags.get(tagName);
    if (state) {
      state.modifier = null;
    }
  }

  /** Clear all modifiers (return to normal). */
  clearAllModifiers(): void {
    for (const state of this.tags.values()) {
      state.modifier = null;
    }
  }

  setScenarioStartTime(time: number): void {
    this.scenarioStartTime = time;
  }

  clearScenarioStartTime(): void {
    this.scenarioStartTime = null;
  }

  /** Get the profile for a tag (for scenarios to read nominal values). */
  getProfile(tagName: string): TagProfile | undefined {
    return this.tags.get(tagName)?.profile;
  }

  private generateNext(tagName: string, state: TagState): number {
    const { profile, modifier } = state;

    if (profile.discrete) {
      // Discrete tags: use modifier target or hold nominal
      if (modifier && this.scenarioStartTime !== null) {
        const elapsed = Date.now() - this.scenarioStartTime;
        return modifier(profile.nominal, elapsed);
      }
      return profile.nominal;
    }

    // Determine target (nominal or scenario-modified)
    let target = profile.nominal;
    if (modifier && this.scenarioStartTime !== null) {
      const elapsed = Date.now() - this.scenarioStartTime;
      target = modifier(profile.nominal, elapsed);
    }

    // Ornstein-Uhlenbeck: mean-reverts toward target
    const dt = 1; // 1 second tick
    const noise = profile.sigma * Math.sqrt(dt) * randn();
    const drift = THETA * (target - state.value) * dt;
    let next = state.value + drift + noise;

    // Clamp
    if (profile.min !== undefined) next = Math.max(profile.min, next);
    if (profile.max !== undefined) next = Math.min(profile.max, next);

    return next;
  }
}
