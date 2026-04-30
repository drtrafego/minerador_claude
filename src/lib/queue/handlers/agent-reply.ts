import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db/node";
import { agentConfigs } from "@/db/schema/agent";
import { campaigns } from "@/db/schema/campaigns";
import { leads as leadsTable } from "@/db/schema/leads";
import {
  outreachMessages,
  outreachThreads,
} from "@/db/schema/outreach";
import { events } from "@/db/schema/events";
import {
  generateAgentReply,
  type AgentMessage,
} from "@/lib/clients/anthropic";
import {
  loadWhatsAppAPICredential,
  sendWhatsAppAPIMessage,
  WhatsAppAPIError,
  WhatsAppAPINotConfiguredError,
} from "@/lib/clients/whatsapp-api";
import {
  loadUazAPICredential,
  sendUazAPIMessage,
  UazAPIError,
  UazAPINotConfiguredError,
} from "@/lib/clients/whatsapp-uazapi";
import type { AgentReplyPayload } from "@/lib/queue/types";

const HISTORY_LIMIT = 20;

function buildSystemPrompt(opts: {
  businessName: string | null;
  businessInfo: string | null;
  tone: string;
  rules: string[];
  override: string | null;
  campaignName: string | null;
  niche: string | null;
  lead: {
    displayName: string;
    city: string | null;
    company: string | null;
    handle: string | null;
  };
}): string {
  if (opts.override && opts.override.trim().length > 40) {
    return opts.override.trim();
  }

  const sections: string[] = [];
  sections.push(
    `Voce e um agente de vendas conversacional que responde leads via WhatsApp${
      opts.businessName ? ` em nome de ${opts.businessName}` : ""
    }.`,
  );
  sections.push(`Tom de voz: ${opts.tone}.`);
  if (opts.businessInfo) {
    sections.push(`Contexto do negocio:\n${opts.businessInfo}`);
  }
  if (opts.campaignName || opts.niche) {
    sections.push(
      `Campanha atual: ${[opts.campaignName, opts.niche]
        .filter(Boolean)
        .join(" - ")}.`,
    );
  }
  sections.push(
    `Lead: ${opts.lead.displayName}${
      opts.lead.company ? ` (${opts.lead.company})` : ""
    }${opts.lead.city ? ` em ${opts.lead.city}` : ""}.`,
  );
  sections.push(
    [
      "Regras inegociaveis:",
      "- Responda APENAS com base no contexto acima. Nunca invente precos, prazos, produtos ou informacoes nao listadas.",
      "- Mensagens curtas, maximo 3 paragrafos. Sem emojis em excesso.",
      "- Se o lead perguntar algo que voce nao sabe, peca para aguardar que um humano retorna.",
      "- Nao use travessoes, hifens como separador, nem meia-risca. Use virgula, ponto ou ponto e virgula.",
      "- Responda sempre em portugues.",
      "- O objetivo e qualificar interesse e agendar uma conversa rapida. Nao force venda.",
    ].join("\n"),
  );
  if (opts.rules.length > 0) {
    sections.push(
      "Regras adicionais do cliente:\n" +
        opts.rules.map((r) => `- ${r}`).join("\n"),
    );
  }
  return sections.join("\n\n");
}

function hasHandoffKeyword(body: string, keywords: string[]): boolean {
  const lower = body.toLowerCase();
  return keywords.some((k) => lower.includes(k.toLowerCase().trim()));
}

async function sendWhatsApp(opts: {
  organizationId: string;
  phone: string;
  body: string;
  preferred: string;
}): Promise<{ messageId: string; provider: "meta" | "uazapi" } | null> {
  const order =
    opts.preferred === "meta"
      ? ["meta", "uazapi"]
      : opts.preferred === "uazapi"
        ? ["uazapi", "meta"]
        : ["meta", "uazapi"];

  for (const provider of order) {
    try {
      if (provider === "meta") {
        const cred = await loadWhatsAppAPICredential(opts.organizationId);
        if (!cred) continue;
        const res = await sendWhatsAppAPIMessage({
          organizationId: opts.organizationId,
          phone: opts.phone,
          body: opts.body,
        });
        return { messageId: res.messageId, provider: "meta" };
      }
      if (provider === "uazapi") {
        const cred = await loadUazAPICredential(opts.organizationId);
        if (!cred) continue;
        const res = await sendUazAPIMessage({
          organizationId: opts.organizationId,
          phone: opts.phone,
          body: opts.body,
        });
        return { messageId: res.messageId, provider: "uazapi" };
      }
    } catch (err) {
      if (
        err instanceof WhatsAppAPINotConfiguredError ||
        err instanceof UazAPINotConfiguredError
      ) {
        continue;
      }
      if (err instanceof WhatsAppAPIError || err instanceof UazAPIError) {
        console.warn(
          `[agent.reply] provider ${provider} falhou (${err.message}), tentando proximo`,
        );
        continue;
      }
      throw err;
    }
  }
  return null;
}

export async function handleAgentReply(payload: AgentReplyPayload): Promise<void> {
  const { organizationId, threadId, inboundMessageId } = payload;

  const [config] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  if (!config || !config.enabled) {
    console.log(`[agent.reply] agent desabilitado para org ${organizationId}`);
    return;
  }

  const [thread] = await db
    .select()
    .from(outreachThreads)
    .where(
      and(
        eq(outreachThreads.id, threadId),
        eq(outreachThreads.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (!thread) {
    console.warn(`[agent.reply] thread ${threadId} nao encontrada`);
    return;
  }

  if (thread.botPaused) {
    console.log(`[agent.reply] bot pausado (atendimento humano ativo) no thread ${threadId}`);
    return;
  }

  if (thread.channel !== "whatsapp") {
    console.log(`[agent.reply] canal ${thread.channel} nao suportado`);
    return;
  }

  const [countRow] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(outreachMessages)
    .where(
      and(
        eq(outreachMessages.threadId, threadId),
        eq(outreachMessages.direction, "outbound"),
        sql`${outreachMessages.metadata}->>'agent' = 'true'`,
      ),
    );
  const autoReplyCount = countRow?.c ?? 0;
  if (autoReplyCount >= config.maxAutoReplies) {
    await db
      .update(outreachThreads)
      .set({ status: "awaiting_reply", updatedAt: new Date() })
      .where(eq(outreachThreads.id, threadId));
    console.log(
      `[agent.reply] limite de ${config.maxAutoReplies} respostas automaticas atingido no thread ${threadId}`,
    );
    return;
  }

  const [inbound] = await db
    .select()
    .from(outreachMessages)
    .where(eq(outreachMessages.id, inboundMessageId))
    .limit(1);
  if (!inbound) {
    console.warn(`[agent.reply] mensagem ${inboundMessageId} nao encontrada`);
    return;
  }

  if (hasHandoffKeyword(inbound.body ?? "", config.handoffKeywords)) {
    await db
      .update(outreachThreads)
      .set({ status: "replied", updatedAt: new Date() })
      .where(eq(outreachThreads.id, threadId));
    await db.insert(events).values({
      organizationId,
      type: "agent.handoff",
      entityType: "thread",
      entityId: threadId,
      data: { reason: "handoff_keyword", body: inbound.body },
    });
    console.log(`[agent.reply] handoff por palavra-chave no thread ${threadId}`);
    return;
  }

  const [lead] = await db
    .select()
    .from(leadsTable)
    .where(eq(leadsTable.id, thread.leadId))
    .limit(1);
  if (!lead) {
    console.warn(`[agent.reply] lead ${thread.leadId} nao encontrado`);
    return;
  }

  const campaign = thread.campaignId
    ? (
        await db
          .select()
          .from(campaigns)
          .where(eq(campaigns.id, thread.campaignId))
          .limit(1)
      )[0] ?? null
    : null;

  const historyRows = await db
    .select({
      direction: outreachMessages.direction,
      body: outreachMessages.body,
      createdAt: outreachMessages.createdAt,
    })
    .from(outreachMessages)
    .where(eq(outreachMessages.threadId, threadId))
    .orderBy(desc(outreachMessages.createdAt))
    .limit(HISTORY_LIMIT);

  const history = historyRows.reverse();
  const messages: AgentMessage[] = history.map((m) => ({
    role: m.direction === "inbound" ? "user" : "assistant",
    content: m.body ?? "",
  }));

  const systemPrompt = buildSystemPrompt({
    businessName: config.businessName,
    businessInfo: config.businessInfo,
    tone: config.tone,
    rules: config.rules,
    override: config.systemPromptOverride,
    campaignName: campaign?.name ?? null,
    niche: campaign?.niche ?? null,
    lead: {
      displayName: lead.displayName,
      city: lead.city,
      company: lead.company,
      handle: lead.handle,
    },
  });

  let reply;
  try {
    reply = await generateAgentReply({
      organizationId,
      systemPrompt,
      messages,
      model: config.model,
      temperature: config.temperature / 100,
      maxTokens: 600,
    });
  } catch (err) {
    console.error(`[agent.reply] falha ao gerar resposta no thread ${threadId}`, err);
    throw err;
  }

  const replyText = reply.text.trim();
  if (!replyText || replyText.length < 3) {
    console.warn(`[agent.reply] resposta vazia para thread ${threadId}`);
    return;
  }

  if (!lead.phone) {
    console.warn(`[agent.reply] lead ${lead.id} sem telefone`);
    return;
  }

  const now = new Date();
  const [outbound] = await db
    .insert(outreachMessages)
    .values({
      organizationId,
      threadId,
      direction: "outbound",
      status: "pending",
      step: thread.currentStep,
      body: replyText,
      metadata: {
        agent: true,
        model: reply.model,
        costUsd: reply.costUsd,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
      },
    })
    .returning({ id: outreachMessages.id });

  if (!outbound) return;

  const sent = await sendWhatsApp({
    organizationId,
    phone: lead.phone,
    body: replyText,
    preferred: config.preferredProvider,
  });

  if (!sent) {
    await db
      .update(outreachMessages)
      .set({
        status: "failed",
        errorReason: "nenhum provider whatsapp disponivel",
        updatedAt: new Date(),
      })
      .where(eq(outreachMessages.id, outbound.id));
    throw new Error("nenhum provider whatsapp configurado para agent");
  }

  await db
    .update(outreachMessages)
    .set({
      status: "sent",
      externalMessageId: sent.messageId,
      sentAt: now,
      metadata: {
        agent: true,
        model: reply.model,
        costUsd: reply.costUsd,
        inputTokens: reply.inputTokens,
        outputTokens: reply.outputTokens,
        provider: sent.provider,
      },
      updatedAt: now,
    })
    .where(eq(outreachMessages.id, outbound.id));

  await db
    .update(outreachThreads)
    .set({
      status: "active",
      lastMessageAt: now,
      lastOutboundAt: now,
      updatedAt: now,
    })
    .where(eq(outreachThreads.id, threadId));

  await db.insert(events).values({
    organizationId,
    type: "agent.reply.sent",
    entityType: "thread",
    entityId: threadId,
    data: {
      provider: sent.provider,
      inputTokens: reply.inputTokens,
      outputTokens: reply.outputTokens,
      costUsd: reply.costUsd,
    },
  });
}
