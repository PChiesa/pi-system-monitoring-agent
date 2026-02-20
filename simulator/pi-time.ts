const UNIT_MS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/**
 * Parse PI Web API time syntax into a Date.
 *
 * Supports:
 *   "*"       → now
 *   "*-1h"    → 1 hour ago
 *   "*-30m"   → 30 minutes ago
 *   "*-7d"    → 7 days ago
 *   "*-120s"  → 120 seconds ago
 *   ISO 8601  → parsed directly
 */
export function parsePITime(piTime: string, now = new Date()): Date {
  if (piTime === '*') return now;

  const match = piTime.match(/^\*-(\d+)([smhd])$/);
  if (match) {
    const amount = parseInt(match[1]!, 10);
    const ms = UNIT_MS[match[2]!]!;
    return new Date(now.getTime() - amount * ms);
  }

  // Try ISO 8601 fallback
  const parsed = new Date(piTime);
  if (!isNaN(parsed.getTime())) return parsed;

  // Unrecognized format — return now
  return now;
}
