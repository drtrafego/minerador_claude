import { eq } from "drizzle-orm";
import { requireOrg } from "@/lib/auth/guards";
import { db } from "@/lib/db/client";
import { agentConfigs } from "@/db/schema/agent";
import { AgentForm } from "./form";

export const dynamic = "force-dynamic";

export default async function AgentSettingsPage() {
  const { organizationId } = await requireOrg();

  const [row] = await db
    .select()
    .from(agentConfigs)
    .where(eq(agentConfigs.organizationId, organizationId))
    .limit(1);

  const initial = row ?? {
    enabled: false,
    businessName: "",
    businessInfo: "",
    tone: "profissional e direto",
    systemPromptOverride: "",
    rules: [] as string[],
    handoffKeywords: ["humano", "atendente", "parar", "stop"],
    maxAutoReplies: 6,
    model: "claude-sonnet-4-5",
    temperature: 70,
  };

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Agente IA</h1>
        <p className="text-sm text-muted-foreground">
          Quando ativado, responde automaticamente mensagens inbound usando Claude.
          Configure o canal de WhatsApp em Configuracoes &gt; WhatsApp.
        </p>
      </div>

      <AgentForm
        initial={{
          enabled: Boolean(initial.enabled),
          businessName: initial.businessName ?? "",
          businessInfo: initial.businessInfo ?? "",
          tone: initial.tone ?? "profissional e direto",
          systemPromptOverride: initial.systemPromptOverride ?? "",
          rules: (initial.rules as string[]) ?? [],
          handoffKeywords: (initial.handoffKeywords as string[]) ?? [],
          maxAutoReplies: initial.maxAutoReplies ?? 6,
          model: initial.model ?? "claude-sonnet-4-5",
          temperature: initial.temperature ?? 70,
        }}
      />
    </div>
  );
}
