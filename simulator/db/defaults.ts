import type { TagProfile } from '../data-generator.js';
import type { AFModel } from '../af-model.js';

/**
 * Default tag definitions — the 25 monitored tags, duplicated from src/config.ts
 * to avoid importing production code.
 */
export const DEFAULT_TAGS: Record<string, string> = {
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

/** Default tag profiles — per-tag nominal values, noise profiles, and clamp ranges. */
export const DEFAULT_TAG_PROFILES: Record<string, TagProfile> = {
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

/** Seed the default BOP AF hierarchy onto an AFModel instance. */
export function seedDefaultAFHierarchy(afModel: AFModel): void {
  const db = afModel.createDatabase('BOP_Database', 'BOP Monitoring Asset Database');

  const rig = afModel.createElement(db.webId, 'Rig', 'Drilling Rig')!;
  const bopStack = afModel.createElement(rig.webId, 'BOP Stack', 'Blowout Preventer Stack')!;

  // Accumulator System
  const accumulator = afModel.createElement(bopStack.webId, 'Accumulator System', 'Hydraulic accumulator system')!;
  afModel.createAttribute(accumulator.webId, 'System Pressure', 'Double', 'PSI', 'BOP.ACC.PRESS.SYS');
  afModel.createAttribute(accumulator.webId, 'Pre-Charge Pressure', 'Double', 'PSI', 'BOP.ACC.PRESS.PRCHG');
  afModel.createAttribute(accumulator.webId, 'Hydraulic Level', 'Double', 'gal', 'BOP.ACC.HYD.LEVEL');
  afModel.createAttribute(accumulator.webId, 'Hydraulic Temp', 'Double', '°F', 'BOP.ACC.HYD.TEMP');

  // Annular Preventer
  const annular = afModel.createElement(bopStack.webId, 'Annular Preventer', 'Annular BOP preventer')!;
  afModel.createAttribute(annular.webId, 'Close Pressure', 'Double', 'PSI', 'BOP.ANN01.PRESS.CL');
  afModel.createAttribute(annular.webId, 'Position', 'Int32', '', 'BOP.ANN01.POS');
  afModel.createAttribute(annular.webId, 'Close Time', 'Double', 'sec', 'BOP.ANN01.CLOSETIME');

  // Pipe Ram
  const pipeRam = afModel.createElement(bopStack.webId, 'Pipe Ram', 'Pipe ram preventer')!;
  afModel.createAttribute(pipeRam.webId, 'Position', 'Int32', '', 'BOP.RAM.PIPE01.POS');
  afModel.createAttribute(pipeRam.webId, 'Close Time', 'Double', 'sec', 'BOP.RAM.PIPE01.CLOSETIME');

  // Blind Shear Ram
  const bsr = afModel.createElement(bopStack.webId, 'Blind Shear Ram', 'Blind shear ram preventer')!;
  afModel.createAttribute(bsr.webId, 'Position', 'Int32', '', 'BOP.RAM.BSR01.POS');
  afModel.createAttribute(bsr.webId, 'Close Time', 'Double', 'sec', 'BOP.RAM.BSR01.CLOSETIME');

  // Manifold
  const manifold = afModel.createElement(bopStack.webId, 'Manifold', 'Choke and kill manifold')!;
  afModel.createAttribute(manifold.webId, 'Regulated Pressure', 'Double', 'PSI', 'BOP.MAN.PRESS.REG');
  afModel.createAttribute(manifold.webId, 'Choke Pressure', 'Double', 'PSI', 'BOP.CHOKE.PRESS');
  afModel.createAttribute(manifold.webId, 'Kill Pressure', 'Double', 'PSI', 'BOP.KILL.PRESS');

  // Control System
  const controlSystem = afModel.createElement(bopStack.webId, 'Control System', 'BOP control pods')!;

  const bluePod = afModel.createElement(controlSystem.webId, 'Blue Pod', 'Blue control pod')!;
  afModel.createAttribute(bluePod.webId, 'Status', 'Int32', '', 'BOP.CTRL.POD.BLUE.STATUS');
  afModel.createAttribute(bluePod.webId, 'Battery Voltage', 'Double', 'V', 'BOP.CTRL.BATT.BLUE.VOLTS');

  const yellowPod = afModel.createElement(controlSystem.webId, 'Yellow Pod', 'Yellow control pod')!;
  afModel.createAttribute(yellowPod.webId, 'Status', 'Int32', '', 'BOP.CTRL.POD.YELLOW.STATUS');
  afModel.createAttribute(yellowPod.webId, 'Battery Voltage', 'Double', 'V', 'BOP.CTRL.BATT.YELLOW.VOLTS');

  // Wellbore
  const wellbore = afModel.createElement(rig.webId, 'Wellbore', 'Wellbore monitoring')!;
  afModel.createAttribute(wellbore.webId, 'Casing Pressure', 'Double', 'PSI', 'WELL.PRESS.CASING');
  afModel.createAttribute(wellbore.webId, 'Standpipe Pressure', 'Double', 'PSI', 'WELL.PRESS.SPP');
  afModel.createAttribute(wellbore.webId, 'Flow In', 'Double', 'GPM', 'WELL.FLOW.IN');
  afModel.createAttribute(wellbore.webId, 'Flow Out', 'Double', 'GPM', 'WELL.FLOW.OUT');
  afModel.createAttribute(wellbore.webId, 'Flow Delta', 'Double', 'GPM', 'WELL.FLOW.DELTA');
  afModel.createAttribute(wellbore.webId, 'Pit Volume Total', 'Double', 'bbl', 'WELL.PIT.VOL.TOTAL');
  afModel.createAttribute(wellbore.webId, 'Pit Volume Delta', 'Double', 'bbl', 'WELL.PIT.VOL.DELTA');
}
