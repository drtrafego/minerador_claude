"use server";
import { db } from "@/lib/db/client";
import { organization } from "@/db/schema";

export async function createOrgRecord(teamId: string, name: string) {
  await db
    .insert(organization)
    .values({ id: teamId, name })
    .onConflictDoNothing();
}
