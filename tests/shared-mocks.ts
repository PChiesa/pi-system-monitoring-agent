/**
 * Shared mock data for test files.
 *
 * Bun's mock.module() patches the global module cache, so mocks leak across
 * test files (https://github.com/oven-sh/bun/issues/12823). To prevent
 * breakage, every mock.module call for a given module MUST include ALL
 * exports that any test file might need. These constants provide the full
 * set of exports for commonly-mocked modules.
 */
import { jest } from 'bun:test';

// ── src/config mock data ──────────────────────────────────────────────

export const MOCK_PI_CONFIG = {
  server: 'test',
  dataArchive: 'test',
  username: 'test',
  password: 'test',
};

export const MOCK_BOP_CONFIG = {
  ratedWorkingPressure: 15000,
  masp: 12500,
  analysisIntervalMs: 300000,
  agentModel: 'sonnet',
};

export const MOCK_MONITORED_TAGS: Record<string, string> = {
  'BOP.ACC.PRESS.SYS': 'PSI',
  'BOP.ACC.PRESS.PRCHG': 'PSI',
  'BOP.ACC.HYD.LEVEL': 'gal',
  'BOP.ACC.HYD.TEMP': '°F',
  'BOP.ANN01.PRESS.CL': 'PSI',
  'BOP.ANN01.POS': '',
  'BOP.ANN01.CLOSETIME': 'sec',
  'BOP.RAM.PIPE01.POS': '',
  'BOP.RAM.PIPE01.CLOSETIME': 'sec',
  'BOP.RAM.BSR01.POS': '',
  'BOP.RAM.BSR01.CLOSETIME': 'sec',
  'BOP.MAN.PRESS.REG': 'PSI',
  'BOP.CHOKE.PRESS': 'PSI',
  'BOP.KILL.PRESS': 'PSI',
  'BOP.CTRL.POD.BLUE.STATUS': '',
  'BOP.CTRL.POD.YELLOW.STATUS': '',
  'BOP.CTRL.BATT.BLUE.VOLTS': 'V',
  'BOP.CTRL.BATT.YELLOW.VOLTS': 'V',
  'WELL.PRESS.CASING': 'PSI',
  'WELL.PRESS.SPP': 'PSI',
  'WELL.FLOW.IN': 'GPM',
  'WELL.FLOW.OUT': 'GPM',
  'WELL.FLOW.DELTA': 'GPM',
  'WELL.PIT.VOL.TOTAL': 'bbl',
  'WELL.PIT.VOL.DELTA': 'bbl',
};

export const MOCK_THRESHOLD_RULES = [
  { tag: 'BOP.ACC.PRESS.SYS', warningLow: 2200, criticalLow: 1200, rateOfChangePer5Min: 200 },
  { tag: 'BOP.ACC.PRESS.PRCHG', warningLow: 900, criticalLow: 800 },
  { tag: 'BOP.ACC.HYD.TEMP', warningHigh: 150, criticalHigh: 180 },
  { tag: 'BOP.ANN01.CLOSETIME', warningHigh: 25, criticalHigh: 30 },
  { tag: 'BOP.RAM.PIPE01.CLOSETIME', warningHigh: 25, criticalHigh: 30 },
  { tag: 'BOP.RAM.BSR01.CLOSETIME', warningHigh: 25, criticalHigh: 30 },
  { tag: 'BOP.MAN.PRESS.REG', warningLow: 1400, warningHigh: 1600, criticalLow: 1300, criticalHigh: 1700 },
  { tag: 'BOP.CTRL.BATT.BLUE.VOLTS', warningLow: 7.5, criticalLow: 6.0 },
  { tag: 'BOP.CTRL.BATT.YELLOW.VOLTS', warningLow: 7.5, criticalLow: 6.0 },
  { tag: 'WELL.PIT.VOL.DELTA', warningHigh: 5, criticalHigh: 10 },
  { tag: 'WELL.FLOW.DELTA', warningHigh: 5, criticalHigh: 20 },
];

/** Full config module mock — use this in every mock.module('../src/config', ...) call. */
export function configMock(overrides: Record<string, any> = {}) {
  return {
    PI_CONFIG: MOCK_PI_CONFIG,
    BOP_CONFIG: MOCK_BOP_CONFIG,
    MONITORED_TAGS: MOCK_MONITORED_TAGS,
    THRESHOLD_RULES: MOCK_THRESHOLD_RULES,
    ...overrides,
  };
}

// ── @anthropic-ai/claude-agent-sdk mock data ──────────────────────────

/** Full SDK module mock — use this in every mock.module('@anthropic-ai/claude-agent-sdk', ...) call. */
export function sdkMock(overrides: Record<string, any> = {}) {
  return {
    query: jest.fn(),
    tool: jest.fn(),
    createSdkMcpServer: jest.fn(),
    ...overrides,
  };
}
