"use server";

import { revalidatePath } from "next/cache";
import { and, eq, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db/client";
import { credentials } from "@/db/schema/credentials";
import { encryptCredential, decryptCredential } from "@/lib/crypto/credentials";
import { requireOrg } from "@/lib/auth/guards";

const providerEnum = z.enum([
  "anthropic",
  "apify",
  "google_oauth",
  "google_oauth_config",
  "google_places",
  "instagram_session",
  "whatsapp_api",
  "whatsapp_uazapi",
]);

const createSchema = z.object({
  provider: providerEnum,
  label: z.string().min(1).max(100),
  payload: z.string().min(1),
});

export async function createCredential(formData: FormData) {
  const { organizationId } = await requireOrg();

  const parsed = createSchema.safeParse({
    provider: formData.get("provider"),
    label: formData.get("label"),
    payload: formData.get("payload"),
  });
  if (!parsed.success) {
    return { error: parsed.error.flatten().fieldErrors };
  }

  let payloadObj: Record<string, unknown>;
  try {
    payloadObj = JSON.parse(parsed.data.payload);
    if (typeof payloadObj !== "object" || payloadObj === null || Array.isArray(payloadObj)) {
      return { error: { payload: ["JSON deve ser um objeto"] } };
    }
  } catch {
    return { error: { payload: ["JSON invalido"] } };
  }

  const ciphertext = await encryptCredential(payloadObj);

  await db.insert(credentials).values({
    organizationId,
    provider: parsed.data.provider,
    label: parsed.data.label,
    ciphertext,
  });

  revalidatePath("/settings/credentials");
  return { ok: true };
}

const apiKeySchema = z.object({
  provider: providerEnum,
  label: z.string().min(1).max(100),
  apiKey: z.string().min(1),
});

export async function saveApiKey(formData: FormData) {
  const { organizationId } = await requireOrg();

  const parsed = apiKeySchema.safeParse({
    provider: formData.get("provider"),
    label: formData.get("label"),
    apiKey: formData.get("apiKey"),
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const ciphertext = await encryptCredential({ apiKey: parsed.data.apiKey });

  await db.insert(credentials).values({
    organizationId,
    provider: parsed.data.provider,
    label: parsed.data.label,
    ciphertext,
  });

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function deleteCredential(formData: FormData) {
  const { organizationId } = await requireOrg();
  const id = String(formData.get("id") ?? "");
  if (!id) return { error: "id obrigatorio" };

  await db
    .delete(credentials)
    .where(and(eq(credentials.id, id), eq(credentials.organizationId, organizationId)));

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function disconnectGmail() {
  const { organizationId } = await requireOrg();
  await db
    .delete(credentials)
    .where(
      and(
        eq(credentials.organizationId, organizationId),
        eq(credentials.provider, "google_oauth"),
      ),
    );
  revalidatePath("/settings/credentials");
  return { ok: true };
}

const googleOAuthConfigSchema = z.object({
  clientId: z.string().min(10),
  clientSecret: z.string().min(10),
});

export async function saveGoogleOAuthConfig(formData: FormData) {
  const { organizationId } = await requireOrg();
  const parsed = googleOAuthConfigSchema.safeParse({
    clientId: formData.get("clientId"),
    clientSecret: formData.get("clientSecret"),
  });
  if (!parsed.success) return { error: parsed.error.flatten().fieldErrors };

  const ciphertext = await encryptCredential(parsed.data as unknown as Record<string, unknown>);

  const existing = await db
    .select({ id: credentials.id })
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "google_oauth_config")))
    .orderBy(desc(credentials.createdAt))
    .limit(1);

  if (existing[0]) {
    await db.update(credentials).set({ ciphertext, updatedAt: new Date() }).where(eq(credentials.id, existing[0].id));
  } else {
    await db.insert(credentials).values({ organizationId, provider: "google_oauth_config", label: "Google OAuth App", ciphertext });
  }

  revalidatePath("/settings/credentials");
  return { ok: true };
}

export async function loadGoogleOAuthConfigStatus() {
  const { organizationId } = await requireOrg();
  const row = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.organizationId, organizationId), eq(credentials.provider, "google_oauth_config")))
    .orderBy(desc(credentials.createdAt))
    .limit(1)
    .then((r) => r[0] ?? null);

  if (!row) return { configured: false, clientIdPreview: null };
  try {
    const config = await decryptCredential<{ clientId: string; clientSecret: string }>(row.ciphertext);
    return { configured: true, clientIdPreview: config.clientId.slice(0, 8) + "..." };
  } catch {
    return { configured: false, clientIdPreview: null };
  }
}
