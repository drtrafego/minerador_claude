"use client";

import { Suspense, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useUser } from "@stackframe/stack";
import { createOrgRecord } from "@/lib/actions/onboarding";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function OnboardingPage() {
  return (
    <Suspense>
      <OnboardingContent />
    </Suspense>
  );
}

function OnboardingContent() {
  const router = useRouter();
  const user = useUser({ or: "redirect" });
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const name = String(fd.get("name") ?? "").trim();
    if (!name) {
      toast.error("Nome obrigatorio");
      return;
    }
    setLoading(true);
    try {
      const team = await user.createTeam({ displayName: name });
      await user.setSelectedTeam(team);
      await createOrgRecord(team.id, name);
      router.push("/dashboard");
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Falha ao criar organizacao");
      setLoading(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Bem-vindo</CardTitle>
        <CardDescription>
          Crie sua primeira organizacao para comecar
        </CardDescription>
      </CardHeader>
      <form onSubmit={onSubmit}>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Nome da organizacao</Label>
            <Input id="name" name="name" placeholder="DR.TRAFEGO" required />
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? "Criando..." : "Criar e continuar"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
