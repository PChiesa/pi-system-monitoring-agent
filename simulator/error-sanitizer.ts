/**
 * Error message sanitizer — strips sensitive information before returning errors to clients.
 */

/** Patterns that indicate sensitive content in error messages. */
const SENSITIVE_PATTERNS = [
  /Basic\s+[A-Za-z0-9+/=]+/g,          // Basic auth headers
  /Bearer\s+[A-Za-z0-9._\-]+/g,        // Bearer tokens
  /(?:\/[\w.-]+){3,}/g,                 // File paths (3+ segments)
  /at\s+\S+\s+\(.*:\d+:\d+\)/g,        // Stack trace lines: at fn (file:line:col)
  /at\s+.*:\d+:\d+/g,                   // Stack trace lines: at file:line:col
  /postgres:\/\/[^@]+@/g,               // Postgres connection strings with credentials
  /password[=:]\s*\S+/gi,              // password= or password: values
];

/**
 * Sanitize an error message for safe inclusion in HTTP responses.
 * Removes file paths, stack traces, credentials, and other internal details.
 */
export function sanitizeErrorMessage(err: unknown, fallback = 'An internal error occurred'): string {
  const raw = err instanceof Error ? err.message : String(err);
  let sanitized = raw;

  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[redacted]');
  }

  // If sanitization removed most of the content, use the fallback
  if (sanitized.trim().length < 3) {
    return fallback;
  }

  // Truncate long messages
  if (sanitized.length > 256) {
    sanitized = sanitized.slice(0, 256) + '...';
  }

  return sanitized;
}
