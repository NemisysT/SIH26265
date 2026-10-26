// Audit log queries and in-app notifications.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { Actor } from "../auth/actor";
import { can, requirePermission } from "../auth/scope";
import { assertUuid } from "./common";

/** Events hidden from institution users on their own record history. */
const INTERNAL_ACTIONS = ["INTERNAL_NOTE_ADDED", "DOCUMENT_DOWNLOADED", "EXTERNAL_VERIFICATION_QUERIED", "AUTOMATED_CHECKS_RECONCILED"];

export interface AuditFilters {
  q?: string;
  action?: string;
  resourceType?: string;
  actorRole?: string;
  from?: string;
  to?: string;
}

export async function listAudit(actor: Actor, f: AuditFilters, paging: { skip: number; take: number }) {
  requirePermission(actor, "audit:read");
  const and: Prisma.AuditEventWhereInput[] = [];
  if (f.action) and.push({ action: { contains: f.action.slice(0, 60), mode: "insensitive" } });
  if (f.resourceType) and.push({ resourceType: f.resourceType.slice(0, 40) });
  if (f.actorRole) and.push({ actorRole: f.actorRole.slice(0, 40) });
  if (f.q) and.push({ OR: [{ actorLabel: { contains: f.q.slice(0, 100), mode: "insensitive" } }, { resourceId: { contains: f.q.slice(0, 100) } }, { reason: { contains: f.q.slice(0, 100), mode: "insensitive" } }] });
  const from = f.from ? new Date(f.from) : null;
  const to = f.to ? new Date(`${f.to}T23:59:59.999Z`) : null;
  if (from && !Number.isNaN(from.getTime())) and.push({ createdAt: { gte: from } });
  if (to && !Number.isNaN(to.getTime())) and.push({ createdAt: { lte: to } });
  const where = { AND: and };
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { id: "desc" }, skip: paging.skip, take: paging.take }),
    prisma.auditEvent.count({ where }),
  ]);
  return { rows, total };
}

/**
 * History panel for a record the caller has ALREADY been authorised to view (callers must load the
 * record through its scoped service first).
 */
export async function recordHistory(actor: Actor, resourceIds: string[]) {
  const where: Prisma.AuditEventWhereInput = { resourceId: { in: resourceIds } };
  if (!can(actor, "comment:internal")) where.action = { notIn: INTERNAL_ACTIONS };
  return prisma.auditEvent.findMany({ where, orderBy: { id: "desc" }, take: 100 });
}

export async function listNotifications(actor: Actor, opts: { unreadOnly?: boolean }, paging: { skip: number; take: number }) {
  const where: Prisma.NotificationWhereInput = { recipientId: actor.id, ...(opts.unreadOnly ? { readAt: null } : {}) };
  const [rows, total, unread] = await Promise.all([
    prisma.notification.findMany({ where, orderBy: { createdAt: "desc" }, include: { deliveries: true }, skip: paging.skip, take: paging.take }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { recipientId: actor.id, readAt: null } }),
  ]);
  return { rows, total, unread };
}

export async function unreadCount(actor: Actor) {
  return prisma.notification.count({ where: { recipientId: actor.id, readAt: null } });
}

/** Mark notifications read — only the recipient's own notifications are affected. */
export async function markRead(actor: Actor, ids: string[] | "all") {
  if (ids !== "all") ids.forEach((id) => assertUuid(id, "Notification"));
  const res = await prisma.notification.updateMany({
    where: { recipientId: actor.id, readAt: null, ...(ids === "all" ? {} : { id: { in: ids } }) },
    data: { readAt: new Date() },
  });
  return res.count;
}
