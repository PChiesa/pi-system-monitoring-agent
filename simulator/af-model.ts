import { TagRegistry } from './tag-registry.js';

// ── AF Types ──────────────────────────────────────────────────────────────────

export interface AFDatabase {
  webId: string;
  id: string;
  name: string;
  description: string;
  path: string;
  elements: AFElement[];
}

export interface AFElement {
  webId: string;
  id: string;
  name: string;
  description: string;
  path: string;
  parentWebId: string | null;
  databaseWebId: string;
  children: AFElement[];
  attributes: AFAttribute[];
}

export interface AFAttribute {
  webId: string;
  id: string;
  name: string;
  description: string;
  path: string;
  type: string;
  defaultUOM: string;
  dataReference: string;
  piPointName: string | null;
  elementWebId: string;
}

// ── WebId helpers ─────────────────────────────────────────────────────────────

function makeDbWebId(name: string): string {
  return 'AFDB_' + Buffer.from(name).toString('base64url');
}

function makeElementWebId(path: string): string {
  return 'AFEL_' + Buffer.from(path).toString('base64url');
}

function makeAttributeWebId(path: string): string {
  return 'AFAT_' + Buffer.from(path).toString('base64url');
}

function uuid(): string {
  return crypto.randomUUID();
}

// ── AFModel ───────────────────────────────────────────────────────────────────

export class AFModel {
  private databases = new Map<string, AFDatabase>();
  private elementsByWebId = new Map<string, AFElement>();
  private attributesByWebId = new Map<string, AFAttribute>();
  private dataArchive: string;

  constructor(registry: TagRegistry) {
    this.dataArchive = registry.dataArchive;
    this.seed();
  }

  // ── Lookup ────────────────────────────────────────────────────────────────

  getDatabases(): AFDatabase[] {
    return [...this.databases.values()];
  }

  getDatabase(webId: string): AFDatabase | undefined {
    return this.databases.get(webId);
  }

  getRootElements(dbWebId: string): AFElement[] {
    const db = this.databases.get(dbWebId);
    return db ? db.elements : [];
  }

  getElement(webId: string): AFElement | undefined {
    return this.elementsByWebId.get(webId);
  }

  getChildElements(elementWebId: string): AFElement[] {
    return this.elementsByWebId.get(elementWebId)?.children ?? [];
  }

  getAttributes(elementWebId: string): AFAttribute[] {
    return this.elementsByWebId.get(elementWebId)?.attributes ?? [];
  }

  getAttribute(webId: string): AFAttribute | undefined {
    return this.attributesByWebId.get(webId);
  }

  getAttributeTagName(attrWebId: string): string | undefined {
    return this.attributesByWebId.get(attrWebId)?.piPointName ?? undefined;
  }

  isElementWebId(webId: string): boolean {
    return this.elementsByWebId.has(webId);
  }

  isAttributeWebId(webId: string): boolean {
    return this.attributesByWebId.has(webId);
  }

  isDatabaseWebId(webId: string): boolean {
    return this.databases.has(webId);
  }

  // ── CRUD ──────────────────────────────────────────────────────────────────

  createDatabase(name: string, description: string): AFDatabase {
    const path = `\\\\${this.dataArchive}\\${name}`;
    const db: AFDatabase = {
      webId: makeDbWebId(name),
      id: uuid(),
      name,
      description,
      path,
      elements: [],
    };
    this.databases.set(db.webId, db);
    return db;
  }

  createElement(
    parentWebId: string,
    name: string,
    description: string
  ): AFElement | null {
    // Parent can be a database (root element) or another element
    let parentPath: string;
    let databaseWebId: string;
    let parentChildren: AFElement[];

    const parentDb = this.databases.get(parentWebId);
    if (parentDb) {
      parentPath = parentDb.path;
      databaseWebId = parentDb.webId;
      parentChildren = parentDb.elements;
    } else {
      const parentEl = this.elementsByWebId.get(parentWebId);
      if (!parentEl) return null;
      parentPath = parentEl.path;
      databaseWebId = parentEl.databaseWebId;
      parentChildren = parentEl.children;
    }

    const path = `${parentPath}\\${name}`;
    const el: AFElement = {
      webId: makeElementWebId(path),
      id: uuid(),
      name,
      description,
      path,
      parentWebId: this.databases.has(parentWebId) ? null : parentWebId,
      databaseWebId,
      children: [],
      attributes: [],
    };

    parentChildren.push(el);
    this.elementsByWebId.set(el.webId, el);
    return el;
  }

  createAttribute(
    elementWebId: string,
    name: string,
    type: string,
    defaultUOM: string,
    piPointName: string | null,
    description = ''
  ): AFAttribute | null {
    const el = this.elementsByWebId.get(elementWebId);
    if (!el) return null;

    const path = `${el.path}|${name}`;
    const attr: AFAttribute = {
      webId: makeAttributeWebId(path),
      id: uuid(),
      name,
      description,
      path,
      type,
      defaultUOM,
      dataReference: piPointName ? 'PI Point' : '',
      piPointName,
      elementWebId,
    };

    el.attributes.push(attr);
    this.attributesByWebId.set(attr.webId, attr);
    return attr;
  }

  updateElement(webId: string, updates: { name?: string; description?: string }): boolean {
    const el = this.elementsByWebId.get(webId);
    if (!el) return false;
    if (updates.name !== undefined) el.name = updates.name;
    if (updates.description !== undefined) el.description = updates.description;
    return true;
  }

  updateAttribute(
    webId: string,
    updates: { name?: string; description?: string; piPointName?: string | null; type?: string; defaultUOM?: string }
  ): boolean {
    const attr = this.attributesByWebId.get(webId);
    if (!attr) return false;
    if (updates.name !== undefined) attr.name = updates.name;
    if (updates.description !== undefined) attr.description = updates.description;
    if (updates.type !== undefined) attr.type = updates.type;
    if (updates.defaultUOM !== undefined) attr.defaultUOM = updates.defaultUOM;
    if (updates.piPointName !== undefined) {
      attr.piPointName = updates.piPointName;
      attr.dataReference = updates.piPointName ? 'PI Point' : '';
    }
    return true;
  }

  deleteElement(webId: string): boolean {
    const el = this.elementsByWebId.get(webId);
    if (!el) return false;

    // Recursively delete children and their attributes
    const deleteRecursive = (element: AFElement) => {
      for (const child of element.children) {
        deleteRecursive(child);
      }
      for (const attr of element.attributes) {
        this.attributesByWebId.delete(attr.webId);
      }
      this.elementsByWebId.delete(element.webId);
    };
    deleteRecursive(el);

    // Remove from parent
    if (el.parentWebId) {
      const parent = this.elementsByWebId.get(el.parentWebId);
      if (parent) {
        parent.children = parent.children.filter((c) => c.webId !== webId);
      }
    } else {
      // Root element — remove from database
      for (const db of this.databases.values()) {
        db.elements = db.elements.filter((e) => e.webId !== webId);
      }
    }

    return true;
  }

  deleteAttribute(webId: string): boolean {
    const attr = this.attributesByWebId.get(webId);
    if (!attr) return false;

    const el = this.elementsByWebId.get(attr.elementWebId);
    if (el) {
      el.attributes = el.attributes.filter((a) => a.webId !== webId);
    }
    this.attributesByWebId.delete(webId);
    return true;
  }

  // ── Seed default BOP hierarchy ────────────────────────────────────────────

  private seed(): void {
    const db = this.createDatabase('BOP_Database', 'BOP Monitoring Asset Database');

    const rig = this.createElement(db.webId, 'Rig', 'Drilling Rig')!;
    const bopStack = this.createElement(rig.webId, 'BOP Stack', 'Blowout Preventer Stack')!;

    // Accumulator System
    const accumulator = this.createElement(bopStack.webId, 'Accumulator System', 'Hydraulic accumulator system')!;
    this.createAttribute(accumulator.webId, 'System Pressure', 'Double', 'PSI', 'BOP.ACC.PRESS.SYS');
    this.createAttribute(accumulator.webId, 'Pre-Charge Pressure', 'Double', 'PSI', 'BOP.ACC.PRESS.PRCHG');
    this.createAttribute(accumulator.webId, 'Hydraulic Level', 'Double', 'gal', 'BOP.ACC.HYD.LEVEL');
    this.createAttribute(accumulator.webId, 'Hydraulic Temp', 'Double', '°F', 'BOP.ACC.HYD.TEMP');

    // Annular Preventer
    const annular = this.createElement(bopStack.webId, 'Annular Preventer', 'Annular BOP preventer')!;
    this.createAttribute(annular.webId, 'Close Pressure', 'Double', 'PSI', 'BOP.ANN01.PRESS.CL');
    this.createAttribute(annular.webId, 'Position', 'Int32', '', 'BOP.ANN01.POS');
    this.createAttribute(annular.webId, 'Close Time', 'Double', 'sec', 'BOP.ANN01.CLOSETIME');

    // Pipe Ram
    const pipeRam = this.createElement(bopStack.webId, 'Pipe Ram', 'Pipe ram preventer')!;
    this.createAttribute(pipeRam.webId, 'Position', 'Int32', '', 'BOP.RAM.PIPE01.POS');
    this.createAttribute(pipeRam.webId, 'Close Time', 'Double', 'sec', 'BOP.RAM.PIPE01.CLOSETIME');

    // Blind Shear Ram
    const bsr = this.createElement(bopStack.webId, 'Blind Shear Ram', 'Blind shear ram preventer')!;
    this.createAttribute(bsr.webId, 'Position', 'Int32', '', 'BOP.RAM.BSR01.POS');
    this.createAttribute(bsr.webId, 'Close Time', 'Double', 'sec', 'BOP.RAM.BSR01.CLOSETIME');

    // Manifold
    const manifold = this.createElement(bopStack.webId, 'Manifold', 'Choke and kill manifold')!;
    this.createAttribute(manifold.webId, 'Regulated Pressure', 'Double', 'PSI', 'BOP.MAN.PRESS.REG');
    this.createAttribute(manifold.webId, 'Choke Pressure', 'Double', 'PSI', 'BOP.CHOKE.PRESS');
    this.createAttribute(manifold.webId, 'Kill Pressure', 'Double', 'PSI', 'BOP.KILL.PRESS');

    // Control System
    const controlSystem = this.createElement(bopStack.webId, 'Control System', 'BOP control pods')!;

    const bluePod = this.createElement(controlSystem.webId, 'Blue Pod', 'Blue control pod')!;
    this.createAttribute(bluePod.webId, 'Status', 'Int32', '', 'BOP.CTRL.POD.BLUE.STATUS');
    this.createAttribute(bluePod.webId, 'Battery Voltage', 'Double', 'V', 'BOP.CTRL.BATT.BLUE.VOLTS');

    const yellowPod = this.createElement(controlSystem.webId, 'Yellow Pod', 'Yellow control pod')!;
    this.createAttribute(yellowPod.webId, 'Status', 'Int32', '', 'BOP.CTRL.POD.YELLOW.STATUS');
    this.createAttribute(yellowPod.webId, 'Battery Voltage', 'Double', 'V', 'BOP.CTRL.BATT.YELLOW.VOLTS');

    // Wellbore
    const wellbore = this.createElement(rig.webId, 'Wellbore', 'Wellbore monitoring')!;
    this.createAttribute(wellbore.webId, 'Casing Pressure', 'Double', 'PSI', 'WELL.PRESS.CASING');
    this.createAttribute(wellbore.webId, 'Standpipe Pressure', 'Double', 'PSI', 'WELL.PRESS.SPP');
    this.createAttribute(wellbore.webId, 'Flow In', 'Double', 'GPM', 'WELL.FLOW.IN');
    this.createAttribute(wellbore.webId, 'Flow Out', 'Double', 'GPM', 'WELL.FLOW.OUT');
    this.createAttribute(wellbore.webId, 'Flow Delta', 'Double', 'GPM', 'WELL.FLOW.DELTA');
    this.createAttribute(wellbore.webId, 'Pit Volume Total', 'Double', 'bbl', 'WELL.PIT.VOL.TOTAL');
    this.createAttribute(wellbore.webId, 'Pit Volume Delta', 'Double', 'bbl', 'WELL.PIT.VOL.DELTA');
  }
}
