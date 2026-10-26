// Administrator-configurable operational policy. The defaults are DEMONSTRATION values only —
// they are not established AICTE deadlines and must be confirmed before real use.
import { z } from "zod";
import { prisma, type Db } from "./db";
import { recordAudit } from "./audit";
import type { Actor } from "./auth/actor";
import { ValidationError } from "./errors";

const dayList = z
  .array(z.number().int().min(0).max(365))
  .min(1)
  .max(10)
  .transform((a) => [...new Set(a)].sort((x, y) => y - x));

export const settingsSchema = z.object({
  /** Days before maturity at which reminders are generated (0 = on the maturity date). */
  reminderWindowsDays: dayList,
  /** Days after maturity at which unresolved cases are escalated, in order of escalation level. */
  postMaturityEscalationDays: z
    .array(z.number().int().min(1).max(365))
    .min(1)
    .max(5)
    .transform((a) => [...new Set(a)].sort((x, y) => x - y)),
  /** Window used for the "expiring soon" classification and dashboard metric. */
  expiringSoonDays: z.number().int().min(1).max(365),
  /** Submitted / under-review records older than this are reported overdue. */
  scrutinySlaDays: z.number().int().min(1).max(90),
  /** Institutions must respond to correction requests within this many days. */
  correctionResponseDays: z.number().int().min(1).max(90),
  /** Release / refund requests awaiting a scrutiny or approval step longer than this are overdue. */
  releaseDecisionSlaDays: z.number().int().min(1).max(90),
  /**
   * When true, CONFIRMED verification requires independent evidence (bank confirmation letter or a
   * real external provider). Manual document review alone can never mark an instrument confirmed.
   */
  requireIndependentConfirmation: z.boolean(),
  /** Generate (simulated) email deliveries in addition to in-app notifications. */
  emailNotifications: z.boolean(),
  maxDeliveryAttempts: z.number().int().min(1).max(10),
  maxUploadMb: z.number().int().min(1).max(25),
});

export type Settings = z.infer<typeof settingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  reminderWindowsDays: [90, 60, 30, 7, 0],
  postMaturityEscalationDays: [7, 30],
  expiringSoonDays: 90,
  scrutinySlaDays: 7,
  correctionResponseDays: 15,
  releaseDecisionSlaDays: 10,
  requireIndependentConfirmation: true,
  emailNotifications: true,
  maxDeliveryAttempts: 3,
  maxUploadMb: 10,
};

const SETTINGS_KEY = "policy";

export async function getSettings(db: Db = prisma): Promise<Settings> {
  const row = await db.systemSetting.findUnique({ where: { key: SETTINGS_KEY } });
  if (!row) return DEFAULT_SETTINGS;
  const parsed = settingsSchema.safeParse({ ...DEFAULT_SETTINGS, ...(row.value as object) });
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function updateSettings(actor: Actor, input: unknown): Promise<Settings> {
  const parsed = settingsSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError("Settings are invalid.", z.flattenError(parsed.error).fieldErrors);
  }
  return prisma.$transaction(async (tx) => {
    const before = await getSettings(tx);
    await tx.systemSetting.upsert({
      where: { key: SETTINGS_KEY },
      create: { key: SETTINGS_KEY, value: parsed.data, updatedById: actor.id },
      update: { value: parsed.data, updatedById: actor.id },
    });
    await recordAudit(tx, actor, {
      action: "SETTINGS_UPDATED",
      resourceType: "SystemSetting",
      resourceId: SETTINGS_KEY,
      before,
      after: parsed.data,
    });
    return parsed.data;
  });
}
