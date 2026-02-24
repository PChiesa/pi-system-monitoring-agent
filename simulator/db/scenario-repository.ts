import { getDb } from './connection.js';
import type { CustomScenarioDefinition } from '../custom-scenario.js';

interface ScenarioRow {
  id: number;
  name: string;
  description: string;
  duration_ms: number;
  modifiers: unknown;
}

function rowToDefinition(row: ScenarioRow): CustomScenarioDefinition {
  return {
    name: row.name,
    description: row.description,
    durationMs: row.duration_ms,
    modifiers: row.modifiers as CustomScenarioDefinition['modifiers'],
  };
}

export async function loadAllCustomScenarios(): Promise<CustomScenarioDefinition[]> {
  const sql = getDb();
  const rows = await sql<ScenarioRow[]>`SELECT * FROM custom_scenarios ORDER BY id`;
  return rows.map(rowToDefinition);
}

export async function insertCustomScenario(def: CustomScenarioDefinition): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO custom_scenarios (name, description, duration_ms, modifiers)
    VALUES (${def.name}, ${def.description ?? ''}, ${def.durationMs}, ${JSON.stringify(def.modifiers)})
  `;
}

export async function updateCustomScenario(def: CustomScenarioDefinition): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE custom_scenarios
    SET description = ${def.description ?? ''}, duration_ms = ${def.durationMs}, modifiers = ${JSON.stringify(def.modifiers)}, updated_at = now()
    WHERE name = ${def.name}
  `;
}

export async function deleteCustomScenario(name: string): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM custom_scenarios WHERE name = ${name}`;
}
