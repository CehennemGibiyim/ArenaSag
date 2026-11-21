import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * Bağlantı tembel (lazy) kurulur: `next build` sırasında veritabanı ortam
 * değişkenleri bulunmayabilir. Modül import edildiğinde hata fırlatmak build'i
 * "Failed to collect page data" ile düşürüyordu; artık hata yalnızca gerçek bir
 * sorgu çalıştırıldığında oluşur.
 */

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsPostgresqlDb?: ArenaDb;
};

function connectionString(): string {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  return databaseUrl;
}

export function getPool(): Pool {
  if (!globalForDb.__arenaNextJsPostgresqlPool) {
    globalForDb.__arenaNextJsPostgresqlPool = new Pool({
      connectionString: connectionString(),
    });
  }
  return globalForDb.__arenaNextJsPostgresqlPool;
}

function createDb() {
  return drizzle(getPool());
}

type ArenaDb = NodePgDatabase<Record<string, never>> & {
  $client: Pool;
};

function getDb(): ArenaDb {
  if (!globalForDb.__arenaNextJsPostgresqlDb) {
    globalForDb.__arenaNextJsPostgresqlDb = createDb() as ArenaDb;
  }
  return globalForDb.__arenaNextJsPostgresqlDb;
}

/** `pool` yalnızca gerçekten kullanıldığında bağlanır (testler ve API aynı havuzu paylaşır). */
export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property) {
    const instance = getPool();
    const value = Reflect.get(instance, property, instance) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
});

export const db: ArenaDb = new Proxy({} as ArenaDb, {
  get(_target, property) {
    const instance = getDb();
    const value = Reflect.get(instance, property, instance) as unknown;
    return typeof value === "function" ? (value as (...args: unknown[]) => unknown).bind(instance) : value;
  },
  has(_target, property) {
    return property in getDb();
  },
});
