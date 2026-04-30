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
  type AgentTool,
} from "@/lib/clients/anthropic";
import {
  checkCalendarAvailability,
  createCalendarEvent,
  CalendarNotConfiguredError,
} from "@/lib/clients/google-calendar";
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

const CALENDAR_TOOLS: AgentTool[] = [
  {
    name: "check_availability",
    description: "Verifica horarios livres na agenda para uma data especifica. Use antes de propor um horario ao lead.",
    input_schema: {
      type: "object",
      properties: {
        date: {
          type: "string",
          description: "Data no formato YYYY-MM-DD. Ex: 2025-06-15",
        },
        duration_minutes: {
          type: "number",
          description: "Duracao da reuniao em minutos. Padrao: 30",
        },
      },
      required: ["date"],
    },
  },
  {
    name: "book_meeting",
    description: "Cria um evento no Google Calendar e envia convite. Use apenas apos o lead confirmar o horario.",
    input_schema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Titulo do evento. Ex: Conversa com Joao - Casal do Trafego",
        },
        start_time: {
          type: "string",
          description: "Horario de inicio em ISO 8601. Ex: 2025-06-15T14:00:00-03:00",
        },
        end_time: {
          type: "string",
          description: "Horario de termino em ISO 8601. Ex: 2025-06-15T14:30:00-03:00",
        },
        attendee_email: {
          type: "string",
          description: "Email do lead (opcional)",
        },
        notes: {
          type: "string",
          description: "Notas sobre o lead ou contexto da reuniao (opcional)",
        },
      },
      required: ["summary", "start_time", "end_time"],
    },
  },
];

function buildSystemPrompt(opts: {
  businessName: string | null;
  businessInfo: string | null;
  tone: string;
  rules: string[];
  override: string | null;
  campaignName: string | null;
  niche: string | null;
  calendarEnabled: boolean;
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

  if (opts.calendarEnabled) {
    sections.push(
      [
        "Agendamento via Google Calendar:",
        "- Quando o lead demonstrar interesse em agendar uma conversa ou reuniao, use a ferramenta check_availability para verificar horarios livres.",
        "- Pergunte a data de preferencia antes de checar disponibilidade.",
        "- Apos confirmar o horario com o lead, use book_meeting para criar o evento.",
        "- Confirme o agendamento enviando a data, hora e link do Google Meet (se disponivel).",
        "- Use horario de Brasilia (UTC-3) nas mensagens para o lead.",
      ].join("\n"),
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

  let calendarEnabled = false;
  try {
    await checkCalendarAvailability(organizationId, new Date().toISOString().split("T")[0], 30);
    calendarEnabled = true;
  } catch (err) {
    if (!(err instanceof CalendarNotConfiguredError)) calendarEnabled = false;
  }

  const systemPrompt = buildSystemPrompt({
    businessName: config.businessName,
    businessInfo: config.businessInfo,
    tone: config.tone,
    rules: config.rules,
    override: config.systemPromptOverride,
    campaignName: campaign?.name ?? null,
    niche: campaign?.niche ?? null,
    calendarEnabled,
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
      maxTokens: 800,
      tools: calendarEnabled ? CALENDAR_TOOLS : [],
    });
  } catch (err) {
    console.error(`[agent.reply] falha ao gerar resposta no thread ${threadId}`, err);
    throw err;
  }

  // Executar ferramentas se Claude solicitou
  if (reply.toolUses.length > 0 && calendarEnabled) {
    const toolResults: Array<{ toolUseId: string; content: string }> = [];

    for (const toolUse of reply.toolUses) {
      if (toolUse.toolName === "check_availability") {
        try {
          const date = String(toolUse.input.date ?? new Date().toISOString().split("T")[0]);
          const duration = Number(toolUse.input.duration_minutes ?? 30);
          const slots = await checkCalendarAvailability(organizationId, date, duration);
          const formatted = slots.length === 0
            ? "Nenhum horario disponivel nesta data."
            : slots.map((s) => {
                const start = new Date(s.start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
                const end = new Date(s.end).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
                return `${start} - ${end}`;
              }).join(", ");
          toolResults.push({ toolUseId: toolUse.toolUseId, content: formatted });
        } catch {
          toolResults.push({ toolUseId: toolUse.toolUseId, content: "Erro ao verificar disponibilidade." });
        }
      }

      if (toolUse.toolName === "book_meeting") {
        try {
          const event = await createCalendarEvent(organizationId, {
            summary: String(toolUse.input.summary ?? "Reuniao"),
            description: toolUse.input.notes ? String(toolUse.input.notes) : undefined,
            startTime: String(toolUse.input.start_time),
            endTime: String(toolUse.input.end_time),
            attendeeEmail: toolUse.input.attendee_email ? String(toolUse.input.attendee_email) : undefined,
            attendeeName: lead.displayName,
          });
          const info = [
            `Evento criado: ${event.summary}`,
            `Inicio: ${new Date(event.start).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}`,
            event.meetLink ? `Link Meet: ${event.meetLink}` : "",
          ].filter(Boolean).join("\n");
          toolResults.push({ toolUseId: toolUse.toolUseId, content: info });
        } catch {
          toolResults.push({ toolUseId: toolUse.toolUseId, content: "Erro ao criar evento no calendario." });
        }
      }
    }

    // Segunda chamada ao Claude com resultados das ferramentas
    if (toolResults.length > 0) {
      const toolResultMessages: AgentMessage[] = [
        ...messages,
        {
          role: "assistant",
          content: reply.text || JSON.stringify(reply.toolUses.map((t) => ({ type: "tool_use", id: t.toolUseId, name: t.toolName, input: t.input }))),
        },
      ];

      const toolResultContent = toolResults.map((r) => ({
        type: "tool_result" as const,
        tool_use_id: r.toolUseId,
        content: r.content,
      }));

      try {
        const followUp = await generateAgentReply({
          organizationId,
          systemPrompt,
          messages: [
            ...toolResultMessages,
            { role: "user", content: JSON.stringify(toolResultContent) },
          ],
          model: config.model,
          temperature: config.temperature / 100,
          maxTokens: 600,
        });
        if (followUp.text) {
          reply = { ...reply, text: followUp.text };
        }
      } catch (err) {
        console.error(`[agent.reply] falha na segunda chamada apos tool use no thread ${threadId}`, err);
      }
    }
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
