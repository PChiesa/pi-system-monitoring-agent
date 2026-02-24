import { TagRegistry } from './tag-registry.js';
import { DEFAULT_TAG_PROFILES } from './db/defaults.js';

export type ValueType = 'number' | 'boolean' | 'string';

export interface TagProfile {
  valueType?: ValueType;
  nominal: number;
  sigma: number;
  min?: number;
  max?: number;
  discrete?: boolean;
  booleanDefault?: boolean;
  stringDefault?: string;
  stringOptions?: string[];
}

export interface PIStreamValue {
  Timestamp: string;
  Value: number | boolean | string;
  UnitsAbbreviation: string;
  Good: boolean;
  Questionable: boolean;
  Substituted: boolean;
  Annotated: boolean;
}

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
  value: number | boolean | string;
  profile: TagProfile;
  modifier: ScenarioModifier | null;
  override: number | boolean | string | null;
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
  }

  /** Load profiles from a pre-built map (DB or external source). */
  loadProfiles(profiles: Map<string, TagProfile>): void {
    for (const [tagName, profile] of profiles) {
      if (this.tags.has(tagName)) continue;
      const vt = profile.valueType ?? 'number';
      let initialValue: number | boolean | string;
      if (vt === 'boolean') {
        initialValue = profile.booleanDefault ?? false;
      } else if (vt === 'string') {
        initialValue = profile.stringDefault ?? '';
      } else {
        initialValue = profile.nominal;
      }
      this.tags.set(tagName, {
        value: initialValue,
        profile,
        modifier: null,
        override: null,
      });
      this.history.set(tagName, []);
    }
  }

  /** Load profiles from the built-in defaults (non-DB mode). */
  loadFromDefaults(): void {
    const profiles = new Map<string, TagProfile>();
    for (const meta of this.registry.getAllMeta()) {
      const profile = DEFAULT_TAG_PROFILES[meta.tagName];
      if (profile) profiles.set(meta.tagName, profile);
    }
    this.loadProfiles(profiles);
  }

  /** Register a new tag at runtime (for dynamically created tags). */
  registerTag(tagName: string, profile: TagProfile): void {
    const vt = profile.valueType ?? 'number';
    let initialValue: number | boolean | string;
    if (vt === 'boolean') {
      initialValue = profile.booleanDefault ?? false;
    } else if (vt === 'string') {
      initialValue = profile.stringDefault ?? '';
    } else {
      initialValue = profile.nominal;
    }
    this.tags.set(tagName, {
      value: initialValue,
      profile,
      modifier: null,
      override: null,
    });
    this.history.set(tagName, []);
  }

  /** Remove a tag at runtime. Returns false if tag not found. */
  unregisterTag(tagName: string): boolean {
    if (!this.tags.has(tagName)) return false;
    this.tags.delete(tagName);
    this.history.delete(tagName);
    return true;
  }

  /** Advance all tags by one tick and record history. */
  tick(timestamp = new Date()): Map<string, PIStreamValue> {
    const results = new Map<string, PIStreamValue>();

    for (const [tagName, state] of this.tags) {
      const rawValue = state.override !== null ? state.override : this.generateNext(tagName, state);
      state.value = rawValue;

      const meta = this.registry.getByTagName(tagName);
      const sv: PIStreamValue = {
        Timestamp: timestamp.toISOString(),
        Value: typeof rawValue === 'number' ? Math.round(rawValue * 100) / 100 : rawValue,
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

  /** Update a tag's profile. Changes take effect on the next tick via OU mean-reversion. */
  updateProfile(tagName: string, updates: Partial<TagProfile>): boolean {
    const state = this.tags.get(tagName);
    if (!state) return false;
    state.profile = { ...state.profile, ...updates };
    return true;
  }

  /** Get all tag profiles as a Map. */
  getAllProfiles(): Map<string, TagProfile> {
    const result = new Map<string, TagProfile>();
    for (const [name, state] of this.tags) {
      result.set(name, { ...state.profile });
    }
    return result;
  }

  /** Force a tag to a fixed value, bypassing generation. */
  setOverride(tagName: string, value: number | boolean | string): boolean {
    const state = this.tags.get(tagName);
    if (!state) return false;
    state.override = value;
    return true;
  }

  /** Remove a tag's override, returning it to generated values. */
  clearOverride(tagName: string): boolean {
    const state = this.tags.get(tagName);
    if (!state) return false;
    state.override = null;
    return true;
  }

  /** Check if a tag has an active override. */
  hasOverride(tagName: string): boolean {
    return this.tags.get(tagName)?.override !== null;
  }

  private generateNext(tagName: string, state: TagState): number | boolean | string {
    const { profile, modifier } = state;
    const vt = profile.valueType ?? 'number';

    if (vt === 'boolean') {
      if (modifier && this.scenarioStartTime !== null) {
        const elapsed = Date.now() - this.scenarioStartTime;
        const numResult = modifier(profile.booleanDefault ? 1 : 0, elapsed);
        return numResult >= 0.5;
      }
      return profile.booleanDefault ?? false;
    }

    if (vt === 'string') {
      if (modifier && this.scenarioStartTime !== null) {
        const elapsed = Date.now() - this.scenarioStartTime;
        const numResult = modifier(0, elapsed);
        const options = profile.stringOptions ?? [profile.stringDefault ?? ''];
        const idx = Math.max(0, Math.min(Math.floor(numResult), options.length - 1));
        return options[idx] ?? profile.stringDefault ?? '';
      }
      return profile.stringDefault ?? '';
    }

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
    const currentValue = state.value as number;
    const noise = profile.sigma * Math.sqrt(dt) * randn();
    const drift = THETA * (target - currentValue) * dt;
    let next = currentValue + drift + noise;

    // Clamp
    if (profile.min !== undefined) next = Math.max(profile.min, next);
    if (profile.max !== undefined) next = Math.min(profile.max, next);

    return next;
  }
}
