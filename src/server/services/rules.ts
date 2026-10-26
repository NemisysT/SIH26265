// Date-driven business rules expressed as reusable query predicates. The dashboard, list filters,
// reports and the scheduled monitor all use these definitions, so numbers agree everywhere.
import type { Prisma } from "@prisma/client";
import { addDays } from "@/lib/dates";
import type { Settings } from "../settings";
import { OPEN_RELEASE_STATUSES } from "../workflow/release-machine";

const DAY_MS = 86_400_000;

/** No renewal/replacement or release/refund is already under way for the instrument. */
export const noActionUnderway: Prisma.InstrumentWhereInput = {
  renewalsAsOriginal: { none: { status: "IN_PROGRESS" } },
  releaseRequests: { none: { status: { in: OPEN_RELEASE_STATUSES } } },
};

/** Held (accepted) instruments. */
export const held: Prisma.InstrumentWhereInput = { status: "ACCEPTED" };

/** Held and maturing within [today+1, today+days]. */
export function expiringWithin(today: Date, days: number): Prisma.InstrumentWhereInput {
  return { status: "ACCEPTED", maturityDate: { gt: today, lte: addDays(today, days) } };
}

/** Held, matured (maturity date on or before today). */
export function matured(today: Date): Prisma.InstrumentWhereInput {
  return { status: "ACCEPTED", maturityDate: { lte: today } };
}

/** Matured and nobody has started a renewal or release. */
export function maturedAwaitingAction(today: Date): Prisma.InstrumentWhereInput {
  return { AND: [matured(today), noActionUnderway] };
}

export const pendingVerification: Prisma.InstrumentWhereInput = {
  status: { in: ["PENDING_SCRUTINY", "UNDER_REVIEW", "VERIFICATION_PENDING", "VERIFIED"] },
};

export const withOpenDiscrepancies: Prisma.InstrumentWhereInput = {
  status: { not: "DRAFT" },
  discrepancies: { some: { status: "OPEN" } },
};

export const missingPrimaryDocument: Prisma.InstrumentWhereInput = {
  status: { notIn: ["DRAFT", "WITHDRAWN"] },
  documents: { none: { docType: { in: ["FDR_RECEIPT", "DEPOSIT_CONFIRMATION"] }, isCurrent: true, reviewStatus: { not: "REJECTED" } } },
};

export const renewalInProgress: Prisma.InstrumentWhereInput = {
  OR: [{ renewalAsNew: { status: "IN_PROGRESS" } }, { renewalsAsOriginal: { some: { status: "IN_PROGRESS" } } }],
};

export const releasePending: Prisma.InstrumentWhereInput = {
  releaseRequests: { some: { status: { in: OPEN_RELEASE_STATUSES } } },
};

/** Instruments with an overdue action, by the configured SLAs. */
export function overdueInstruments(today: Date, nowTs: Date, s: Settings): Prisma.InstrumentWhereInput {
  const firstEscalation = s.postMaturityEscalationDays[0] ?? 0;
  return {
    OR: [
      { AND: [matured(addDays(today, -firstEscalation)), noActionUnderway] },
      { status: { in: ["PENDING_SCRUTINY", "UNDER_REVIEW", "VERIFICATION_PENDING"] }, statusChangedAt: { lt: new Date(nowTs.getTime() - s.scrutinySlaDays * DAY_MS) } },
      { status: "CORRECTION_REQUIRED", statusChangedAt: { lt: new Date(nowTs.getTime() - s.correctionResponseDays * DAY_MS) } },
    ],
  };
}

export function overdueReleases(nowTs: Date, s: Settings): Prisma.ReleaseRequestWhereInput {
  return {
    status: { in: ["SUBMITTED", "UNDER_SCRUTINY", "PENDING_APPROVAL"] },
    statusChangedAt: { lt: new Date(nowTs.getTime() - s.releaseDecisionSlaDays * DAY_MS) },
  };
}
