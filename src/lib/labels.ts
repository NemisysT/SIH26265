// Human-readable labels and badge tones for enum values. Plain strings so this module is safe to
// import from client components (no Prisma runtime).

export type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "muted" | "accent";

type LabelMap = Record<string, { label: string; tone: Tone; description?: string }>;

export const ROLE_LABELS: Record<string, string> = {
  INSTITUTION_USER: "Institution User",
  OFFICER: "Regulation Bureau Officer",
  APPROVING_AUTHORITY: "Approving Authority",
  ADMIN: "System Administrator",
  AUDITOR: "Auditor",
};

export const INSTRUMENT_TYPE_LABELS: Record<string, string> = {
  FDR: "Fixed Deposit Receipt (FDR)",
  SECURITY_DEPOSIT: "Security Deposit",
};

export const INSTRUMENT_STATUS: LabelMap = {
  DRAFT: { label: "Draft", tone: "muted", description: "Not yet submitted; not a verified instrument." },
  PENDING_SCRUTINY: { label: "Pending scrutiny", tone: "info", description: "Submitted and waiting for an officer to begin review." },
  UNDER_REVIEW: { label: "Under review", tone: "info", description: "An officer is scrutinising the record." },
  CORRECTION_REQUIRED: { label: "Correction required", tone: "warning", description: "The institution must correct and resubmit." },
  VERIFICATION_PENDING: { label: "Verification pending", tone: "accent", description: "Awaiting independent confirmation evidence." },
  VERIFIED: { label: "Verified", tone: "success", description: "Verification recorded; awaiting formal acceptance." },
  ACCEPTED: { label: "Accepted / held", tone: "success", description: "Accepted and held as security." },
  REJECTED: { label: "Rejected", tone: "danger", description: "Rejected with a recorded reason." },
  REPLACED: { label: "Replaced", tone: "neutral", description: "Superseded by an accepted renewal/replacement. History preserved." },
  RELEASED: { label: "Released (recorded)", tone: "neutral", description: "Release recorded in the portal after completion evidence." },
  WITHDRAWN: { label: "Withdrawn", tone: "muted", description: "Withdrawn by the institution before a decision." },
};

export const VERIFICATION_STATUS: LabelMap = {
  NOT_REVIEWED: { label: "Not reviewed", tone: "muted" },
  PENDING: { label: "Pending", tone: "info" },
  CONFIRMED: { label: "Confirmed", tone: "success" },
  DISCREPANCY: { label: "Discrepancy detected", tone: "danger" },
  UNABLE_TO_VERIFY: { label: "Unable to verify", tone: "warning" },
  CORRECTION_REQUESTED: { label: "Correction requested", tone: "warning" },
};

export const MATURITY_STATE: LabelMap = {
  NO_DATE: { label: "No maturity date", tone: "warning" },
  ACTIVE: { label: "Within validity", tone: "success" },
  EXPIRING: { label: "Expiring soon", tone: "warning" },
  MATURED: { label: "Matured", tone: "danger" },
};

export const RELEASE_STATUS: LabelMap = {
  SUBMITTED: { label: "Submitted", tone: "info" },
  UNDER_SCRUTINY: { label: "Under scrutiny", tone: "info" },
  INFO_REQUESTED: { label: "Information requested", tone: "warning" },
  PENDING_APPROVAL: { label: "Pending approval", tone: "accent" },
  APPROVED: { label: "Approved – awaiting completion", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  COMPLETED: { label: "Completed (recorded)", tone: "neutral" },
  WITHDRAWN: { label: "Withdrawn", tone: "muted" },
};

export const RELEASE_TYPE_LABELS: Record<string, string> = {
  RELEASE: "Release of instrument",
  REFUND: "Refund of deposit",
};

export const RENEWAL_STATUS: LabelMap = {
  IN_PROGRESS: { label: "In progress", tone: "info" },
  APPROVED: { label: "Approved", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
  WITHDRAWN: { label: "Withdrawn", tone: "muted" },
};

export const INSTITUTION_STATUS: LabelMap = {
  PENDING_APPROVAL: { label: "Pending approval", tone: "warning" },
  ACTIVE: { label: "Active", tone: "success" },
  SUSPENDED: { label: "Suspended", tone: "danger" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const DOCUMENT_TYPE_LABELS: Record<string, string> = {
  FDR_RECEIPT: "FDR / deposit receipt",
  DEPOSIT_CONFIRMATION: "Deposit confirmation",
  RENEWAL_DOCUMENT: "Renewal / replacement document",
  RELEASE_SUPPORTING: "Release / refund supporting document",
  BANK_VERIFICATION_LETTER: "Bank verification letter",
  RELEASE_COMPLETION_EVIDENCE: "Release completion evidence",
  OTHER: "Other supporting record",
};

export const DOCUMENT_REVIEW: LabelMap = {
  PENDING: { label: "Not yet reviewed", tone: "muted" },
  ACCEPTED: { label: "Accepted", tone: "success" },
  REJECTED: { label: "Rejected", tone: "danger" },
};

export const DISCREPANCY_STATUS: LabelMap = {
  OPEN: { label: "Open", tone: "danger" },
  RESOLVED: { label: "Resolved", tone: "success" },
  WAIVED: { label: "Waived", tone: "neutral" },
};

export const VERIFICATION_METHOD_LABELS: Record<string, string> = {
  AUTOMATED_CONSISTENCY_CHECK: "Automated consistency check",
  MANUAL_DOCUMENT_REVIEW: "Manual document review",
  BANK_CONFIRMATION_LETTER: "Bank confirmation letter",
  EXTERNAL_PROVIDER: "External verification provider",
};

export const VERIFICATION_SOURCE_LABELS: Record<string, string> = {
  SYSTEM: "System",
  OFFICER_REVIEW: "Officer review",
  BANK_CORRESPONDENCE: "Bank correspondence",
  EXTERNAL_PROVIDER: "External provider",
};

export const NOTIFICATION_TYPE_LABELS: Record<string, string> = {
  SUBMISSION_RECEIVED: "Submission received",
  VERIFICATION_PENDING: "Verification pending",
  CORRECTION_REQUESTED: "Correction requested",
  CORRECTION_SUBMITTED: "Correction submitted",
  VERIFICATION_RESULT: "Verification result",
  MATURITY_UPCOMING: "Upcoming maturity",
  MATURITY_REACHED: "Maturity reached",
  RENEWAL_SUBMITTED: "Renewal / replacement submitted",
  RELEASE_SUBMITTED: "Release / refund request",
  RELEASE_DECISION: "Release / refund decision",
  OVERDUE_ACTION: "Overdue action",
  ESCALATION: "Escalation",
  INSTITUTION_REGISTRATION: "Institution registration",
  GENERAL: "General",
};

export function statusOf(map: LabelMap, key: string | null | undefined) {
  if (!key) return { label: "—", tone: "muted" as Tone };
  return map[key] ?? { label: key, tone: "neutral" as Tone };
}
