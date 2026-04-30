import Link from "next/link";
import { desc, eq, and } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { requireOrg } from "@/lib/auth/guards";
import { getGmailPayload } from "@/lib/clients/gmail";
import { loadWhatsAppAPICredential } from "@/lib/clients/whatsapp-api";
import { loadUazAPICredential } from "@/lib/clients/whatsapp-uazapi";
import { getBrowserSessionStatus } from "@/lib/clients/browser/storage";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CredentialDialog } from "./credential-dialog";
import { DeleteCredentialButton } from "./delete-credential-button";
import { GoogleOAuthConfigForm } from "./google-oauth-config-form";
import { GmailConnectButton } from "./gmail-connect";
import { loadGoogleOAuthConfigStatus } from "./actions";

export default async function CredentialsPage({
  searchParams,
}: {
  searchParams: Promise<{ google_oauth?: string; google_oauth_error?: string }>;
}) {
  const { organizationId } = await requireOrg();
  const params = await searchParams;

  const [gmail, googleConfig, apiKeyRows, metaCred, uazapiCred, instagram, linkedin] =
    await Promise.all([
      getGmailPayload(organizationId),
      loadGoogleOAuthConfigStatus(),
      db
        .select({ id: credentials.id, provider: credentials.provider, label: credentials.label, createdAt: credentials.createdAt })
        .from(credentials)
        .where(and(
          eq(credentials.organizationId, organizationId),
          // somente chaves de API simples
        ))
        .orderBy(desc(credentials.createdAt)),
      loadWhatsAppAPICredential(organizationId),
      loadUazAPICredential(organizationId),
      getBrowserSessionStatus(organizationId, "instagram_session"),
      getBrowserSessionStatus(organizationId, "linkedin_session"),
    ]);

  // Filtra só as API keys simples para a tabela
  const apiKeyProviders = ["anthropic", "apify", "google_places"];
  const apiKeyList = apiKeyRows.filter((r) => apiKeyProviders.includes(r.provider));

  return (
    <div className="space-y-8 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold">Integracoes</h1>
        <p className="text-sm text-muted-foreground">
          Conecte suas contas e servicos. Tudo criptografado no banco de dados.
        </p>
      </div>

      {params.google_oauth === "connected" && (
        <div className="rounded border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
          Gmail conectado com sucesso.
        </div>
      )}
      {params.google_oauth_error && (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          Falha ao conectar Gmail: {params.google_oauth_error}
        </div>
      )}

      {/* ── WhatsApp ─────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">WhatsApp</h2>
          <Link href="/settings/credentials/whatsapp" className={buttonVariants({ variant: "outline", size: "sm" })}>Gerenciar</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Meta WABA</CardTitle>
                <Badge variant={metaCred ? "default" : "secondary"} className="text-xs">
                  {metaCred ? "Configurado" : "Nao configurado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {metaCred
                ? `Phone ID: ${metaCred.cred.phone_number_id.slice(0, 6)}...`
                : "Clique em Gerenciar para conectar"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">UazAPI</CardTitle>
                <Badge variant={uazapiCred ? "default" : "secondary"} className="text-xs">
                  {uazapiCred ? "Configurado" : "Nao configurado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {uazapiCred
                ? uazapiCred.cred.base_url
                : "Clique em Gerenciar para conectar"}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Gmail ────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-base font-semibold">Gmail</h2>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">1. Aplicativo Google (Client ID e Secret)</CardTitle>
            <CardDescription className="text-xs">
              Crie em console.cloud.google.com &gt; Credenciais &gt; ID do cliente OAuth 2.0
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GoogleOAuthConfigForm
              configured={googleConfig.configured}
              clientIdPreview={googleConfig.clientIdPreview}
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">2. Conectar conta Gmail</CardTitle>
            <CardDescription className="text-xs">
              {googleConfig.configured
                ? "Clique para autorizar o acesso a sua conta Gmail."
                : "Configure o aplicativo Google acima primeiro."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <GmailConnectButton connectedEmail={gmail?.payload.email ?? null} />
          </CardContent>
        </Card>
      </section>

      {/* ── Instagram e LinkedIn ─────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Instagram e LinkedIn</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Conectados via automacao de navegador. Requer acesso ao servidor.
            </p>
          </div>
          <Link href="/settings/credentials/browser" className={buttonVariants({ variant: "outline", size: "sm" })}>Gerenciar</Link>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">Instagram</CardTitle>
                <Badge
                  variant={instagram ? (instagram.needsRelogin ? "destructive" : "default") : "secondary"}
                  className="text-xs"
                >
                  {instagram ? (instagram.needsRelogin ? "Precisa religar" : "Conectado") : "Desconectado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {instagram?.profileUsername ?? "Clique em Gerenciar para ver instrucoes"}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">LinkedIn</CardTitle>
                <Badge
                  variant={linkedin ? (linkedin.needsRelogin ? "destructive" : "default") : "secondary"}
                  className="text-xs"
                >
                  {linkedin ? (linkedin.needsRelogin ? "Precisa religar" : "Conectado") : "Desconectado"}
                </Badge>
              </div>
            </CardHeader>
            <CardContent className="text-xs text-muted-foreground">
              {linkedin?.profileUsername ?? "Clique em Gerenciar para ver instrucoes"}
            </CardContent>
          </Card>
        </div>
      </section>

      {/* ── Chaves de API ────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Chaves de API</h2>
            <p className="text-xs text-muted-foreground mt-0.5">Anthropic, Apify, Google Places</p>
          </div>
          <CredentialDialog />
        </div>
        <div className="border rounded-md">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Servico</TableHead>
                <TableHead>Label</TableHead>
                <TableHead>Criado em</TableHead>
                <TableHead className="text-right">Acoes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {apiKeyList.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-8 text-sm">
                    Nenhuma chave cadastrada
                  </TableCell>
                </TableRow>
              ) : (
                apiKeyList.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Badge variant="secondary">{row.provider}</Badge>
                    </TableCell>
                    <TableCell className="font-medium">{row.label}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {row.createdAt.toLocaleString("pt-BR")}
                    </TableCell>
                    <TableCell className="text-right">
                      <DeleteCredentialButton id={row.id} />
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
