import postgres from 'postgres';

let sql: ReturnType<typeof postgres> | null = null;

/** Get the database connection instance. Throws if not initialized. */
export function getDb(): ReturnType<typeof postgres> {
  if (!sql) throw new Error('Database not initialized — call initDatabase() first');
  return sql;
}

/** Whether the database is connected. */
export function hasDb(): boolean {
  return sql !== null;
}

/** Initialize the database connection pool from DATABASE_URL. */
export function initDatabase(): ReturnType<typeof postgres> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');

  sql = postgres(url, {
    max: 10,
    idle_timeout: 20,
    connect_timeout: 30,
  });
  return sql;
}

/**
 * Wait for the database to become available with exponential backoff.
 * Retries up to 15 times starting at 500ms delay.
 */
export async function waitForDatabase(): Promise<void> {
  if (!sql) throw new Error('Database not initialized');

  let delay = 500;
  for (let attempt = 1; attempt <= 15; attempt++) {
    try {
      await sql`SELECT 1`;
      console.log(`[PI Simulator] Database connected (attempt ${attempt})`);
      return;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`[PI Simulator] Database not ready (attempt ${attempt}/15): ${msg}`);
      if (attempt === 15) {
        throw new Error(`Database not available after 15 attempts: ${msg}`);
      }
      await new Promise((r) => setTimeout(r, delay));
      delay = Math.min(delay * 2, 10_000);
    }
  }
}

/** Gracefully close the database connection pool. */
export async function closeDatabase(): Promise<void> {
  if (sql) {
    await sql.end({ timeout: 5 });
    sql = null;
  }
}
