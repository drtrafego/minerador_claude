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
import { createCredential } from "./actions";

const providers = [
  { value: "anthropic", label: "Anthropic API Key" },
  { value: "apify", label: "Apify API Key" },
  { value: "google_places", label: "Google Places API Key" },
];

export function CredentialDialog() {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function onSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createCredential(formData);
      if (result && "error" in result && result.error) {
        toast.error("Erro ao salvar: " + JSON.stringify(result.error));
        return;
      }
      toast.success("Credential salva e criptografada");
      setOpen(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button>Adicionar credential</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Adicionar chave de API</DialogTitle>
          <DialogDescription>
            Para WhatsApp, Gmail e Instagram use os cards especificos abaixo.
            Aqui apenas chaves de API simples.
          </DialogDescription>
        </DialogHeader>
        <form action={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="provider">Provider</Label>
            <select
              id="provider"
              name="provider"
              required
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
              placeholder="Ex: conta-principal"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="payload">Payload (JSON)</Label>
            <textarea
              id="payload"
              name="payload"
              required
              rows={6}
              placeholder='{"apiKey": "sk-ant-..."}'
              className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm font-mono shadow-sm"
            />
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
