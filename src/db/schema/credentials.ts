import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  index,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";

export const credentialProviderEnum = ms.enum("credential_provider", [
  "anthropic",
  "apify",
  "google_oauth",
  "google_oauth_config",
  "google_places",
  "instagram_session",
  "linkedin_session",
  "proxycurl",
  "whatsapp_session",
  "whatsapp_api",
  "whatsapp_uazapi",
]);

export const credentials = ms.table(
  "credentials",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    provider: credentialProviderEnum("provider").notNull(),
    label: text("label").notNull(),
    ciphertext: text("ciphertext").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("credentials_org_provider_idx").on(t.organizationId, t.provider)],
);
