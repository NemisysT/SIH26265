// In-app notifications (authoritative) plus optional email deliveries tracked per channel.
import type { NotificationType } from "@prisma/client";
import { prisma, type Db } from "../db";
import { getSettings } from "../settings";
import { env } from "../env";
import { getEmailProvider } from "./email-provider";
import { now } from "../clock";

export interface NotifyInput {
  recipientIds: string[];
  type: NotificationType;
  title: string;
  message: string;
  link?: string;
  institutionId?: string | null;
  instrumentId?: string | null;
  releaseRequestId?: string | null;
  dueDate?: Date | null;
  /** Idempotency key for scheduled reminders; combined with the recipient id. */
  dedupeKey?: string;
}

/**
 * Create notifications for each recipient. With a dedupeKey, a repeated call for the same event
 * creates nothing new (INSERT … ON CONFLICT DO NOTHING), even under concurrent scheduler runs.
 * Returns the number of notifications actually created.
 */
export async function notify(db: Db, input: NotifyInput): Promise<number> {
  const recipients = [...new Set(input.recipientIds)];
  if (recipients.length === 0) return 0;
  const created = await db.notification.createManyAndReturn({
    data: recipients.map((recipientId) => ({
      recipientId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
      institutionId: input.institutionId ?? null,
      instrumentId: input.instrumentId ?? null,
      releaseRequestId: input.releaseRequestId ?? null,
      dueDate: input.dueDate ?? null,
      dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${recipientId}` : null,
      createdAt: now(),
    })),
    skipDuplicates: true,
    select: { id: true },
  });
  if (created.length === 0) return 0;
  const settings = await getSettings(db);
  const emailOn = settings.emailNotifications && env.emailMode !== "disabled";
  await db.notificationDelivery.createMany({
    data: created.flatMap((n) => [
      { notificationId: n.id, channel: "IN_APP" as const, status: "DELIVERED" as const, attempts: 1, deliveredAt: now(), createdAt: now() },
      ...(emailOn ? [{ notificationId: n.id, channel: "EMAIL" as const, status: "PENDING" as const, createdAt: now() }] : []),
    ]),
  });
  return created.length;
}

// ---------------------------------------------------------------- recipients

export async function institutionUserIds(db: Db, institutionId: string): Promise<string[]> {
  const users = await db.user.findMany({ where: { institutionId, role: "INSTITUTION_USER", status: "ACTIVE" }, select: { id: true } });
  return users.map((u) => u.id);
}

export async function officerIdsForInstitution(db: Db, institutionId: string): Promise<string[]> {
  const inst = await db.institution.findUnique({ where: { id: institutionId }, select: { regionId: true } });
  if (!inst) return [];
  const users = await db.user.findMany({
    where: { role: "OFFICER", status: "ACTIVE", officerRegions: { some: { regionId: inst.regionId } } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

export async function userIdsByRole(db: Db, role: "APPROVING_AUTHORITY" | "ADMIN"): Promise<string[]> {
  const users = await db.user.findMany({ where: { role, status: "ACTIVE" }, select: { id: true } });
  return users.map((u) => u.id);
}

// ---------------------------------------------------------------- delivery processing

/**
 * Attempt pending email deliveries with bounded retries and exponential backoff. Failures are
 * recorded with their error; nothing is marked delivered unless the provider accepted it, and the
 * simulated provider is recorded as SIMULATED.
 */
export async function processDeliveries(now = new Date(), limit = 200) {
  const settings = await getSettings();
  const provider = getEmailProvider();
  const due = await prisma.notificationDelivery.findMany({
    where: {
      channel: "EMAIL",
      status: "PENDING",
      OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
    },
    include: { notification: { include: { recipient: { select: { email: true, status: true } } } } },
    take: limit,
    orderBy: { createdAt: "asc" },
  });
  const result = { attempted: 0, simulated: 0, delivered: 0, failed: 0, retryScheduled: 0, skipped: 0 };
  for (const d of due) {
    if (d.notification.recipient.status !== "ACTIVE") {
      await prisma.notificationDelivery.update({ where: { id: d.id }, data: { status: "SKIPPED", lastError: "Recipient inactive" } });
      result.skipped++;
      continue;
    }
    result.attempted++;
    const attempts = d.attempts + 1;
    try {
      const { providerRef } = await provider.send({
        to: d.notification.recipient.email,
        subject: d.notification.title,
        body: d.notification.message,
      });
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          status: provider.isSimulated ? "SIMULATED" : "DELIVERED",
          isSimulated: provider.isSimulated,
          attempts,
          deliveredAt: provider.isSimulated ? null : now,
          providerRef,
          lastError: null,
          nextAttemptAt: null,
        },
      });
      if (provider.isSimulated) result.simulated++;
      else result.delivered++;
    } catch (err) {
      const exhausted = attempts >= settings.maxDeliveryAttempts;
      await prisma.notificationDelivery.update({
        where: { id: d.id },
        data: {
          status: exhausted ? "FAILED" : "PENDING",
          attempts,
          lastError: (err instanceof Error ? err.message : String(err)).slice(0, 500),
          nextAttemptAt: exhausted ? null : new Date(now.getTime() + 2 ** attempts * 60_000),
        },
      });
      if (exhausted) result.failed++;
      else result.retryScheduled++;
    }
  }
  return result;
}
