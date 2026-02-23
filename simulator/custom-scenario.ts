import type { Scenario } from './scenario-engine.js';
import type { DataGenerator, ScenarioModifier } from './data-generator.js';

export type CurveType = 'linear' | 'step' | 'exponential';

export interface ModifierDefinition {
  tagName: string;
  startValue: number;
  endValue: number;
  curveType: CurveType;
}

export interface CustomScenarioDefinition {
  name: string;
  description: string;
  durationMs: number;
  modifiers: ModifierDefinition[];
}

function buildModifier(def: ModifierDefinition, durationMs: number): ScenarioModifier {
  return (_nominal: number, elapsedMs: number): number => {
    const progress = Math.min(elapsedMs / durationMs, 1);
    const range = def.endValue - def.startValue;

    switch (def.curveType) {
      case 'linear':
        return def.startValue + range * progress;
      case 'step':
        return progress < 1 ? def.startValue : def.endValue;
      case 'exponential':
        return def.startValue + range * progress * progress;
      default:
        return def.startValue + range * progress;
    }
  };
}

export function createCustomScenario(def: CustomScenarioDefinition): Scenario {
  const affectedTags = def.modifiers.map((m) => m.tagName);

  return {
    name: def.name,
    description: def.description,
    durationMs: def.durationMs,
    tags: affectedTags,

    activate(generator: DataGenerator): void {
      for (const mod of def.modifiers) {
        generator.setModifier(mod.tagName, buildModifier(mod, def.durationMs));
      }
    },

    deactivate(generator: DataGenerator): void {
      for (const tag of affectedTags) {
        generator.clearModifier(tag);
      }
    },
  };
}
