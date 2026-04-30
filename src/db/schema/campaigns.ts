import { sql } from "drizzle-orm";
import {
  text,
  timestamp,
  uuid,
  jsonb,
  integer,
  index,
  boolean,
} from "drizzle-orm/pg-core";
import { ms } from "./pg-schema";
import { organization } from "./auth";

export const campaignStatusEnum = ms.enum("campaign_status", [
  "draft",
  "active",
  "paused",
  "archived",
]);

export const campaignSourceTypeEnum = ms.enum("campaign_source_type", [
  "google_places",
  "instagram_hashtag",
  "instagram_profile",
  "manual",
  "linkedin_search",
]);

export type FollowUpStep = {
  dayOffset: number;
  copy: string;
};

export const DEFAULT_FOLLOW_UP_SEQUENCE: FollowUpStep[] = [
  {
    dayOffset: 3,
    copy: "Oi {{first_name}}, meu email anterior pode ter sumido no meio da bagunca da caixa de entrada. So queria saber se faz sentido a gente trocar duas ideias rapidas sobre trafego pago pra {{niche}} em {{city}}. Sem compromisso, so um papo curto. Se nao for a hora, me avisa que eu sumo. Abraco, Casal do Tráfego",
  },
  {
    dayOffset: 7,
    copy: "{{first_name}}, voltando aqui. Semana passada um cliente de {{niche}} (parecido com a {{name}}) tinha o mesmo problema que vejo em {{city}}: leads caros e sem qualificacao. Ajustamos a oferta no anuncio e o custo por lead caiu pela metade em 9 dias. Nao e magica, e metodo. Topa eu te mostrar como? Casal do Tráfego",
  },
  {
    dayOffset: 12,
    copy: "Oi {{first_name}}, pensando no que te falei do case. A real e que a maioria em {{niche}} nao tem problema de trafego, tem problema de oferta. Trafego bom em oferta fraca so acelera o prejuizo. Se a {{name}} ja anuncia e sente que o dinheiro evapora, o furo pode estar ai. Posso te apontar onde? Casal do Tráfego",
  },
  {
    dayOffset: 20,
    copy: "{{first_name}}, esse vai ser meu ultimo contato por aqui, prometo. Mandei quatro emails, reforcei, contei um caso, mostrei um angulo novo. Se o timing nao bate agora, tudo bem, a vida segue. Se um dia a {{name}} quiser revisar trafego pra {{niche}} em {{city}}, e so responder essa linha aqui. Abraco, Casal do Tráfego",
  },
];

export const campaigns = ms.table(
  "campaigns",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    niche: text("niche"),
    status: campaignStatusEnum("status").notNull().default("draft"),
    icp: jsonb("icp").$type<Record<string, unknown>>(),
    qualificationPrompt: text("qualification_prompt"),
    qualificationModel: text("qualification_model")
      .notNull()
      .default("claude-sonnet-4-5"),
    dailyLimit: integer("daily_limit").notNull().default(30),
    initialCopy: text("initial_copy"),
    followUpSequence: jsonb("follow_up_sequence")
      .$type<FollowUpStep[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    smartFollowUp: boolean("smart_follow_up").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaigns_org_status_idx").on(t.organizationId, t.status)],
);

export const campaignSources = ms.table(
  "campaign_sources",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    type: campaignSourceTypeEnum("type").notNull(),
    config: jsonb("config").notNull().$type<Record<string, unknown>>(),
    lastRunAt: timestamp("last_run_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("campaign_sources_org_campaign_idx").on(t.organizationId, t.campaignId)],
);
