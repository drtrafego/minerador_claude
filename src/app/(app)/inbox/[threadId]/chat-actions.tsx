"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { toast } from "sonner";
import { Bot, User, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { sendManualMessage, toggleBotPause } from "../actions";

type Message = {
  id: string;
  direction: string;
  status: string;
  step: number;
  subject: string | null;
  body: string;
  errorReason: string | null;
  sentAt: Date | null;
  createdAt: Date;
  isManual?: boolean;
};

const MSG_STATUS_LABEL: Record<string, string> = {
  pending: "pendente",
  sent: "enviado",
  delivered: "entregue",
  failed: "falhou",
  received: "recebido",
};

export function ChatActions({
  threadId,
  channel,
  botPaused,
  messages: initialMessages,
}: {
  threadId: string;
  channel: string;
  botPaused: boolean;
  messages: Message[];
}) {
  const [paused, setPaused] = useState(botPaused);
  const [messages, setMessages] = useState(initialMessages);
  const [body, setBody] = useState("");
  const [pendingSend, startSend] = useTransition();
  const [pendingToggle, startToggle] = useTransition();
  const bottomRef = useRef<HTMLDivElement>(null);
  const isWhatsApp = channel === "whatsapp";

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleToggle() {
    const next = !paused;
    startToggle(async () => {
      const res = await toggleBotPause(threadId, next);
      if ("error" in res) {
        toast.error(res.error);
        return;
      }
      setPaused(next);
      toast.success(next ? "Bot pausado. Atendimento humano ativo." : "Bot reativado.");
    });
  }

  function handleSend() {
    if (!body.trim()) return;
    const text = body.trim();
    setBody("");
    startSend(async () => {
      const res = await sendManualMessage(threadId, text);
      if ("error" in res) {
        toast.error(res.error);
        setBody(text);
        return;
      }
      setMessages((prev) => [
        ...prev,
        {
          id: crypto.randomUUID(),
          direction: "outbound",
          status: "sent",
          step: 0,
          subject: null,
          body: text,
          errorReason: null,
          sentAt: new Date(),
          createdAt: new Date(),
          isManual: true,
        },
      ]);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="flex items-center gap-2 text-sm">
          {paused ? (
            <User className="h-4 w-4 text-orange-500" />
          ) : (
            <Bot className="h-4 w-4 text-blue-500" />
          )}
          <span className={paused ? "text-orange-600 font-medium" : "text-blue-600 font-medium"}>
            {paused ? "Atendimento humano ativo" : "Bot ativo"}
          </span>
          {paused && (
            <span className="text-xs text-muted-foreground">
              — bot nao responde automaticamente
            </span>
          )}
        </div>
        <Button
          variant={paused ? "default" : "outline"}
          size="sm"
          onClick={handleToggle}
          disabled={pendingToggle}
        >
          {paused ? "Reativar bot" : "Assumir atendimento"}
        </Button>
      </div>

      <div className="space-y-3 rounded-lg border p-4 min-h-[200px] max-h-[480px] overflow-y-auto">
        {messages.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">
            Sem mensagens ainda.
          </p>
        ) : (
          messages.map((msg) => {
            const outbound = msg.direction === "outbound";
            return (
              <div
                key={msg.id}
                className={`flex ${outbound ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[80%] space-y-1 rounded-lg px-3 py-2 text-sm ${
                    outbound
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted"
                  }`}
                >
                  {msg.subject ? (
                    <p className="text-xs font-semibold opacity-80">{msg.subject}</p>
                  ) : null}
                  <pre className="whitespace-pre-wrap font-sans">{msg.body}</pre>
                  <div className="flex items-center gap-2 text-xs opacity-60">
                    {outbound && (
                      <span>{msg.isManual ? "voce" : "bot"}</span>
                    )}
                    <span>{MSG_STATUS_LABEL[msg.status] ?? msg.status}</span>
                    <span>
                      {new Date(msg.sentAt ?? msg.createdAt).toLocaleString("pt-BR", {
                        hour: "2-digit",
                        minute: "2-digit",
                        day: "2-digit",
                        month: "2-digit",
                      })}
                    </span>
                  </div>
                  {msg.errorReason ? (
                    <p className="text-xs text-red-300">erro: {msg.errorReason}</p>
                  ) : null}
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {isWhatsApp ? (
        <div className="flex gap-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escreva uma mensagem..."
            rows={3}
            className="resize-none"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                handleSend();
              }
            }}
          />
          <Button
            onClick={handleSend}
            disabled={pendingSend || !body.trim()}
            className="self-end"
          >
            <Send className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground text-center">
          Envio manual disponivel apenas para conversas WhatsApp.
        </p>
      )}
    </div>
  );
}
