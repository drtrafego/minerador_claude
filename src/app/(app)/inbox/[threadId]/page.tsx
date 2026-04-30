import Link from "next/link";
import { notFound } from "next/navigation";
import { requireOrg } from "@/lib/auth/guards";
import { getInboxThread } from "@/lib/db/queries/inbox";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChatActions } from "./chat-actions";

export const dynamic = "force-dynamic";

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "WhatsApp",
  instagram_dm: "Instagram",
  linkedin_dm: "LinkedIn",
  email: "Email",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "na fila",
  active: "ativo",
  awaiting_reply: "aguardando",
  replied: "respondeu",
  booked: "agendado",
  dead: "encerrado",
  finished: "concluido",
  failed: "falhou",
};

export default async function InboxThreadPage({
  params,
}: {
  params: Promise<{ threadId: string }>;
}) {
  const { threadId } = await params;
  const { organizationId } = await requireOrg();

  const detail = await getInboxThread(organizationId, threadId);
  if (!detail) notFound();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="truncate text-2xl font-semibold">
              {detail.lead.displayName}
            </h1>
            <Badge variant="outline">
              {CHANNEL_LABEL[detail.thread.channel] ?? detail.thread.channel}
            </Badge>
            <Badge variant="secondary">
              {STATUS_LABEL[detail.thread.status] ?? detail.thread.status}
            </Badge>
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-muted-foreground">
            {detail.lead.email ? <span>{detail.lead.email}</span> : null}
            {detail.lead.phone ? <span>{detail.lead.phone}</span> : null}
            {detail.lead.handle ? <span>@{detail.lead.handle}</span> : null}
            {detail.lead.city ? <span>{detail.lead.city}</span> : null}
            {detail.campaign ? (
              <Link
                href={`/campaigns/${detail.campaign.id}`}
                className="underline"
              >
                {detail.campaign.name}
              </Link>
            ) : null}
          </div>
        </div>
        <Button variant="outline" render={<Link href="/inbox">Voltar</Link>} />
      </div>

      <ChatActions
        threadId={detail.thread.id}
        channel={detail.thread.channel}
        botPaused={detail.thread.botPaused}
        messages={detail.messages}
      />
    </div>
  );
}
