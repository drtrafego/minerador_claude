import Link from "next/link";
import { Bot, User } from "lucide-react";
import { requireOrg } from "@/lib/auth/guards";
import { listInboxThreads } from "@/lib/db/queries/inbox";
import { Badge } from "@/components/ui/badge";

export const dynamic = "force-dynamic";

const STATUS_LABEL: Record<string, string> = {
  queued: "na fila",
  active: "ativo",
  awaiting_reply: "aguardando",
  replied: "respondeu",
  booked: "reservado",
  dead: "encerrado",
  finished: "concluido",
  failed: "falhou",
};

const CHANNEL_LABEL: Record<string, string> = {
  email: "email",
  instagram_dm: "instagram",
};

export default async function InboxPage() {
  const { organizationId } = await requireOrg();
  const threads = await listInboxThreads(organizationId);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Inbox</h1>
        <p className="text-sm text-muted-foreground">
          Todas as conversas de outreach da organizacao.
        </p>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-lg border p-12 text-center text-sm text-muted-foreground">
          Nenhuma thread de outreach ainda.
        </div>
      ) : (
        <div className="space-y-2">
          {threads.map((t) => {
            const lastAt =
              t.lastInboundAt ?? t.lastOutboundAt ?? t.updatedAt;
            return (
              <Link
                key={t.id}
                href={`/inbox/${t.id}`}
                className="block rounded-lg border p-4 transition-colors hover:border-ring"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate font-medium">{t.leadName}</p>
                      <Badge variant="outline" className="text-xs">
                        {CHANNEL_LABEL[t.channel] ?? t.channel}
                      </Badge>
                      <Badge variant="secondary" className="text-xs">
                        {STATUS_LABEL[t.status] ?? t.status}
                      </Badge>
                      {(t as { botPaused?: boolean }).botPaused ? (
                        <User className="h-3 w-3 text-orange-500" />
                      ) : (
                        <Bot className="h-3 w-3 text-blue-500" />
                      )}
                    </div>
                    {t.campaignName ? (
                      <p className="text-xs text-muted-foreground">
                        {t.campaignName}
                      </p>
                    ) : null}
                    {t.lastMessageBody ? (
                      <p className="mt-2 line-clamp-2 text-sm text-muted-foreground">
                        {t.lastMessageBody}
                      </p>
                    ) : null}
                  </div>
                  <div className="text-right text-xs text-muted-foreground">
                    {new Date(lastAt).toLocaleString("pt-BR")}
                  </div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
