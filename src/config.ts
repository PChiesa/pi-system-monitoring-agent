import 'dotenv/config';

export const PI_CONFIG = {
  server: process.env.PI_SERVER!,
  dataArchive: process.env.PI_DATA_ARCHIVE!,
  username: process.env.PI_USERNAME!,
  password: process.env.PI_PASSWORD!,
};

export const BOP_CONFIG = {
  ratedWorkingPressure: Number(process.env.BOP_RWP || 15000),
  masp: Number(process.env.MASP || 12500),
  analysisIntervalMs: Number(process.env.ANALYSIS_INTERVAL_MS || 300000),
  agentModel: process.env.AGENT_MODEL || 'sonnet',
};

// PI tag name → unit mapping
// These are the tags your PI Data Archive must have configured
export const MONITORED_TAGS: Record<string, string> = {
  // Accumulator system
  'BOP.ACC.PRESS.SYS': 'PSI',
  'BOP.ACC.PRESS.PRCHG': 'PSI',
  'BOP.ACC.HYD.LEVEL': 'gal',
  'BOP.ACC.HYD.TEMP': '°F',

  // Annular preventer
  'BOP.ANN01.PRESS.CL': 'PSI',
  'BOP.ANN01.POS': '',
  'BOP.ANN01.CLOSETIME': 'sec',

  // Ram preventers
  'BOP.RAM.PIPE01.POS': '',
  'BOP.RAM.PIPE01.CLOSETIME': 'sec',
  'BOP.RAM.BSR01.POS': '',
  'BOP.RAM.BSR01.CLOSETIME': 'sec',

  // Manifold & lines
  'BOP.MAN.PRESS.REG': 'PSI',
  'BOP.CHOKE.PRESS': 'PSI',
  'BOP.KILL.PRESS': 'PSI',

  // Control system
  'BOP.CTRL.POD.BLUE.STATUS': '',
  'BOP.CTRL.POD.YELLOW.STATUS': '',
  'BOP.CTRL.BATT.BLUE.VOLTS': 'V',
  'BOP.CTRL.BATT.YELLOW.VOLTS': 'V',

  // Wellbore
  'WELL.PRESS.CASING': 'PSI',
  'WELL.PRESS.SPP': 'PSI',
  'WELL.FLOW.IN': 'GPM',
  'WELL.FLOW.OUT': 'GPM',
  'WELL.FLOW.DELTA': 'GPM',
  'WELL.PIT.VOL.TOTAL': 'bbl',
  'WELL.PIT.VOL.DELTA': 'bbl',
};

export interface ThresholdRule {
  tag: string;
  warningLow?: number;
  warningHigh?: number;
  criticalLow?: number;
  criticalHigh?: number;
  rateOfChangePer5Min?: number;
}

export const THRESHOLD_RULES: ThresholdRule[] = [
  // Accumulator
  { tag: 'BOP.ACC.PRESS.SYS', warningLow: 2200, criticalLow: 1200, rateOfChangePer5Min: 200 },
  { tag: 'BOP.ACC.PRESS.PRCHG', warningLow: 900, criticalLow: 800 },
  { tag: 'BOP.ACC.HYD.TEMP', warningHigh: 150, criticalHigh: 180 },

  // Close times (API 53: ≤30 seconds for rams)
  { tag: 'BOP.ANN01.CLOSETIME', warningHigh: 25, criticalHigh: 30 },
  { tag: 'BOP.RAM.PIPE01.CLOSETIME', warningHigh: 25, criticalHigh: 30 },
  { tag: 'BOP.RAM.BSR01.CLOSETIME', warningHigh: 25, criticalHigh: 30 },

  // Manifold pressure (nominal 1,500 PSI)
  {
    tag: 'BOP.MAN.PRESS.REG',
    warningLow: 1400,
    warningHigh: 1600,
    criticalLow: 1300,
    criticalHigh: 1700,
  },

  // Control pod batteries
  { tag: 'BOP.CTRL.BATT.BLUE.VOLTS', warningLow: 7.5, criticalLow: 6.0 },
  { tag: 'BOP.CTRL.BATT.YELLOW.VOLTS', warningLow: 7.5, criticalLow: 6.0 },

  // Well control indicators
  { tag: 'WELL.PIT.VOL.DELTA', warningHigh: 5, criticalHigh: 10 },
  { tag: 'WELL.FLOW.DELTA', warningHigh: 5, criticalHigh: 20 },
];
