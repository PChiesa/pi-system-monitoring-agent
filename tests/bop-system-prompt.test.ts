import { jest } from '@jest/globals';

jest.unstable_mockModule('../src/config', () => ({
  BOP_CONFIG: {
    ratedWorkingPressure: 15000,
    masp: 12500,
    analysisIntervalMs: 300000,
    agentModel: 'sonnet',
  },
}));

const { BOP_SYSTEM_PROMPT } = await import('../src/bop-system-prompt');

describe('BOP_SYSTEM_PROMPT', () => {
  it('includes BOP domain expertise sections', () => {
    expect(BOP_SYSTEM_PROMPT).toContain('DOMAIN EXPERTISE');
    expect(BOP_SYSTEM_PROMPT).toContain('OPERATING PARAMETERS');
    expect(BOP_SYSTEM_PROMPT).toContain('SEVERITY DEFINITIONS');
    expect(BOP_SYSTEM_PROMPT).toContain('YOUR BEHAVIOR');
  });

  it('interpolates rated working pressure from config', () => {
    expect(BOP_SYSTEM_PROMPT).toContain('15000 PSI');
  });

  it('interpolates MASP from config', () => {
    expect(BOP_SYSTEM_PROMPT).toContain('12500 PSI');
  });

  it('references API 53 standard', () => {
    expect(BOP_SYSTEM_PROMPT).toContain('API 53');
  });

  it('mentions accumulator, annular, and ram preventers', () => {
    expect(BOP_SYSTEM_PROMPT).toContain('annular preventers');
    expect(BOP_SYSTEM_PROMPT).toContain('ram preventers');
    expect(BOP_SYSTEM_PROMPT).toContain('accumulator');
  });

  it('defines severity levels', () => {
    expect(BOP_SYSTEM_PROMPT).toContain('CRITICAL:');
    expect(BOP_SYSTEM_PROMPT).toContain('WARNING:');
    expect(BOP_SYSTEM_PROMPT).toContain('INFO:');
  });

  it('includes 10 behavioral rules', () => {
    for (let i = 1; i <= 10; i++) {
      expect(BOP_SYSTEM_PROMPT).toContain(`${i}.`);
    }
  });
});
