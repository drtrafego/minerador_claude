import { NextRequest } from "next/server";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { outreachThreads, outreachMessages } from "@/db/schema/outreach";
import { leads } from "@/db/schema/leads";
import { agentConfigs } from "@/db/schema/agent";
import { decryptCredential } from "@/lib/crypto/credentials";
import { eq, and } from "drizzle-orm";
import type { WhatsAppAPICredential } from "@/lib/clients/whatsapp-api";
import type { UazAPICredential } from "@/lib/clients/whatsapp-uazapi";
import { getBoss, QUEUES } from "@/lib/queue/client";
import type { AgentReplyPayload } from "@/lib/queue/types";

// GET: verificação do webhook pelo Meta
export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
  if (mode === "subscribe" && token === verifyToken && challenge) {
    return new Response(challenge, { status: 200 });
  }
  return Response.json({ error: "forbidden" }, { status: 403 });
}

async function processInboundMessage(params: {
  organizationId: string;
  from: string;
  body: string;
  messageId: string;
}) {
  const { organizationId, from, body, messageId } = params;

  let thread = await db.query.outreachThreads.findFirst({
    where: and(
      eq(outreachThreads.organizationId, organizationId),
      eq(outreachThreads.externalThreadId, from),
    ),
  });

  if (!thread) {
    const [lead] = await db
      .insert(leads)
      .values({
        organizationId,
        source: "manual",
        externalId: from,
        displayName: from,
        phone: from,
        rawData: { inbound: true },
        qualificationStatus: "pending",
      })
      .onConflictDoNothing()
      .returning({ id: leads.id });

    const leadId = lead?.id ?? (
      await db.query.leads.findFirst({
        where: and(
          eq(leads.organizationId, organizationId),
          eq(leads.externalId, from),
        ),
        columns: { id: true },
      })
    )?.id;

    if (!leadId) return;

    const [newThread] = await db
      .insert(outreachThreads)
      .values({
        organizationId,
        leadId,
        channel: "whatsapp",
        status: "replied",
        externalThreadId: from,
        lastInboundAt: new Date(),
        lastMessageAt: new Date(),
      })
      .returning();

    if (!newThread) return;
    thread = newThread;
  }

  const [inserted] = await db
    .insert(outreachMessages)
    .values({
      organizationId,
      threadId: thread.id,
      direction: "inbound",
      status: "received",
      step: thread.currentStep,
      body,
      externalMessageId: messageId,
    })
    .returning({ id: outreachMessages.id });

  if (thread.status === "active" || thread.status === "awaiting_reply") {
    await db
      .update(outreachThreads)
      .set({
        status: "replied",
        lastInboundAt: new Date(),
        lastMessageAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(outreachThreads.id, thread.id));
  }

  if (!inserted) return;

  const [config] = await db
    .select({ enabled: agentConfigs.enabled })
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  if (config?.enabled) {
    try {
      const boss = await getBoss();
      const payload: AgentReplyPayload = {
        organizationId,
        threadId: thread.id,
        inboundMessageId: inserted.id,
      };
      await boss.send(QUEUES.agentReply, payload);
    } catch (err) {
      console.error("[webhook/whatsapp] falha ao enfileirar agent.reply", err);
    }
  }
}

// POST: mensagens inbound (Meta Cloud API + UazAPI)
export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as Record<string, unknown>;

    // --- Formato UazAPI ---
    if (typeof body.event === "string" && body.data) {
      const data = body.data as {
        from?: string;
        body?: string;
        id?: string;
        type?: string;
      };
      if (data.type === "text" && data.from && data.body) {
        const allUazCreds = await db.query.credentials.findMany({
          where: eq(credentials.provider, "whatsapp_uazapi"),
        });
        for (const row of allUazCreds) {
          try {
            await decryptCredential<UazAPICredential>(row.ciphertext);
            await processInboundMessage({
              organizationId: row.organizationId,
              from: data.from,
              body: data.body,
              messageId: data.id ?? `uazapi-${Date.now()}`,
            });
            break;
          } catch {}
        }
      }
      return Response.json({ ok: true }, { status: 200 });
    }

    // --- Formato Meta Cloud API ---
    const metaBody = body as {
      entry?: {
        changes?: {
          value?: {
            phone_number_id?: string;
            messages?: {
              id: string;
              from: string;
              text?: { body: string };
              type: string;
            }[];
          };
        }[];
      }[];
    };

    const value = metaBody.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages?.length) {
      return Response.json({ ok: true }, { status: 200 });
    }

    const phoneNumberId = value.phone_number_id;
    const msg = value.messages[0];
    if (!msg || msg.type !== "text" || !msg.text?.body) {
      return Response.json({ ok: true }, { status: 200 });
    }

    const allApiCreds = await db.query.credentials.findMany({
      where: eq(credentials.provider, "whatsapp_api"),
    });

    for (const row of allApiCreds) {
      try {
        const cred = await decryptCredential<WhatsAppAPICredential>(
          row.ciphertext,
        );
        if (cred.phone_number_id === phoneNumberId) {
          await processInboundMessage({
            organizationId: row.organizationId,
            from: msg.from,
            body: msg.text.body,
            messageId: msg.id,
          });
          break;
        }
      } catch {}
    }
  } catch (err) {
    console.error("[webhook/whatsapp] erro:", err);
  }

  return Response.json({ ok: true }, { status: 200 });
}
