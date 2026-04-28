import { PgBoss } from "pg-boss";

const globalForBoss = globalThis as unknown as {
  pgBoss?: PgBoss;
  pgBossReady?: Promise<PgBoss>;
};

function createBoss(): PgBoss {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL nao definida");
  }
  const schema = process.env.PGBOSS_SCHEMA ?? "pgboss";
  return new PgBoss({
    connectionString,
    schema,
    application_name: "minerador_claude",
  });
}

export async function getBoss(): Promise<PgBoss> {
  if (globalForBoss.pgBoss) return globalForBoss.pgBoss;
  if (globalForBoss.pgBossReady) return globalForBoss.pgBossReady;

  const boss = createBoss();
  globalForBoss.pgBossReady = boss.start().then(() => {
    globalForBoss.pgBoss = boss;
    return boss;
  });

  return globalForBoss.pgBossReady;
}

export const QUEUES = {
  scrapeRun: "scrape.run",
  scrapeIngest: "scrape.ingest",
  qualifyBatch: "qualify.batch",
  outreachEnqueue: "outreach.enqueue",
  outreachSend: "outreach.send",
  outreachTick: "outreach.tick",
  agentReply: "agent.reply",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];
