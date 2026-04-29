"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { saveAgentConfig } from "./actions";

type FormState = {
  enabled: boolean;
  businessName: string;
  businessInfo: string;
  tone: string;
  systemPromptOverride: string;
  rules: string[];
  handoffKeywords: string[];
  maxAutoReplies: number;
  model: string;
  temperature: number;
};

export function AgentForm({ initial }: { initial: FormState }) {
  const [state, setState] = useState<FormState>(initial);
  const [ruleDraft, setRuleDraft] = useState("");
  const [kwDraft, setKwDraft] = useState("");
  const [pending, start] = useTransition();

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function addRule() {
    const v = ruleDraft.trim();
    if (!v) return;
    update("rules", [...state.rules, v]);
    setRuleDraft("");
  }

  function removeRule(idx: number) {
    update(
      "rules",
      state.rules.filter((_, i) => i !== idx),
    );
  }

  function addKw() {
    const v = kwDraft.trim();
    if (!v) return;
    update("handoffKeywords", [...state.handoffKeywords, v]);
    setKwDraft("");
  }

  function removeKw(idx: number) {
    update(
      "handoffKeywords",
      state.handoffKeywords.filter((_, i) => i !== idx),
    );
  }

  function submit() {
    start(async () => {
      try {
        await saveAgentConfig({
          ...state,
          businessName: state.businessName.trim() || null,
          businessInfo: state.businessInfo.trim() || null,
          systemPromptOverride: state.systemPromptOverride.trim() || null,
        });
        toast.success("configuracao salva");
      } catch (err) {
        console.error(err);
        toast.error("falha ao salvar");
      }
    });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border p-4">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={state.enabled}
            onChange={(e) => update("enabled", e.target.checked)}
          />
          <span className="text-sm font-medium">
            Agente ativo (responde automaticamente)
          </span>
        </label>
        <p className="mt-1 text-xs text-muted-foreground">
          Mensagens inbound via WhatsApp (UazAPI ou Meta) sao respondidas pelo
          Claude usando as regras abaixo.
        </p>
      </div>

      <div className="grid gap-4 rounded-xl border p-4 md:grid-cols-2">
        <div>
          <Label htmlFor="businessName">Nome do negocio</Label>
          <Input
            id="businessName"
            value={state.businessName}
            onChange={(e) => update("businessName", e.target.value)}
            placeholder="DR.TRAFEGO"
          />
        </div>
        <div>
          <Label htmlFor="tone">Tom de voz</Label>
          <Input
            id="tone"
            value={state.tone}
            onChange={(e) => update("tone", e.target.value)}
            placeholder="profissional e direto"
          />
        </div>
        <div className="md:col-span-2">
          <Label htmlFor="businessInfo">Contexto do negocio</Label>
          <Textarea
            id="businessInfo"
            rows={6}
            value={state.businessInfo}
            onChange={(e) => update("businessInfo", e.target.value)}
            placeholder="O que voces fazem, para quem, quais diferenciais, precos se aplicavel, etc."
          />
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <Label>Regras adicionais</Label>
        <div className="mt-2 flex gap-2">
          <Input
            value={ruleDraft}
            onChange={(e) => setRuleDraft(e.target.value)}
            placeholder="Nao prometa retornos. Nao cite concorrentes."
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addRule();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addRule}>
            Adicionar
          </Button>
        </div>
        {state.rules.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {state.rules.map((r, i) => (
              <li
                key={i}
                className="flex items-center justify-between rounded-md border px-2 py-1 text-sm"
              >
                <span>{r}</span>
                <button
                  type="button"
                  onClick={() => removeRule(i)}
                  aria-label="remover"
                  className="text-muted-foreground hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="rounded-xl border p-4">
        <Label>Palavras-chave de handoff</Label>
        <p className="text-xs text-muted-foreground">
          Se o lead mandar uma dessas, o agente para de responder e marca a
          conversa como aguardando humano.
        </p>
        <div className="mt-2 flex gap-2">
          <Input
            value={kwDraft}
            onChange={(e) => setKwDraft(e.target.value)}
            placeholder="humano"
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addKw();
              }
            }}
          />
          <Button type="button" variant="outline" onClick={addKw}>
            Adicionar
          </Button>
        </div>
        {state.handoffKeywords.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {state.handoffKeywords.map((k, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-0.5 text-xs"
              >
                {k}
                <button type="button" onClick={() => removeKw(i)} aria-label="remover">
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 rounded-xl border p-4 md:grid-cols-3">
        <div>
          <Label htmlFor="maxAutoReplies">Max respostas automaticas</Label>
          <Input
            id="maxAutoReplies"
            type="number"
            min={1}
            max={30}
            value={state.maxAutoReplies}
            onChange={(e) => update("maxAutoReplies", Number(e.target.value))}
          />
        </div>
        <div>
          <Label htmlFor="temperature">Temperatura (0 a 100)</Label>
          <Input
            id="temperature"
            type="number"
            min={0}
            max={100}
            value={state.temperature}
            onChange={(e) => update("temperature", Number(e.target.value))}
          />
        </div>
        <div className="md:col-span-3">
          <Label htmlFor="model">Modelo</Label>
          <Input
            id="model"
            value={state.model}
            onChange={(e) => update("model", e.target.value)}
          />
        </div>
      </div>

      <div className="rounded-xl border p-4">
        <Label htmlFor="systemPromptOverride">
          System prompt manual (opcional)
        </Label>
        <p className="text-xs text-muted-foreground">
          Se preenchido com mais de 40 caracteres, substitui o prompt gerado
          pelas regras acima.
        </p>
        <Textarea
          id="systemPromptOverride"
          rows={8}
          value={state.systemPromptOverride}
          onChange={(e) => update("systemPromptOverride", e.target.value)}
          placeholder="Voce e um agente de vendas que..."
        />
      </div>

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending}>
          {pending ? "Salvando..." : "Salvar configuracao"}
        </Button>
      </div>
    </div>
  );
}
