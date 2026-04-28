import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/db/schema";

const globalForPg = globalThis as unknown as {
  pgNode?: ReturnType<typeof postgres>;
  dbNode?: ReturnType<typeof drizzle<typeof schema>>;
};

function getDb() {
  if (globalForPg.dbNode) return globalForPg.dbNode;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL nao definida");
  }

  const pg =
    globalForPg.pgNode ??
    postgres(connectionString, { max: 10, prepare: false });

  if (process.env.NODE_ENV !== "production") {
    globalForPg.pgNode = pg;
  }

  const instance = drizzle(pg, { schema });

  if (process.env.NODE_ENV !== "production") {
    globalForPg.dbNode = instance;
  }

  return instance;
}

export const db = new Proxy({} as ReturnType<typeof drizzle<typeof schema>>, {
  get(_target, prop) {
    return (getDb() as unknown as Record<string | symbol, unknown>)[prop];
  },
});

export type Database = ReturnType<typeof drizzle<typeof schema>>;
