import { jest } from '@jest/globals';

// Config values are evaluated at import time so we test them by importing
// with controlled env vars. Since ESM caches modules, we use
// jest.unstable_mockModule + dynamic import patterns.

describe('config', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('exports MONITORED_TAGS with 25 tags', async () => {
    process.env.PI_SERVER = 'test';
    process.env.PI_DATA_ARCHIVE = 'test';
    process.env.PI_USERNAME = 'test';
    process.env.PI_PASSWORD = 'test';

    const { MONITORED_TAGS } = await import('../src/config');
    const tags = Object.keys(MONITORED_TAGS);
    expect(tags.length).toBe(25);
    expect(MONITORED_TAGS['BOP.ACC.PRESS.SYS']).toBe('PSI');
    expect(MONITORED_TAGS['WELL.FLOW.DELTA']).toBe('GPM');
  });

  it('exports THRESHOLD_RULES with 11 rules', async () => {
    const { THRESHOLD_RULES } = await import('../src/config');
    expect(THRESHOLD_RULES.length).toBe(11);
  });

  it('THRESHOLD_RULES contains accumulator pressure rule with correct values', async () => {
    const { THRESHOLD_RULES } = await import('../src/config');
    const accRule = THRESHOLD_RULES.find((r) => r.tag === 'BOP.ACC.PRESS.SYS');
    expect(accRule).toBeDefined();
    expect(accRule!.warningLow).toBe(2200);
    expect(accRule!.criticalLow).toBe(1200);
    expect(accRule!.rateOfChangePer5Min).toBe(200);
  });

  it('THRESHOLD_RULES contains manifold pressure rule with bidirectional thresholds', async () => {
    const { THRESHOLD_RULES } = await import('../src/config');
    const manRule = THRESHOLD_RULES.find((r) => r.tag === 'BOP.MAN.PRESS.REG');
    expect(manRule).toBeDefined();
    expect(manRule!.warningLow).toBe(1400);
    expect(manRule!.warningHigh).toBe(1600);
    expect(manRule!.criticalLow).toBe(1300);
    expect(manRule!.criticalHigh).toBe(1700);
  });

  it('MONITORED_TAGS includes all subsystem categories', async () => {
    const { MONITORED_TAGS } = await import('../src/config');
    const tags = Object.keys(MONITORED_TAGS);

    // Accumulator
    expect(tags.some((t) => t.startsWith('BOP.ACC.'))).toBe(true);
    // Annular
    expect(tags.some((t) => t.startsWith('BOP.ANN'))).toBe(true);
    // Rams
    expect(tags.some((t) => t.startsWith('BOP.RAM.'))).toBe(true);
    // Control
    expect(tags.some((t) => t.startsWith('BOP.CTRL.'))).toBe(true);
    // Well
    expect(tags.some((t) => t.startsWith('WELL.'))).toBe(true);
  });

  it('THRESHOLD_RULES covers close time limits for rams and annular', async () => {
    const { THRESHOLD_RULES } = await import('../src/config');

    const closeTimeRules = THRESHOLD_RULES.filter((r) =>
      r.tag.includes('CLOSETIME')
    );
    expect(closeTimeRules.length).toBe(3);

    // All close time critical limits should be 30 (API 53)
    for (const rule of closeTimeRules) {
      expect(rule.criticalHigh).toBe(30);
      expect(rule.warningHigh).toBe(25);
    }
  });
});
