import { getDb } from './connection.js';
import type { CustomScenarioDefinition } from '../custom-scenario.js';
import { modifierDefinitionSchema } from '../validation.js';
import { z } from 'zod';

interface ScenarioRow {
  id: number;
  name: string;
  description: string;
  duration_ms: number;
  modifiers: unknown;
}

const modifiersArraySchema = z.array(modifierDefinitionSchema);

function rowToDefinition(row: ScenarioRow): CustomScenarioDefinition {
  // Validate modifiers loaded from DB for defense-in-depth
  const modifiers = modifiersArraySchema.parse(row.modifiers);
  return {
    name: row.name,
    description: row.description,
    durationMs: row.duration_ms,
    modifiers,
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
