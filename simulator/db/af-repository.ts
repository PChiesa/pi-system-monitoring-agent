import { getDb } from './connection.js';

export interface AFDatabaseRow {
  id: number;
  uuid: string;
  name: string;
  description: string;
}

export interface AFElementRow {
  id: number;
  uuid: string;
  name: string;
  description: string;
  database_id: number;
  parent_id: number | null;
}

export interface AFAttributeRow {
  id: number;
  uuid: string;
  name: string;
  description: string;
  type: string;
  default_uom: string;
  pi_point_name: string | null;
  element_id: number;
}

export async function loadAllDatabases(): Promise<AFDatabaseRow[]> {
  const sql = getDb();
  return sql<AFDatabaseRow[]>`SELECT * FROM af_databases ORDER BY id`;
}

export async function loadAllElements(): Promise<AFElementRow[]> {
  const sql = getDb();
  return sql<AFElementRow[]>`SELECT * FROM af_elements ORDER BY id`;
}

export async function loadAllAttributes(): Promise<AFAttributeRow[]> {
  const sql = getDb();
  return sql<AFAttributeRow[]>`SELECT * FROM af_attributes ORDER BY id`;
}

export async function insertDatabase(name: string, description: string): Promise<AFDatabaseRow> {
  const sql = getDb();
  const [row] = await sql<AFDatabaseRow[]>`
    INSERT INTO af_databases (name, description) VALUES (${name}, ${description})
    RETURNING *
  `;
  return row!;
}

export async function insertElement(
  name: string,
  description: string,
  databaseId: number,
  parentId: number | null
): Promise<AFElementRow> {
  const sql = getDb();
  const [row] = await sql<AFElementRow[]>`
    INSERT INTO af_elements (name, description, database_id, parent_id)
    VALUES (${name}, ${description}, ${databaseId}, ${parentId})
    RETURNING *
  `;
  return row!;
}

export async function insertAttribute(
  name: string,
  description: string,
  type: string,
  defaultUom: string,
  piPointName: string | null,
  elementId: number
): Promise<AFAttributeRow> {
  const sql = getDb();
  const [row] = await sql<AFAttributeRow[]>`
    INSERT INTO af_attributes (name, description, type, default_uom, pi_point_name, element_id)
    VALUES (${name}, ${description}, ${type}, ${defaultUom}, ${piPointName}, ${elementId})
    RETURNING *
  `;
  return row!;
}

export async function updateElement(id: number, updates: { name?: string; description?: string }): Promise<void> {
  const sql = getDb();
  if (updates.name !== undefined && updates.description !== undefined) {
    await sql`UPDATE af_elements SET name = ${updates.name}, description = ${updates.description} WHERE id = ${id}`;
  } else if (updates.name !== undefined) {
    await sql`UPDATE af_elements SET name = ${updates.name} WHERE id = ${id}`;
  } else if (updates.description !== undefined) {
    await sql`UPDATE af_elements SET description = ${updates.description} WHERE id = ${id}`;
  }
}

export async function updateAttribute(
  id: number,
  updates: { name?: string; description?: string; type?: string; defaultUom?: string; piPointName?: string | null }
): Promise<void> {
  const sql = getDb();
  const sets: Record<string, unknown> = {};
  if (updates.name !== undefined) sets.name = updates.name;
  if (updates.description !== undefined) sets.description = updates.description;
  if (updates.type !== undefined) sets.type = updates.type;
  if (updates.defaultUom !== undefined) sets.default_uom = updates.defaultUom;
  if (updates.piPointName !== undefined) sets.pi_point_name = updates.piPointName;
  if (Object.keys(sets).length === 0) return;
  await sql`UPDATE af_attributes SET ${sql(sets)} WHERE id = ${id}`;
}

export async function deleteElement(id: number): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM af_elements WHERE id = ${id}`;
}

export async function deleteAttribute(id: number): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM af_attributes WHERE id = ${id}`;
}
