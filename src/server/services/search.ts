// Server-side search, filtering, sorting and pagination of instruments within the actor's scope.
// Report exports reuse `buildInstrumentWhere`, so exported totals match what the user sees.
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import type { Actor } from "../auth/actor";
import { instrumentScope, requirePermission } from "../auth/scope";
import { getSettings, type Settings } from "../settings";
import { businessToday, parseDateOnly } from "@/lib/dates";
import { now } from "../clock";
import * as rules from "./rules";

export const INSTRUMENT_VIEWS = {
  all: "All records",
  active: "Active (held)",
  expiring: "Expiring soon",
  matured: "Matured",
  "pending-verification": "Pending verification",
  "missing-documents": "Missing documents",
  discrepancies: "Open discrepancies",
  renewal: "Renewal / replacement",
  "release-pending": "Release / refund pending",
  overdue: "Overdue actions",
  drafts: "Drafts",
} as const;
export type InstrumentView = keyof typeof INSTRUMENT_VIEWS;

export interface InstrumentFilters {
  q?: string;
  view?: string;
  type?: string;
  status?: string;
  verificationStatus?: string;
  bank?: string;
  institutionId?: string;
  regionId?: string;
  maturityFrom?: string;
  maturityTo?: string;
  issueFrom?: string;
  issueTo?: string;
  withinDays?: string;
  sort?: string;
  dir?: string;
}

const STATUSES = ["DRAFT", "PENDING_SCRUTINY", "UNDER_REVIEW", "CORRECTION_REQUIRED", "VERIFICATION_PENDING", "VERIFIED", "ACCEPTED", "REJECTED", "REPLACED", "RELEASED", "WITHDRAWN"];
const VERIFICATION = ["NOT_REVIEWED", "PENDING", "CONFIRMED", "DISCREPANCY", "UNABLE_TO_VERIFY", "CORRECTION_REQUESTED"];
const SORTS = { maturityDate: "maturityDate", amount: "amount", submittedAt: "submittedAt", updatedAt: "updatedAt", referenceNo: "referenceNo" } as const;

export function buildInstrumentWhere(actor: Actor, f: InstrumentFilters, settings: Settings, nowTs = now()): Prisma.InstrumentWhereInput {
  const today = businessToday(nowTs);
  const and: Prisma.InstrumentWhereInput[] = [instrumentScope(actor)];
  const q = f.q?.trim().slice(0, 100);
  if (q) {
    and.push({
      OR: [
        { referenceNo: { contains: q, mode: "insensitive" } },
        { instrumentNumber: { contains: q, mode: "insensitive" } },
        { bankName: { contains: q, mode: "insensitive" } },
        { institution: { name: { contains: q, mode: "insensitive" } } },
        { institution: { code: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (f.type === "FDR" || f.type === "SECURITY_DEPOSIT") and.push({ type: f.type });
  if (f.status && STATUSES.includes(f.status)) and.push({ status: f.status as Prisma.EnumInstrumentStatusFilter["equals"] });
  if (f.verificationStatus && VERIFICATION.includes(f.verificationStatus)) {
    and.push({ verificationStatus: f.verificationStatus as Prisma.EnumVerificationStatusFilter["equals"] });
  }
  if (f.bank?.trim()) and.push({ bankName: { contains: f.bank.trim().slice(0, 100), mode: "insensitive" } });
  if (f.institutionId && /^[0-9a-f-]{36}$/i.test(f.institutionId)) and.push({ institutionId: f.institutionId });
  if (f.regionId && /^[0-9a-f-]{36}$/i.test(f.regionId)) and.push({ institution: { regionId: f.regionId } });
  const mf = parseDateOnly(f.maturityFrom), mt = parseDateOnly(f.maturityTo);
  if (mf || mt) and.push({ maturityDate: { ...(mf ? { gte: mf } : {}), ...(mt ? { lte: mt } : {}) } });
  const isf = parseDateOnly(f.issueFrom), ist = parseDateOnly(f.issueTo);
  if (isf || ist) and.push({ issueDate: { ...(isf ? { gte: isf } : {}), ...(ist ? { lte: ist } : {}) } });

  const within = Math.min(Math.max(Number(f.withinDays) || settings.expiringSoonDays, 1), 365);
  switch (f.view as InstrumentView) {
    case "active":
      and.push(rules.held);
      break;
    case "expiring":
      and.push(rules.expiringWithin(today, within));
      break;
    case "matured":
      and.push(rules.matured(today));
      break;
    case "pending-verification":
      and.push(rules.pendingVerification);
      break;
    case "missing-documents":
      and.push(rules.missingPrimaryDocument);
      break;
    case "discrepancies":
      and.push(rules.withOpenDiscrepancies);
      break;
    case "renewal":
      and.push(rules.renewalInProgress);
      break;
    case "release-pending":
      and.push(rules.releasePending);
      break;
    case "overdue":
      and.push(rules.overdueInstruments(today, nowTs, settings));
      break;
    case "drafts":
      and.push({ status: "DRAFT" });
      break;
  }
  return { AND: and };
}

export function instrumentOrderBy(f: InstrumentFilters): Prisma.InstrumentOrderByWithRelationInput[] {
  const key = SORTS[f.sort as keyof typeof SORTS] ?? "updatedAt";
  const dir = f.dir === "asc" ? "asc" : "desc";
  const nullable = key === "maturityDate" || key === "amount" || key === "submittedAt";
  return [nullable ? { [key]: { sort: dir, nulls: "last" } } : { [key]: dir }, { referenceNo: "asc" }];
}

export async function searchInstruments(actor: Actor, f: InstrumentFilters, paging: { skip: number; take: number }) {
  requirePermission(actor, "instrument:read");
  const settings = await getSettings();
  const where = buildInstrumentWhere(actor, f, settings);
  const [rows, total, agg] = await Promise.all([
    prisma.instrument.findMany({
      where,
      orderBy: instrumentOrderBy(f),
      include: {
        institution: { select: { id: true, name: true, code: true } },
        _count: { select: { discrepancies: { where: { status: "OPEN" } } } },
        releaseRequests: { where: { status: { in: ["SUBMITTED", "UNDER_SCRUTINY", "INFO_REQUESTED", "PENDING_APPROVAL", "APPROVED"] } }, select: { status: true }, take: 1 },
        renewalsAsOriginal: { where: { status: "IN_PROGRESS" }, select: { referenceNo: true }, take: 1 },
      },
      skip: paging.skip, take: paging.take,
    }),
    prisma.instrument.count({ where }),
    prisma.instrument.aggregate({ where, _sum: { amount: true } }),
  ]);
  return { rows, total, totalAmount: agg._sum.amount, settings };
}
