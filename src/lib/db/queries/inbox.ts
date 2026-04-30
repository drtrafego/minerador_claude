import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import {
  outreachThreads,
  outreachMessages,
} from "@/db/schema/outreach";
import { leads } from "@/db/schema/leads";
import { campaigns } from "@/db/schema/campaigns";

export type InboxThreadRow = {
  id: string;
  status: string;
  channel: string;
  currentStep: number;
  lastOutboundAt: Date | null;
  lastInboundAt: Date | null;
  updatedAt: Date;
  leadId: string;
  leadName: string;
  leadEmail: string | null;
  leadHandle: string | null;
  campaignId: string | null;
  campaignName: string | null;
  lastMessageBody: string | null;
  lastMessageStatus: string | null;
};

export async function listInboxThreads(
  organizationId: string,
): Promise<InboxThreadRow[]> {
  const threads = await db
    .select({
      id: outreachThreads.id,
      status: outreachThreads.status,
      channel: outreachThreads.channel,
      currentStep: outreachThreads.currentStep,
      lastOutboundAt: outreachThreads.lastOutboundAt,
      lastInboundAt: outreachThreads.lastInboundAt,
      updatedAt: outreachThreads.updatedAt,
      leadId: outreachThreads.leadId,
      leadName: leads.displayName,
      leadEmail: leads.email,
      leadHandle: leads.handle,
      campaignId: outreachThreads.campaignId,
      campaignName: campaigns.name,
    })
    .from(outreachThreads)
    .innerJoin(leads, eq(leads.id, outreachThreads.leadId))
    .leftJoin(campaigns, eq(campaigns.id, outreachThreads.campaignId))
    .where(eq(outreachThreads.organizationId, organizationId))
    .orderBy(
      desc(
        sql`coalesce(${outreachThreads.lastInboundAt}, ${outreachThreads.lastOutboundAt}, ${outreachThreads.updatedAt})`,
      ),
    )
    .limit(200);

  if (threads.length === 0) return [];

  const threadIds = threads.map((t) => t.id);
  const lastMessages = await db.execute<{
    thread_id: string;
    body: string;
    status: string;
  }>(sql`
    SELECT DISTINCT ON (thread_id) thread_id, body, status
    FROM "minerador_scrapling"."outreach_messages"
    WHERE thread_id = ANY(${threadIds}::uuid[])
    ORDER BY thread_id, created_at DESC
  `);

  const byThread = new Map<string, { body: string; status: string }>();
  for (const row of lastMessages) {
    byThread.set(row.thread_id, { body: row.body, status: row.status });
  }

  return threads.map((t) => {
    const last = byThread.get(t.id);
    return {
      ...t,
      lastMessageBody: last?.body ?? null,
      lastMessageStatus: last?.status ?? null,
    };
  });
}

export type InboxThreadDetail = {
  thread: {
    id: string;
    status: string;
    channel: string;
    currentStep: number;
    createdAt: Date;
    lastOutboundAt: Date | null;
    lastInboundAt: Date | null;
    botPaused: boolean;
  };
  lead: {
    id: string;
    displayName: string;
    email: string | null;
    phone: string | null;
    website: string | null;
    handle: string | null;
    city: string | null;
  };
  campaign: {
    id: string;
    name: string;
  } | null;
  messages: Array<{
    id: string;
    direction: string;
    status: string;
    step: number;
    subject: string | null;
    body: string;
    errorReason: string | null;
    sentAt: Date | null;
    createdAt: Date;
  }>;
};

export async function getInboxThread(
  organizationId: string,
  threadId: string,
): Promise<InboxThreadDetail | null> {
  const rows = await db
    .select({
      thread: outreachThreads,
      lead: leads,
      campaign: campaigns,
    })
    .from(outreachThreads)
    .innerJoin(leads, eq(leads.id, outreachThreads.leadId))
    .leftJoin(campaigns, eq(campaigns.id, outreachThreads.campaignId))
    .where(
      and(
        eq(outreachThreads.id, threadId),
        eq(outreachThreads.organizationId, organizationId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  const messages = await db
    .select({
      id: outreachMessages.id,
      direction: outreachMessages.direction,
      status: outreachMessages.status,
      step: outreachMessages.step,
      subject: outreachMessages.subject,
      body: outreachMessages.body,
      errorReason: outreachMessages.errorReason,
      sentAt: outreachMessages.sentAt,
      createdAt: outreachMessages.createdAt,
    })
    .from(outreachMessages)
    .where(
      and(
        eq(outreachMessages.threadId, threadId),
        eq(outreachMessages.organizationId, organizationId),
      ),
    )
    .orderBy(asc(outreachMessages.createdAt));

  return {
    thread: {
      id: row.thread.id,
      status: row.thread.status,
      channel: row.thread.channel,
      currentStep: row.thread.currentStep,
      createdAt: row.thread.createdAt,
      lastOutboundAt: row.thread.lastOutboundAt,
      lastInboundAt: row.thread.lastInboundAt,
      botPaused: row.thread.botPaused,
    },
    lead: {
      id: row.lead.id,
      displayName: row.lead.displayName,
      email: row.lead.email,
      phone: row.lead.phone,
      website: row.lead.website,
      handle: row.lead.handle,
      city: row.lead.city,
    },
    campaign: row.campaign
      ? { id: row.campaign.id, name: row.campaign.name }
      : null,
    messages,
  };
}

export async function getOutreachStatusByLead(
  organizationId: string,
  leadIds: string[],
): Promise<Map<string, { id: string; status: string }>> {
  const map = new Map<string, { id: string; status: string }>();
  if (leadIds.length === 0) return map;

  const rows = await db
    .select({
      id: outreachThreads.id,
      leadId: outreachThreads.leadId,
      status: outreachThreads.status,
      updatedAt: outreachThreads.updatedAt,
    })
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.organizationId, organizationId),
        sql`${outreachThreads.leadId} = ANY(${leadIds}::uuid[])`,
      ),
    )
    .orderBy(desc(outreachThreads.updatedAt));

  for (const row of rows) {
    if (!map.has(row.leadId)) {
      map.set(row.leadId, { id: row.id, status: row.status });
    }
  }
  return map;
}
