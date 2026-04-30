"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  createAndStartCampaign,
  type CreateCampaignInput,
} from "../actions";
import { DEFAULT_FOLLOW_UP_SEQUENCE } from "@/db/schema/campaigns";

type SourceType = "google_places" | "instagram_hashtag" | "linkedin_search";

const MODELS = [
  { value: "claude-haiku-4-5", label: "Haiku 4.5 — rapido e economico" },
  { value: "claude-sonnet-4-5", label: "Sonnet 4.5 — equilibrado (recomendado)" },
  { value: "claude-opus-4-5", label: "Opus 4.5 — mais poderoso" },
] as const;

type FollowUpStepDraft = {
  dayOffset: string;
  copy: string;
};

type State = {
  step: 1 | 2 | 3 | 4;
  name: string;
  niche: string;
  activeSources: SourceType[];
  googleQuery: string;
  googleLocation: string;
  googleRadius: string;
  googleMaxResults: string;
  igSearch: string;
  igMaxResults: string;
  linkedinQuery: string;
  linkedinMaxResults: string;
  prompt: string;
  model: string;
  initialCopy: string;
  followUpSequence: FollowUpStepDraft[];
  smartFollowUp: boolean;
};

const DEFAULT_INITIAL_COPY = (niche: string) =>
  [
    `Oi {{first_name}}, tudo bem?`,
    ``,
    `Vi que voces trabalham com ${niche || "[nicho]"} em {{city}} e queria trocar uma ideia rapidinha sobre uma oportunidade que pode fazer sentido pra voces.`,
    ``,
    `Tem 10 minutos essa semana pra gente conversar?`,
  ].join("\n");

const DEFAULT_FOLLOWUPS: FollowUpStepDraft[] = DEFAULT_FOLLOW_UP_SEQUENCE.map(
  (step) => ({ dayOffset: String(step.dayOffset), copy: step.copy }),
);

const DEFAULT_PROMPT = (niche: string) =>
  [
    `Voce avalia se este lead e ideal para o nicho "${niche || "[nicho]"}".`,
    "",
    "ICP:",
    "- empresa ou perfil ativo nos ultimos 90 dias",
    "- demonstra interesse real pelo segmento",
    "- tem indicios de capacidade de compra",
    "",
    "Para cada lead retorne:",
    "- decision: approved (encaixa no ICP) ou rejected",
    "- score: 0-100",
    "- reason: breve justificativa em uma frase",
  ].join("\n");

export function CampaignWizard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<State>({
    step: 1,
    name: "",
    niche: "",
    activeSources: ["google_places"],
    googleQuery: "",
    googleLocation: "",
    googleRadius: "5000",
    googleMaxResults: "60",
    igSearch: "",
    igMaxResults: "30",
    linkedinQuery: "",
    linkedinMaxResults: "50",
    prompt: "",
    model: "claude-sonnet-4-5",
    initialCopy: "",
    followUpSequence: DEFAULT_FOLLOWUPS,
    smartFollowUp: false,
  });

  function update<K extends keyof State>(key: K, value: State[K]) {
    setState((s) => ({ ...s, [key]: value }));
  }

  function toggleSource(source: SourceType, checked: boolean) {
    setState((s) => ({
      ...s,
      activeSources: checked
        ? [...s.activeSources, source]
        : s.activeSources.filter((x) => x !== source),
    }));
  }

  function next() {
    if (state.step === 1) {
      if (!state.name.trim() || !state.niche.trim()) {
        toast.error("preencha nome e nicho");
        return;
      }
      if (state.activeSources.length === 0) {
        toast.error("selecione ao menos uma fonte");
        return;
      }
      setState((s) => ({ ...s, step: 2 }));
      return;
    }
    if (state.step === 2) {
      if (state.activeSources.includes("google_places") && !state.googleQuery.trim()) {
        toast.error("preencha a query do Google Maps");
        return;
      }
      if (state.activeSources.includes("instagram_hashtag") && !state.igSearch.trim()) {
        toast.error("preencha o termo de busca do Instagram");
        return;
      }
      if (state.activeSources.includes("linkedin_search") && !state.linkedinQuery.trim()) {
        toast.error("preencha a query do LinkedIn");
        return;
      }
      setState((s) => ({
        ...s,
        step: 3,
        prompt: s.prompt || DEFAULT_PROMPT(s.niche),
      }));
      return;
    }
    if (state.step === 3) {
      if (state.prompt.trim().length < 10) {
        toast.error("prompt muito curto");
        return;
      }
      setState((s) => ({
        ...s,
        step: 4,
        initialCopy: s.initialCopy || DEFAULT_INITIAL_COPY(s.niche),
      }));
      return;
    }
  }

  function back() {
    if (state.step > 1) {
      setState((s) => ({ ...s, step: (s.step - 1) as 1 | 2 | 3 | 4 }));
    }
  }

  function addFollowUp() {
    setState((s) => ({
      ...s,
      followUpSequence: [
        ...s.followUpSequence,
        { dayOffset: "7", copy: "" },
      ],
    }));
  }

  function removeFollowUp(index: number) {
    setState((s) => ({
      ...s,
      followUpSequence: s.followUpSequence.filter((_, i) => i !== index),
    }));
  }

  function updateFollowUp(
    index: number,
    field: keyof FollowUpStepDraft,
    value: string,
  ) {
    setState((s) => ({
      ...s,
      followUpSequence: s.followUpSequence.map((step, i) =>
        i === index ? { ...step, [field]: value } : step,
      ),
    }));
  }

  function submit() {
    if (state.prompt.trim().length < 10) {
      toast.error("prompt muito curto");
      return;
    }

    const sources: CreateCampaignInput["sources"] = [];

    if (state.activeSources.includes("google_places")) {
      sources.push({
        type: "google_places",
        query: state.googleQuery,
        location: state.googleLocation || undefined,
        radius: state.googleRadius ? Number(state.googleRadius) : undefined,
        maxResults: state.googleMaxResults ? Number(state.googleMaxResults) : undefined,
      });
    }
    if (state.activeSources.includes("instagram_hashtag")) {
      sources.push({
        type: "instagram_hashtag",
        search: state.igSearch,
        maxResults: state.igMaxResults ? Number(state.igMaxResults) : undefined,
      });
    }
    if (state.activeSources.includes("linkedin_search")) {
      sources.push({
        type: "linkedin_search",
        query: state.linkedinQuery,
        maxResults: state.linkedinMaxResults ? Number(state.linkedinMaxResults) : undefined,
      });
    }

    const followUpSequence = state.followUpSequence
      .filter((s) => s.copy.trim().length > 0)
      .map((s) => ({
        dayOffset: Number(s.dayOffset || "0") || 0,
        copy: s.copy.trim(),
      }));

    const input: CreateCampaignInput = {
      name: state.name,
      niche: state.niche,
      qualificationPrompt: state.prompt,
      qualificationModel: state.model,
      initialCopy: state.initialCopy.trim(),
      followUpSequence,
      smartFollowUp: state.smartFollowUp,
      sources,
    };

    startTransition(async () => {
      const res = await createAndStartCampaign(input);
      if ("error" in res && res.error) {
        toast.error("falha ao criar campanha");
        console.error(res.error);
        return;
      }
      if ("campaignId" in res && res.campaignId) {
        toast.success("campanha criada e iniciada");
        router.push(`/campaigns/${res.campaignId}`);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Passo {state.step} de 4</CardTitle>
        <CardDescription>
          {state.step === 1 && "Identifique a campanha"}
          {state.step === 2 && "Configure as fontes de leads"}
          {state.step === 3 && "Configure o agente de qualificacao"}
          {state.step === 4 && "Sequencia de follow up do outreach"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {state.step === 1 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="name">Nome da campanha</Label>
              <Input
                id="name"
                value={state.name}
                onChange={(e) => update("name", e.target.value)}
                placeholder="Ex: Restaurantes Sao Paulo Q2"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="niche">Nicho</Label>
              <Input
                id="niche"
                value={state.niche}
                onChange={(e) => update("niche", e.target.value)}
                placeholder="Ex: hamburgueria artesanal"
              />
            </div>
            <div className="space-y-2">
              <Label>Fontes de mineracao</Label>
              <p className="text-xs text-muted-foreground">
                Selecione uma ou mais fontes simultaneas
              </p>
              <div className="flex flex-col gap-2">
                {(
                  [
                    { value: "google_places" as SourceType, label: "Google Maps" },
                    { value: "instagram_hashtag" as SourceType, label: "Instagram" },
                    { value: "linkedin_search" as SourceType, label: "LinkedIn" },
                  ] as const
                ).map(({ value, label }) => (
                  <label
                    key={value}
                    className="flex cursor-pointer items-center gap-3 rounded-lg border border-input p-3 hover:border-ring"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-input"
                      checked={state.activeSources.includes(value)}
                      onChange={(e) => toggleSource(value, e.target.checked)}
                    />
                    <span className="text-sm">{label}</span>
                  </label>
                ))}
              </div>
            </div>
          </div>
        ) : null}

        {state.step === 2 ? (
          <div className="space-y-6">
            {state.activeSources.includes("google_places") && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">Google Maps</p>
                <div className="space-y-2">
                  <Label htmlFor="googleQuery">Query de busca</Label>
                  <Input
                    id="googleQuery"
                    value={state.googleQuery}
                    onChange={(e) => update("googleQuery", e.target.value)}
                    placeholder="hamburgueria artesanal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="googleLocation">Cidade ou regiao</Label>
                  <Input
                    id="googleLocation"
                    value={state.googleLocation}
                    onChange={(e) => update("googleLocation", e.target.value)}
                    placeholder="Sao Paulo, SP"
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="googleRadius">Raio (metros)</Label>
                    <Input
                      id="googleRadius"
                      value={state.googleRadius}
                      onChange={(e) => update("googleRadius", e.target.value)}
                      type="number"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="googleMaxResults">Max resultados</Label>
                    <Input
                      id="googleMaxResults"
                      value={state.googleMaxResults}
                      onChange={(e) => update("googleMaxResults", e.target.value)}
                      type="number"
                    />
                  </div>
                </div>
              </div>
            )}

            {state.activeSources.includes("instagram_hashtag") && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">Instagram</p>
                <div className="space-y-2">
                  <Label htmlFor="igSearch">Termo de busca</Label>
                  <Input
                    id="igSearch"
                    value={state.igSearch}
                    onChange={(e) => update("igSearch", e.target.value)}
                    placeholder="hamburgueria artesanal"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="igMaxResults">Max perfis</Label>
                  <Input
                    id="igMaxResults"
                    value={state.igMaxResults}
                    onChange={(e) => update("igMaxResults", e.target.value)}
                    type="number"
                  />
                </div>
              </div>
            )}

            {state.activeSources.includes("linkedin_search") && (
              <div className="space-y-3 rounded-lg border p-4">
                <p className="text-sm font-medium">LinkedIn</p>
                <div className="space-y-2">
                  <Label htmlFor="linkedinQuery">Query de busca</Label>
                  <Input
                    id="linkedinQuery"
                    value={state.linkedinQuery}
                    onChange={(e) => update("linkedinQuery", e.target.value)}
                    placeholder="head of growth startup brasil"
                  />
                  <p className="text-xs text-muted-foreground">
                    Use termos livres. Ex: cargo, segmento, regiao.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="linkedinMaxResults">Max perfis</Label>
                  <Input
                    id="linkedinMaxResults"
                    value={state.linkedinMaxResults}
                    onChange={(e) => update("linkedinMaxResults", e.target.value)}
                    type="number"
                  />
                </div>
              </div>
            )}
          </div>
        ) : null}

        {state.step === 3 ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="model">Modelo de IA</Label>
              <select
                id="model"
                value={state.model}
                onChange={(e) => update("model", e.target.value)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              >
                {MODELS.map((m) => (
                  <option key={m.value} value={m.value}>
                    {m.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="prompt">Prompt de qualificacao</Label>
              <Textarea
                id="prompt"
                value={state.prompt || DEFAULT_PROMPT(state.niche)}
                onChange={(e) => update("prompt", e.target.value)}
                rows={14}
              />
            </div>
          </div>
        ) : null}

        {state.step === 4 ? (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="initialCopy">
                Copy inicial (mensagem enviada automaticamente aos leads aprovados)
              </Label>
              <p className="text-xs text-muted-foreground">
                Use variaveis: {"{{first_name}}"}, {"{{name}}"}, {"{{company}}"}, {"{{city}}"}
              </p>
              <Textarea
                id="initialCopy"
                value={state.initialCopy}
                onChange={(e) => update("initialCopy", e.target.value)}
                rows={8}
                placeholder="Deixe em branco pra nao disparar outreach automatico"
              />
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Sequencia de follow up</Label>
                  <p className="text-xs text-muted-foreground">
                    Mensagens enviadas apos X dias se nao houver resposta
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={addFollowUp}
                >
                  Adicionar step
                </Button>
              </div>

              <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-input p-3 hover:border-ring">
                <input
                  type="checkbox"
                  className="mt-1 h-4 w-4 rounded border-input"
                  checked={state.smartFollowUp}
                  onChange={(e) => update("smartFollowUp", e.target.checked)}
                />
                <span className="space-y-1 text-sm">
                  <span className="block font-medium">
                    Ativar follow up inteligente (Claude gera cada mensagem dinamicamente)
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    Em vez de enviar a copy fixa de cada step, o sistema pede para o
                    Claude escrever uma nova mensagem mudando o angulo, com base no
                    historico da thread. O dayOffset e o fallback continuam vindo da
                    sequencia abaixo.
                  </span>
                </span>
              </label>

              {state.followUpSequence.length === 0 ? (
                <p className="rounded border border-dashed p-4 text-center text-xs text-muted-foreground">
                  Sem follow ups. Clique em adicionar.
                </p>
              ) : (
                <ul className="space-y-3">
                  {state.followUpSequence.map((stepDraft, idx) => (
                    <li
                      key={idx}
                      className="space-y-2 rounded border p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium text-muted-foreground">
                          Step {idx + 1}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => removeFollowUp(idx)}
                        >
                          Remover
                        </Button>
                      </div>
                      <div className="grid grid-cols-4 gap-3">
                        <div className="col-span-1 space-y-1">
                          <Label
                            htmlFor={`fu-day-${idx}`}
                            className="text-xs"
                          >
                            Dias apos envio anterior
                          </Label>
                          <Input
                            id={`fu-day-${idx}`}
                            type="number"
                            min="0"
                            value={stepDraft.dayOffset}
                            onChange={(e) =>
                              updateFollowUp(idx, "dayOffset", e.target.value)
                            }
                          />
                        </div>
                        <div className="col-span-3 space-y-1">
                          <Label
                            htmlFor={`fu-copy-${idx}`}
                            className="text-xs"
                          >
                            Mensagem
                          </Label>
                          <Textarea
                            id={`fu-copy-${idx}`}
                            value={stepDraft.copy}
                            onChange={(e) =>
                              updateFollowUp(idx, "copy", e.target.value)
                            }
                            rows={4}
                          />
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        <div className="flex justify-between pt-4">
          <Button variant="outline" onClick={back} disabled={state.step === 1 || pending}>
            Voltar
          </Button>
          {state.step < 4 ? (
            <Button onClick={next} disabled={pending}>
              Proximo
            </Button>
          ) : (
            <Button onClick={submit} disabled={pending}>
              {pending ? "Criando..." : "Criar e comecar"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
