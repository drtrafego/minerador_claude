"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { saveApiKey } from "./actions";

const providers = [
  {
    value: "anthropic",
    label: "Anthropic",
    placeholder: "sk-ant-api03-...",
    hint: "Encontre em console.anthropic.com → API Keys",
  },
  {
    value: "apify",
    label: "Apify",
    placeholder: "apify_api_...",
    hint: "Encontre em console.apify.com → Settings → API tokens",
  },
  {
    value: "google_places",
    label: "Google Places",
    placeholder: "AIza...",
    hint: "Crie em console.cloud.google.com → Credenciais → Chave de API",
  },
] as const;

export function CredentialDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [selectedProvider, setSelectedProvider] = useState<string>("anthropic");

  const current = providers.find((p) => p.value === selectedProvider) ?? providers[0];

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    startTransition(async () => {
      const result = await saveApiKey(fd);
      if (result && "error" in result) {
        toast.error("Erro ao salvar credencial");
        return;
      }
      toast.success(`${current.label} salvo com sucesso`);
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Adicionar chave</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar chave de API</DialogTitle>
          <DialogDescription>
            A chave sera criptografada e armazenada com seguranca.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="provider">Servico</Label>
            <select
              id="provider"
              name="provider"
              required
              value={selectedProvider}
              onChange={(e) => setSelectedProvider(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {providers.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="label">Label</Label>
            <Input
              id="label"
              name="label"
              placeholder="Ex: principal"
              defaultValue="principal"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="apiKey">Chave de API</Label>
            <Input
              id="apiKey"
              name="apiKey"
              type="password"
              placeholder={current.placeholder}
              required
            />
            <p className="text-xs text-muted-foreground">{current.hint}</p>
          </div>

          <DialogFooter>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Salvando..." : "Salvar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
