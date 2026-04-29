import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { requireOrg } from "@/lib/auth/guards";
import { getGmailPayload } from "@/lib/clients/gmail";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CredentialDialog } from "./credential-dialog";
import { DeleteCredentialButton } from "./delete-credential-button";
import { GmailConnectButton } from "./gmail-connect";
import { GoogleOAuthConfigForm } from "./google-oauth-config-form";
import { loadGoogleOAuthConfigStatus } from "./actions";

export default async function CredentialsPage({
  searchParams,
}: {
  searchParams: Promise<{
    google_oauth?: string;
    google_oauth_error?: string;
  }>;
}) {
  const { organizationId } = await requireOrg();
  const params = await searchParams;

  const rows = await db
    .select({
      id: credentials.id,
      provider: credentials.provider,
      label: credentials.label,
      createdAt: credentials.createdAt,
    })
    .from(credentials)
    .where(eq(credentials.organizationId, organizationId))
    .orderBy(desc(credentials.createdAt));

  const [gmail, googleConfig] = await Promise.all([
    getGmailPayload(organizationId),
    loadGoogleOAuthConfigStatus(),
  ]);

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Credentials</h1>
          <p className="text-sm text-muted-foreground">
            Credenciais criptografadas com pgcrypto por organizacao
          </p>
        </div>
        <CredentialDialog />
      </div>

      {params.google_oauth === "connected" ? (
        <div className="rounded border border-green-500/40 bg-green-500/10 p-3 text-sm text-green-700 dark:text-green-300">
          Gmail conectado com sucesso.
        </div>
      ) : null}
      {params.google_oauth_error ? (
        <div className="rounded border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-700 dark:text-red-300">
          Falha ao conectar Gmail: {params.google_oauth_error}
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Google OAuth — Aplicativo</CardTitle>
          <CardDescription>
            Client ID e Secret do seu projeto no Google Cloud Console.
            Necessario antes de conectar o Gmail.
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
          <CardTitle>Gmail</CardTitle>
          <CardDescription>
            Conta usada para enviar outreach de email.
            Conecte apos configurar o aplicativo Google acima.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <GmailConnectButton
            connectedEmail={gmail?.payload.email ?? null}
          />
        </CardContent>
      </Card>

      <div className="border rounded-md">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Provider</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Criado em</TableHead>
              <TableHead className="text-right">Acoes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                  Nenhuma credential cadastrada
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <Badge variant="secondary">{row.provider}</Badge>
                  </TableCell>
                  <TableCell className="font-medium">{row.label}</TableCell>
                  <TableCell className="text-muted-foreground">
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
    </div>
  );
}
