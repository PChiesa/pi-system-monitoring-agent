import { z } from 'zod';

// ── Tag schemas ─────────────────────────────────────────────────────────────

export const tagNameSchema = z
  .string()
  .min(1, 'Tag name must not be empty')
  .max(128, 'Tag name must be at most 128 characters')
  .regex(/^[A-Za-z0-9._\-]+$/, 'Tag name may only contain letters, digits, dots, hyphens, and underscores');

export const tagProfileSchema = z.object({
  nominal: z.number().finite(),
  sigma: z.number().finite().min(0, 'sigma must be >= 0'),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  discrete: z.boolean().optional(),
  valueType: z.enum(['number', 'boolean', 'string']).optional(),
  booleanDefault: z.boolean().optional(),
  stringDefault: z.string().optional(),
  stringOptions: z.array(z.string()).optional(),
});

export const createTagSchema = z.object({
  tagName: tagNameSchema,
  unit: z.string().max(32).optional(),
  group: z.string().max(64).optional(),
  profile: tagProfileSchema,
});

export const updateTagProfileSchema = z.object({
  nominal: z.number().finite().optional(),
  sigma: z.number().finite().min(0).optional(),
  min: z.number().finite().optional(),
  max: z.number().finite().optional(),
  discrete: z.boolean().optional(),
  valueType: z.enum(['number', 'boolean', 'string']).optional(),
  booleanDefault: z.boolean().optional(),
  stringDefault: z.string().optional(),
  stringOptions: z.array(z.string()).optional(),
});

export const setOverrideSchema = z.object({
  value: z.union([z.number(), z.string(), z.boolean()]),
});

// ── AF schemas ──────────────────────────────────────────────────────────────

export const afNameSchema = z
  .string()
  .min(1, 'Name must not be empty')
  .max(256, 'Name must be at most 256 characters');

export const createAFDatabaseSchema = z.object({
  name: afNameSchema,
  description: z.string().max(1024).optional(),
});

export const createAFElementSchema = z.object({
  parentWebId: z.string().min(1),
  name: afNameSchema,
  description: z.string().max(1024).optional(),
});

export const createAFAttributeSchema = z.object({
  elementWebId: z.string().min(1),
  name: afNameSchema,
  type: z.string().max(64).optional(),
  defaultUOM: z.string().max(32).optional(),
  piPointName: z.string().max(128).nullable().optional(),
  description: z.string().max(1024).optional(),
});

export const updateAFElementSchema = z.object({
  name: afNameSchema.optional(),
  description: z.string().max(1024).optional(),
});

export const updateAFAttributeSchema = z.object({
  name: afNameSchema.optional(),
  description: z.string().max(1024).optional(),
  type: z.string().max(64).optional(),
  defaultUOM: z.string().max(32).optional(),
  piPointName: z.string().max(128).nullable().optional(),
});

// ── Scenario schemas ────────────────────────────────────────────────────────

export const modifierDefinitionSchema = z.object({
  tagName: tagNameSchema,
  startValue: z.number().finite(),
  endValue: z.number().finite(),
  curveType: z.enum(['linear', 'step', 'exponential']),
});

export const customScenarioSchema = z.object({
  name: z
    .string()
    .min(1, 'Scenario name must not be empty')
    .max(128, 'Scenario name must be at most 128 characters'),
  description: z.string().max(1024).optional().default(''),
  durationMs: z.number().int().min(1000, 'Duration must be at least 1 second').max(86_400_000, 'Duration must be at most 24 hours'),
  modifiers: z.array(modifierDefinitionSchema).min(1, 'At least one modifier is required').max(100, 'At most 100 modifiers allowed'),
});

export const activateScenarioSchema = z.object({
  name: z.string().min(1, 'Scenario name must not be empty'),
});

// ── Helper ──────────────────────────────────────────────────────────────────

/** Format a ZodError into a concise string for HTTP 400 responses. */
export function formatZodError(error: z.ZodError): string {
  return error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
}
