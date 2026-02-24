import { getDb } from './connection.js';
import type { TagProfile } from '../data-generator.js';

export interface TagRow {
  id: number;
  tag_name: string;
  unit: string;
  custom_group: string | null;
  value_type: string;
  nominal: number;
  sigma: number;
  min_value: number | null;
  max_value: number | null;
  discrete: boolean;
  boolean_default: boolean | null;
  string_default: string | null;
  string_options: string[] | null;
}

export function rowToProfile(row: TagRow): TagProfile {
  const profile: TagProfile = {
    nominal: row.nominal,
    sigma: row.sigma,
  };
  if (row.value_type !== 'number') profile.valueType = row.value_type as TagProfile['valueType'];
  if (row.min_value !== null) profile.min = row.min_value;
  if (row.max_value !== null) profile.max = row.max_value;
  if (row.discrete) profile.discrete = true;
  if (row.boolean_default !== null) profile.booleanDefault = row.boolean_default;
  if (row.string_default !== null) profile.stringDefault = row.string_default;
  if (row.string_options !== null && row.string_options.length > 0) profile.stringOptions = row.string_options;
  return profile;
}

export async function loadAllTags(): Promise<TagRow[]> {
  const sql = getDb();
  return sql<TagRow[]>`SELECT * FROM tags ORDER BY id`;
}

export async function insertTag(
  tagName: string,
  unit: string,
  profile: TagProfile,
  customGroup?: string
): Promise<TagRow> {
  const sql = getDb();
  const [row] = await sql<TagRow[]>`
    INSERT INTO tags (tag_name, unit, custom_group, value_type, nominal, sigma, min_value, max_value, discrete, boolean_default, string_default, string_options)
    VALUES (
      ${tagName},
      ${unit},
      ${customGroup ?? null},
      ${profile.valueType ?? 'number'},
      ${profile.nominal},
      ${profile.sigma},
      ${profile.min ?? null},
      ${profile.max ?? null},
      ${profile.discrete ?? false},
      ${profile.booleanDefault ?? null},
      ${profile.stringDefault ?? null},
      ${profile.stringOptions ?? null}
    )
    RETURNING *
  `;
  return row!;
}

export async function updateTagProfile(tagName: string, updates: Partial<TagProfile>): Promise<void> {
  const sql = getDb();
  const sets: Record<string, unknown> = { updated_at: sql`now()` };
  if (updates.nominal !== undefined) sets.nominal = updates.nominal;
  if (updates.sigma !== undefined) sets.sigma = updates.sigma;
  if (updates.min !== undefined) sets.min_value = updates.min;
  if (updates.max !== undefined) sets.max_value = updates.max;
  if (updates.discrete !== undefined) sets.discrete = updates.discrete;
  if (updates.valueType !== undefined) sets.value_type = updates.valueType;
  if (updates.booleanDefault !== undefined) sets.boolean_default = updates.booleanDefault;
  if (updates.stringDefault !== undefined) sets.string_default = updates.stringDefault;
  if (updates.stringOptions !== undefined) sets.string_options = updates.stringOptions;

  await sql`UPDATE tags SET ${sql(sets)} WHERE tag_name = ${tagName}`;
}

export async function updateTagGroup(tagName: string, group: string | null): Promise<void> {
  const sql = getDb();
  await sql`UPDATE tags SET custom_group = ${group}, updated_at = now() WHERE tag_name = ${tagName}`;
}

export async function deleteTag(tagName: string): Promise<void> {
  const sql = getDb();
  await sql`DELETE FROM tags WHERE tag_name = ${tagName}`;
}
