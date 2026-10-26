// Explicit, data-driven state model for financial instruments. This table is the single place to
// adapt the workflow once real procedural requirements are confirmed; the service layer rejects
// any transition not listed here.
//
//   DRAFT ─SUBMIT→ PENDING_SCRUTINY ─START_REVIEW→ UNDER_REVIEW ─SEND_FOR_VERIFICATION→ VERIFICATION_PENDING
//                     ↑                               │  │                                   │
//                     └──RESUBMIT── CORRECTION_REQUIRED ←┘  └──(confirmed verification)→ VERIFIED ─ACCEPT→ ACCEPTED
//   ACCEPTED ─(replacement accepted)→ REPLACED;  ACCEPTED/REPLACED ─(release completed)→ RELEASED
//
// Maturity/expiry are NOT states: they are derived from maturityDate (see lib/dates.ts).

import type { Permission } from "../auth/permissions";

export type InstrumentStatusName =
  | "DRAFT"
  | "PENDING_SCRUTINY"
  | "UNDER_REVIEW"
  | "CORRECTION_REQUIRED"
  | "VERIFICATION_PENDING"
  | "VERIFIED"
  | "ACCEPTED"
  | "REJECTED"
  | "REPLACED"
  | "RELEASED"
  | "WITHDRAWN";

export type InstrumentAction =
  | "SUBMIT"
  | "WITHDRAW"
  | "START_REVIEW"
  | "REQUEST_CORRECTION"
  | "RESUBMIT"
  | "SEND_FOR_VERIFICATION"
  | "ACCEPT"
  | "REJECT";

/** Transitions performed only by the system as a side effect of another workflow. */
export type SystemInstrumentTransition = "VERIFICATION_CONFIRMED" | "MARK_REPLACED" | "MARK_RELEASED";

interface TransitionRule {
  from: InstrumentStatusName[];
  to: InstrumentStatusName;
  permission: Permission;
  /** A reason / observation must be recorded. */
  requiresNote: boolean;
  label: string;
  /** Consequential actions require an explicit confirmation step in the UI. */
  confirm?: string;
}

export const INSTRUMENT_TRANSITIONS: Record<InstrumentAction, TransitionRule> = {
  SUBMIT: {
    from: ["DRAFT"],
    to: "PENDING_SCRUTINY",
    permission: "instrument:edit-own",
    requiresNote: false,
    label: "Submit for scrutiny",
    confirm: "Submit this instrument to the Regulation Bureau? Submission is not approval; the record will be locked while it is reviewed.",
  },
  WITHDRAW: {
    from: ["DRAFT", "PENDING_SCRUTINY"],
    to: "WITHDRAWN",
    permission: "instrument:edit-own",
    requiresNote: true,
    label: "Withdraw",
    confirm: "Withdraw this record? It will be kept for audit but can no longer be processed.",
  },
  START_REVIEW: {
    from: ["PENDING_SCRUTINY"],
    to: "UNDER_REVIEW",
    permission: "instrument:review",
    requiresNote: false,
    label: "Start review",
  },
  REQUEST_CORRECTION: {
    from: ["UNDER_REVIEW", "VERIFICATION_PENDING"],
    to: "CORRECTION_REQUIRED",
    permission: "instrument:review",
    requiresNote: true,
    label: "Request correction",
  },
  RESUBMIT: {
    from: ["CORRECTION_REQUIRED"],
    to: "PENDING_SCRUTINY",
    permission: "instrument:edit-own",
    requiresNote: true,
    label: "Submit correction",
  },
  SEND_FOR_VERIFICATION: {
    from: ["UNDER_REVIEW"],
    to: "VERIFICATION_PENDING",
    permission: "instrument:review",
    requiresNote: false,
    label: "Await independent verification",
  },
  ACCEPT: {
    from: ["VERIFIED"],
    to: "ACCEPTED",
    permission: "instrument:decide",
    requiresNote: false,
    label: "Accept instrument",
    confirm: "Accept this instrument as held security? This records a formal decision in the audit trail.",
  },
  REJECT: {
    from: ["UNDER_REVIEW", "VERIFICATION_PENDING", "VERIFIED"],
    to: "REJECTED",
    permission: "instrument:decide",
    requiresNote: true,
    label: "Reject instrument",
    confirm: "Reject this instrument? The decision and reason are permanent.",
  },
};

export const SYSTEM_TRANSITIONS: Record<SystemInstrumentTransition, { from: InstrumentStatusName[]; to: InstrumentStatusName }> = {
  VERIFICATION_CONFIRMED: { from: ["UNDER_REVIEW", "VERIFICATION_PENDING"], to: "VERIFIED" },
  MARK_REPLACED: { from: ["ACCEPTED"], to: "REPLACED" },
  MARK_RELEASED: { from: ["ACCEPTED", "REPLACED"], to: "RELEASED" },
};

/** Statuses in which the institution may edit submitted values. */
export const INSTITUTION_EDITABLE: InstrumentStatusName[] = ["DRAFT", "CORRECTION_REQUIRED"];
/** Statuses in which the institution may add supporting documents. */
export const INSTITUTION_DOCUMENT_STATUSES: InstrumentStatusName[] = ["DRAFT", "CORRECTION_REQUIRED", "PENDING_SCRUTINY"];
/** Statuses in which officers can record verification evidence. */
export const VERIFICATION_STATUSES: InstrumentStatusName[] = ["UNDER_REVIEW", "VERIFICATION_PENDING"];
/** Statuses that represent work waiting on the Regulation Bureau. */
export const REVIEW_QUEUE_STATUSES: InstrumentStatusName[] = ["PENDING_SCRUTINY", "UNDER_REVIEW", "VERIFICATION_PENDING", "VERIFIED"];
/** Statuses counted as currently held security. */
export const HELD_STATUSES: InstrumentStatusName[] = ["ACCEPTED"];
export const TERMINAL_STATUSES: InstrumentStatusName[] = ["REJECTED", "REPLACED", "RELEASED", "WITHDRAWN"];

export function canTransition(from: InstrumentStatusName, action: InstrumentAction): boolean {
  return INSTRUMENT_TRANSITIONS[action].from.includes(from);
}

export function availableActions(from: InstrumentStatusName): InstrumentAction[] {
  return (Object.keys(INSTRUMENT_TRANSITIONS) as InstrumentAction[]).filter((a) => canTransition(from, a));
}
