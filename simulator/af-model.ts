import type { AFDatabaseRow, AFElementRow, AFAttributeRow } from './db/af-repository.js';
import { seedDefaultAFHierarchy } from './db/defaults.js';

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

  /** Maps webId → DB row id for persisted entities. */
  private dbIdByWebId = new Map<string, number>();

  constructor(dataArchive = 'SIMULATOR') {
    this.dataArchive = dataArchive;
  }

  // ── DB ID tracking ──────────────────────────────────────────────────────

  getDbId(webId: string): number | undefined {
    return this.dbIdByWebId.get(webId);
  }

  setDbId(webId: string, id: number): void {
    this.dbIdByWebId.set(webId, id);
  }

  // ── Bulk loading ────────────────────────────────────────────────────────

  /** Reconstruct the AF tree from flat DB rows. */
  loadFromDatabase(
    dbRows: AFDatabaseRow[],
    elementRows: AFElementRow[],
    attrRows: AFAttributeRow[]
  ): void {
    // Build databases
    const dbIdToWebId = new Map<number, string>();
    for (const row of dbRows) {
      const path = `\\\\${this.dataArchive}\\${row.name}`;
      const webId = makeDbWebId(row.name);
      const db: AFDatabase = {
        webId,
        id: row.uuid,
        name: row.name,
        description: row.description,
        path,
        elements: [],
      };
      this.databases.set(webId, db);
      this.dbIdByWebId.set(webId, row.id);
      dbIdToWebId.set(row.id, webId);
    }

    // Build elements — first pass: create all, second pass: wire parent/child
    const elIdToWebId = new Map<number, string>();
    const elementsByDbRowId = new Map<number, AFElement>();

    // First pass: create elements (path depends on parent, so we need topo order)
    // Elements are ordered by id (insertion order), parents before children
    const pendingElements = [...elementRows];
    const processedIds = new Set<number>();

    // Iteratively resolve elements whose parent is already processed
    let maxPasses = pendingElements.length + 1;
    while (pendingElements.length > 0 && maxPasses-- > 0) {
      const remaining: AFElementRow[] = [];
      for (const row of pendingElements) {
        const dbWebId = dbIdToWebId.get(row.database_id);
        if (!dbWebId) { remaining.push(row); continue; }

        let parentPath: string;
        let parentWebId: string | null = null;

        if (row.parent_id === null) {
          // Root element
          const db = this.databases.get(dbWebId);
          if (!db) { remaining.push(row); continue; }
          parentPath = db.path;
        } else {
          // Child element — parent must be processed first
          if (!processedIds.has(row.parent_id)) { remaining.push(row); continue; }
          const parentEl = elementsByDbRowId.get(row.parent_id);
          if (!parentEl) { remaining.push(row); continue; }
          parentPath = parentEl.path;
          parentWebId = parentEl.webId;
        }

        const path = `${parentPath}\\${row.name}`;
        const webId = makeElementWebId(path);
        const el: AFElement = {
          webId,
          id: row.uuid,
          name: row.name,
          description: row.description,
          path,
          parentWebId,
          databaseWebId: dbWebId,
          children: [],
          attributes: [],
        };

        this.elementsByWebId.set(webId, el);
        this.dbIdByWebId.set(webId, row.id);
        elIdToWebId.set(row.id, webId);
        elementsByDbRowId.set(row.id, el);
        processedIds.add(row.id);

        // Attach to parent
        if (parentWebId) {
          const parent = this.elementsByWebId.get(parentWebId);
          if (parent) parent.children.push(el);
        } else {
          const db = this.databases.get(dbWebId);
          if (db) db.elements.push(el);
        }
      }
      pendingElements.length = 0;
      pendingElements.push(...remaining);
    }

    // Build attributes
    for (const row of attrRows) {
      const elWebId = elIdToWebId.get(row.element_id);
      if (!elWebId) continue;
      const el = this.elementsByWebId.get(elWebId);
      if (!el) continue;

      const path = `${el.path}|${row.name}`;
      const webId = makeAttributeWebId(path);
      const attr: AFAttribute = {
        webId,
        id: row.uuid,
        name: row.name,
        description: row.description,
        path,
        type: row.type,
        defaultUOM: row.default_uom,
        dataReference: row.pi_point_name ? 'PI Point' : '',
        piPointName: row.pi_point_name,
        elementWebId: elWebId,
      };

      el.attributes.push(attr);
      this.attributesByWebId.set(webId, attr);
      this.dbIdByWebId.set(webId, row.id);
    }
  }

  /** Populate with the built-in BOP hierarchy (non-DB mode). */
  loadFromDefaults(): void {
    seedDefaultAFHierarchy(this);
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
        this.dbIdByWebId.delete(attr.webId);
      }
      this.elementsByWebId.delete(element.webId);
      this.dbIdByWebId.delete(element.webId);
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
    this.dbIdByWebId.delete(webId);
    return true;
  }
}
