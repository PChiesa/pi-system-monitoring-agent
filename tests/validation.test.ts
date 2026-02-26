import { describe, it, expect } from 'bun:test';
import {
  tagNameSchema,
  tagProfileSchema,
  createTagSchema,
  updateTagProfileSchema,
  setOverrideSchema,
  afNameSchema,
  createAFDatabaseSchema,
  createAFElementSchema,
  createAFAttributeSchema,
  modifierDefinitionSchema,
  customScenarioSchema,
  activateScenarioSchema,
  formatZodError,
} from '../simulator/validation.js';

describe('tagNameSchema', () => {
  it('accepts valid tag names', () => {
    expect(tagNameSchema.parse('BOP.ACC.PRESS.SYS')).toBe('BOP.ACC.PRESS.SYS');
    expect(tagNameSchema.parse('WELL.FLOW.IN')).toBe('WELL.FLOW.IN');
    expect(tagNameSchema.parse('my-tag_01')).toBe('my-tag_01');
  });

  it('rejects empty string', () => {
    expect(() => tagNameSchema.parse('')).toThrow();
  });

  it('rejects names longer than 128 characters', () => {
    expect(() => tagNameSchema.parse('A'.repeat(129))).toThrow();
  });

  it('rejects names with invalid characters', () => {
    expect(() => tagNameSchema.parse('tag name')).toThrow(); // space
    expect(() => tagNameSchema.parse('tag/name')).toThrow(); // slash
    expect(() => tagNameSchema.parse('tag;name')).toThrow(); // semicolon
    expect(() => tagNameSchema.parse('<script>')).toThrow(); // XSS attempt
  });
});

describe('tagProfileSchema', () => {
  it('accepts valid profile', () => {
    const result = tagProfileSchema.parse({ nominal: 3000, sigma: 50, min: 0, max: 5000 });
    expect(result.nominal).toBe(3000);
    expect(result.sigma).toBe(50);
  });

  it('rejects negative sigma', () => {
    expect(() => tagProfileSchema.parse({ nominal: 0, sigma: -1 })).toThrow();
  });

  it('rejects non-finite numbers', () => {
    expect(() => tagProfileSchema.parse({ nominal: Infinity, sigma: 0 })).toThrow();
    expect(() => tagProfileSchema.parse({ nominal: NaN, sigma: 0 })).toThrow();
  });

  it('accepts optional fields', () => {
    const result = tagProfileSchema.parse({ nominal: 100, sigma: 10 });
    expect(result.min).toBeUndefined();
    expect(result.max).toBeUndefined();
  });
});

describe('createTagSchema', () => {
  it('accepts valid create tag payload', () => {
    const result = createTagSchema.parse({
      tagName: 'BOP.TEST.TAG',
      unit: 'PSI',
      profile: { nominal: 3000, sigma: 50 },
    });
    expect(result.tagName).toBe('BOP.TEST.TAG');
  });

  it('rejects missing tagName', () => {
    expect(() => createTagSchema.parse({ profile: { nominal: 0, sigma: 0 } })).toThrow();
  });

  it('rejects missing profile', () => {
    expect(() => createTagSchema.parse({ tagName: 'TEST' })).toThrow();
  });
});

describe('setOverrideSchema', () => {
  it('accepts numeric value', () => {
    expect(setOverrideSchema.parse({ value: 42 }).value).toBe(42);
  });

  it('accepts string value', () => {
    expect(setOverrideSchema.parse({ value: 'OPEN' }).value).toBe('OPEN');
  });

  it('accepts boolean value', () => {
    expect(setOverrideSchema.parse({ value: true }).value).toBe(true);
  });

  it('rejects missing value', () => {
    expect(() => setOverrideSchema.parse({})).toThrow();
  });

  it('rejects null value', () => {
    expect(() => setOverrideSchema.parse({ value: null })).toThrow();
  });
});

describe('afNameSchema', () => {
  it('accepts valid names', () => {
    expect(afNameSchema.parse('BOP Stack')).toBe('BOP Stack');
  });

  it('rejects empty string', () => {
    expect(() => afNameSchema.parse('')).toThrow();
  });

  it('rejects names longer than 256 characters', () => {
    expect(() => afNameSchema.parse('A'.repeat(257))).toThrow();
  });
});

describe('createAFDatabaseSchema', () => {
  it('accepts valid input', () => {
    const result = createAFDatabaseSchema.parse({ name: 'TestDB' });
    expect(result.name).toBe('TestDB');
  });

  it('rejects missing name', () => {
    expect(() => createAFDatabaseSchema.parse({})).toThrow();
  });
});

describe('createAFElementSchema', () => {
  it('accepts valid input', () => {
    const result = createAFElementSchema.parse({ parentWebId: 'abc123', name: 'Element1' });
    expect(result.parentWebId).toBe('abc123');
  });

  it('rejects missing parentWebId', () => {
    expect(() => createAFElementSchema.parse({ name: 'Test' })).toThrow();
  });
});

describe('createAFAttributeSchema', () => {
  it('accepts valid input', () => {
    const result = createAFAttributeSchema.parse({ elementWebId: 'abc123', name: 'Attr1' });
    expect(result.elementWebId).toBe('abc123');
  });
});

describe('modifierDefinitionSchema', () => {
  it('accepts valid modifier', () => {
    const result = modifierDefinitionSchema.parse({
      tagName: 'BOP.ACC.PRESS.SYS',
      startValue: 3000,
      endValue: 1000,
      curveType: 'linear',
    });
    expect(result.curveType).toBe('linear');
  });

  it('rejects invalid curveType', () => {
    expect(() =>
      modifierDefinitionSchema.parse({
        tagName: 'TAG',
        startValue: 0,
        endValue: 100,
        curveType: 'cubic',
      })
    ).toThrow();
  });

  it('rejects non-finite values', () => {
    expect(() =>
      modifierDefinitionSchema.parse({
        tagName: 'TAG',
        startValue: Infinity,
        endValue: 0,
        curveType: 'linear',
      })
    ).toThrow();
  });
});

describe('customScenarioSchema', () => {
  const validScenario = {
    name: 'test-scenario',
    durationMs: 60000,
    modifiers: [{ tagName: 'BOP.TAG', startValue: 0, endValue: 100, curveType: 'linear' as const }],
  };

  it('accepts valid scenario', () => {
    const result = customScenarioSchema.parse(validScenario);
    expect(result.name).toBe('test-scenario');
    expect(result.description).toBe('');
  });

  it('rejects empty name', () => {
    expect(() => customScenarioSchema.parse({ ...validScenario, name: '' })).toThrow();
  });

  it('rejects name longer than 128 characters', () => {
    expect(() => customScenarioSchema.parse({ ...validScenario, name: 'A'.repeat(129) })).toThrow();
  });

  it('rejects durationMs less than 1000', () => {
    expect(() => customScenarioSchema.parse({ ...validScenario, durationMs: 500 })).toThrow();
  });

  it('rejects durationMs greater than 24 hours', () => {
    expect(() => customScenarioSchema.parse({ ...validScenario, durationMs: 86_400_001 })).toThrow();
  });

  it('rejects empty modifiers array', () => {
    expect(() => customScenarioSchema.parse({ ...validScenario, modifiers: [] })).toThrow();
  });

  it('rejects more than 100 modifiers', () => {
    const mods = Array.from({ length: 101 }, (_, i) => ({
      tagName: `TAG.${i}`,
      startValue: 0,
      endValue: 100,
      curveType: 'linear' as const,
    }));
    expect(() => customScenarioSchema.parse({ ...validScenario, modifiers: mods })).toThrow();
  });
});

describe('activateScenarioSchema', () => {
  it('accepts valid input', () => {
    expect(activateScenarioSchema.parse({ name: 'kick-detection' }).name).toBe('kick-detection');
  });

  it('rejects empty name', () => {
    expect(() => activateScenarioSchema.parse({ name: '' })).toThrow();
  });
});

describe('formatZodError', () => {
  it('formats errors concisely', () => {
    const result = tagNameSchema.safeParse('');
    if (!result.success) {
      const msg = formatZodError(result.error);
      expect(msg).toContain('Tag name must not be empty');
    }
  });
});
