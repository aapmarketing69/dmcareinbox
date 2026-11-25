import { initDb } from './sqlite.js';
import { createRepository } from './repository.js';
import { initPgDb, createPgRepository } from './postgres.js';

/**
 * Automatically selects PostgreSQL (when DATABASE_URL or injected pgPool is provided)
 * or local SQLite (with WAL mode) for zero-dependency development & testing.
 */
export async function createDatabase({ config, dbPath = null, pgPool = null } = {}) {
  const usePostgres = Boolean(pgPool || config?.databaseUrl);

  if (usePostgres) {
    let pool = pgPool;
    if (!pool) {
      const pgModule = await import('pg');
      const Pool = pgModule.default?.Pool || pgModule.Pool;
      const disableSsl =
        String(config.databaseUrl).includes('sslmode=disable') ||
        String(config.databaseUrl).includes('localhost') ||
        String(config.databaseUrl).includes('127.0.0.1');
      pool = new Pool({
        connectionString: config.databaseUrl,
        max: 15,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 10_000,
        ssl: config.isProduction && !disableSsl ? { rejectUnauthorized: false } : false,
      });
    }

    await initPgDb(pool, {
      encryptionKey: config.encryptionKey,
      adminEmail: config.adminEmail,
      adminPassword: config.adminPassword,
      adminName: config.adminName,
      isProduction: config.isProduction,
    });

    const repo = createPgRepository(pool, config.encryptionKey);
    return {
      engine: 'postgres',
      db: null,
      pool,
      repo,
      async close() {
        if (!pgPool && typeof pool.end === 'function') {
          await pool.end();
        }
      },
    };
  }

  const db = initDb(dbPath || config.dbPath, config.encryptionKey, {
    adminEmail: config.adminEmail,
    adminPassword: config.adminPassword,
    adminName: config.adminName,
    isProduction: config.isProduction,
  });
  const repo = createRepository(db, config.encryptionKey);
  return {
    engine: 'sqlite',
    db,
    pool: null,
    repo,
    async close() {
      db.close();
    },
  };
}
