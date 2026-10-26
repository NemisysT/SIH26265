// Dashboard metrics — every figure is computed from the database within the actor's data scope
// using the shared rules in rules.ts. Nothing is hard-coded.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { Actor } from "../auth/actor";
import { institutionScope, instrumentScope, releaseScope, requirePermission } from "../auth/scope";
import { getSettings } from "../settings";
import { addDays, businessToday } from "@/lib/dates";
import { now } from "../clock";
import * as rules from "./rules";
import { OPEN_RELEASE_STATUSES } from "../workflow/release-machine";

const scoped = (actor: Actor, w: Prisma.InstrumentWhereInput): Prisma.InstrumentWhereInput => ({ AND: [instrumentScope(actor), w] });

export const MATURITY_BUCKETS = [
  { key: "matured", label: "Matured", min: null, max: 0 },
  { key: "0-30", label: "≤ 30 days", min: 1, max: 30 },
  { key: "31-60", label: "31–60 days", min: 31, max: 60 },
  { key: "61-90", label: "61–90 days", min: 61, max: 90 },
  { key: "91-180", label: "91–180 days", min: 91, max: 180 },
  { key: "181-365", label: "181–365 days", min: 181, max: 365 },
  { key: ">365", label: "> 1 year", min: 366, max: null },
] as const;

export async function getDashboard(actor: Actor) {
  requirePermission(actor, "instrument:read");
  const settings = await getSettings();
  const nowTs = now();
  const today = businessToday(nowTs);
  const count = (w: Prisma.InstrumentWhereInput) => prisma.instrument.count({ where: scoped(actor, w) });

  const [
    active,
    expiring30,
    expiring60,
    expiringWindow,
    maturedAwaiting,
    pendingVerification,
    withDiscrepancies,
    missingDocs,
    renewalsInProgress,
    pendingReleases,
    overdueInstruments,
    overdueReleases,
    statusGroups,
  ] = await Promise.all([
    prisma.instrument.aggregate({ where: scoped(actor, rules.held), _count: true, _sum: { amount: true } }),
    count(rules.expiringWithin(today, 30)),
    count(rules.expiringWithin(today, 60)),
    count(rules.expiringWithin(today, settings.expiringSoonDays)),
    count(rules.maturedAwaitingAction(today)),
    count(rules.pendingVerification),
    count(rules.withOpenDiscrepancies),
    count(rules.missingPrimaryDocument),
    prisma.renewalCase.count({ where: { status: "IN_PROGRESS", originalInstrument: instrumentScope(actor) } }),
    prisma.releaseRequest.aggregate({ where: { AND: [releaseScope(actor), { status: { in: OPEN_RELEASE_STATUSES } }] }, _count: true, _sum: { requestedAmount: true } }),
    count(rules.overdueInstruments(today, nowTs, settings)),
    prisma.releaseRequest.count({ where: { AND: [releaseScope(actor), rules.overdueReleases(nowTs, settings)] } }),
    prisma.instrument.groupBy({ by: ["status"], where: instrumentScope(actor), _count: { _all: true } }),
  ]);

  const maturityBuckets = await Promise.all(
    MATURITY_BUCKETS.map(async (b) => {
      const range: Prisma.DateTimeNullableFilter = {};
      if (b.min !== null) range.gte = addDays(today, b.min);
      if (b.max !== null) range.lte = addDays(today, b.max);
      return { ...b, count: await count({ status: "ACCEPTED", maturityDate: range }) };
    }),
  );

  const upcoming = await prisma.instrument.findMany({
    where: scoped(actor, { status: "ACCEPTED", maturityDate: { lte: addDays(today, settings.expiringSoonDays) } }),
    orderBy: { maturityDate: "asc" },
    take: 8,
    include: {
      institution: { select: { name: true, code: true } },
      renewalsAsOriginal: { where: { status: "IN_PROGRESS" }, select: { referenceNo: true } },
      releaseRequests: { where: { status: { in: OPEN_RELEASE_STATUSES } }, select: { referenceNo: true } },
    },
  });

  // Recent workflow activity limited to institutions in scope.
  const institutionIds = (await prisma.institution.findMany({ where: institutionScope(actor), select: { id: true } })).map((i) => i.id);
  const activityWhere: Prisma.AuditEventWhereInput = {
    institutionId: { in: institutionIds },
    action: { notIn: ["DOCUMENT_DOWNLOADED", "INTERNAL_NOTE_ADDED", "AUTOMATED_CHECKS_RECONCILED", "REPORT_EXPORTED", "LOGIN_SUCCEEDED", "LOGIN_FAILED", "LOGIN_LOCKED", "MONITOR_RUN"] },
  };
  const activity = await prisma.auditEvent.findMany({ where: activityWhere, orderBy: { createdAt: "desc" }, take: 10 });

  return {
    settings,
    today,
    metrics: {
      activeCount: active._count,
      activeValue: active._sum.amount,
      expiring30,
      expiring60,
      expiringWindow,
      maturedAwaiting,
      pendingVerification,
      withDiscrepancies,
      missingDocs,
      renewalsInProgress,
      pendingReleases: pendingReleases._count,
      pendingReleaseValue: pendingReleases._sum.requestedAmount,
      overdueInstruments,
      overdueReleases,
      overdue: overdueInstruments + overdueReleases,
    },
    statusDistribution: statusGroups.map((g) => ({ status: g.status, count: g._count._all })).sort((a, b) => b.count - a.count),
    maturityBuckets,
    upcoming,
    activity,
    tasks: await getTasks(actor),
  };
}

export async function getTasks(actor: Actor) {
  const s = instrumentScope(actor);
  const r = releaseScope(actor);
  const ic = (w: Prisma.InstrumentWhereInput) => prisma.instrument.count({ where: { AND: [s, w] } });
  const rc = (w: Prisma.ReleaseRequestWhereInput) => prisma.releaseRequest.count({ where: { AND: [r, w] } });
  const today = businessToday(now());
  switch (actor.role) {
    case "INSTITUTION_USER":
      return [
        { label: "Drafts not yet submitted", count: await ic({ status: "DRAFT" }), href: "/instruments?view=drafts" },
        { label: "Corrections requested by the Bureau", count: await ic({ status: "CORRECTION_REQUIRED" }), href: "/instruments?status=CORRECTION_REQUIRED" },
        { label: "Release requests needing information", count: await rc({ status: "INFO_REQUESTED" }), href: "/releases?view=awaiting-me" },
        { label: "Instruments maturing within 30 days (no action started)", count: await ic({ AND: [rules.expiringWithin(today, 30), rules.noActionUnderway] }), href: "/renewals" },
        { label: "Matured instruments awaiting renewal or release", count: await ic(rules.maturedAwaitingAction(today)), href: "/renewals" },
      ];
    case "OFFICER":
      return [
        { label: "Submissions pending scrutiny", count: await ic({ status: "PENDING_SCRUTINY" }), href: "/verification?tab=pending" },
        { label: "Under my review", count: await ic({ status: { in: ["UNDER_REVIEW", "VERIFICATION_PENDING"] }, reviewerId: actor.id }), href: "/verification?tab=mine" },
        { label: "Verified — awaiting acceptance", count: await ic({ status: "VERIFIED" }), href: "/verification?tab=verified" },
        { label: "Release requests awaiting scrutiny", count: await rc({ status: { in: ["SUBMITTED", "UNDER_SCRUTINY"] } }), href: "/releases?view=awaiting-me" },
        { label: "Approved releases awaiting completion evidence", count: await rc({ status: "APPROVED" }), href: "/releases?status=APPROVED" },
      ];
    case "APPROVING_AUTHORITY":
      return [
        { label: "Release / refund requests awaiting your decision", count: await rc({ status: "PENDING_APPROVAL" }), href: "/releases?view=awaiting-me" },
        { label: "Matured instruments awaiting action", count: await ic(rules.maturedAwaitingAction(today)), href: "/renewals" },
      ];
    default:
      return [];
  }
}

/** Operational overview for administrators — no financial values or documents. */
export async function getAdminOverview(actor: Actor) {
  requirePermission(actor, "admin:jobs");
  const [usersByRole, pendingInstitutions, pendingUsers, jobs, deliveries, institutions] = await Promise.all([
    prisma.user.groupBy({ by: ["role", "status"], _count: { _all: true } }),
    prisma.institution.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.user.count({ where: { status: "PENDING" } }),
    prisma.jobRun.findMany({ orderBy: { startedAt: "desc" }, take: 8 }),
    prisma.notificationDelivery.groupBy({ by: ["channel", "status"], _count: { _all: true } }),
    prisma.institution.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  return { usersByRole, pendingInstitutions, pendingUsers, jobs, deliveries, institutions };
}
