// Release / refund request workflow (policy: officer scrutiny → approving authority → completion).
//
//   SUBMITTED ─START_SCRUTINY→ UNDER_SCRUTINY ─FORWARD→ PENDING_APPROVAL ─APPROVE→ APPROVED ─COMPLETE→ COMPLETED
//        │                       │    ↑                       │      └─REJECT→ REJECTED
//        │                       ↓    │ PROVIDE_INFO           ↓
//        │                   INFO_REQUESTED ←──REQUEST_INFO────┘
//        └─WITHDRAW (also from UNDER_SCRUTINY / INFO_REQUESTED)→ WITHDRAWN
//
// A request never becomes COMPLETED merely by being submitted or approved: completion requires an
// approved decision, a completion reference and uploaded completion evidence. Completion is a
// portal record only — no funds are moved by this system.

import type { Permission } from "../auth/permissions";

export type ReleaseStatusName =
  | "SUBMITTED"
  | "UNDER_SCRUTINY"
  | "INFO_REQUESTED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "REJECTED"
  | "COMPLETED"
  | "WITHDRAWN";

export type ReleaseAction =
  | "START_SCRUTINY"
  | "REQUEST_INFO"
  | "PROVIDE_INFO"
  | "FORWARD"
  | "APPROVE"
  | "REJECT"
  | "COMPLETE"
  | "WITHDRAW";

interface Rule {
  from: ReleaseStatusName[];
  to: ReleaseStatusName;
  permission: Permission;
  requiresNote: boolean;
  label: string;
  confirm?: string;
}

export const RELEASE_TRANSITIONS: Record<ReleaseAction, Rule> = {
  START_SCRUTINY: { from: ["SUBMITTED"], to: "UNDER_SCRUTINY", permission: "release:scrutinize", requiresNote: false, label: "Start scrutiny" },
  REQUEST_INFO: {
    from: ["UNDER_SCRUTINY", "PENDING_APPROVAL"],
    to: "INFO_REQUESTED",
    // Either the scrutinising officer or the approving authority may ask for more information.
    permission: "release:read",
    requiresNote: true,
    label: "Request further information",
  },
  PROVIDE_INFO: { from: ["INFO_REQUESTED"], to: "UNDER_SCRUTINY", permission: "release:create", requiresNote: true, label: "Submit information" },
  FORWARD: {
    from: ["UNDER_SCRUTINY"],
    to: "PENDING_APPROVAL",
    permission: "release:scrutinize",
    requiresNote: true,
    label: "Forward to approving authority",
    confirm: "Forward this request with your scrutiny observations to the approving authority?",
  },
  APPROVE: {
    from: ["PENDING_APPROVAL"],
    to: "APPROVED",
    permission: "release:decide",
    requiresNote: true,
    label: "Approve",
    confirm: "Approve this release/refund request? Approval authorises processing only; completion must be recorded separately with evidence.",
  },
  REJECT: {
    from: ["PENDING_APPROVAL"],
    to: "REJECTED",
    permission: "release:decide",
    requiresNote: true,
    label: "Reject",
    confirm: "Reject this request? The decision and reason are permanent.",
  },
  COMPLETE: {
    from: ["APPROVED"],
    to: "COMPLETED",
    permission: "release:complete",
    requiresNote: false,
    label: "Record completion",
    confirm: "Record that the release/refund has been completed outside this portal? This does not move any funds.",
  },
  WITHDRAW: {
    from: ["SUBMITTED", "UNDER_SCRUTINY", "INFO_REQUESTED"],
    to: "WITHDRAWN",
    permission: "release:create",
    requiresNote: true,
    label: "Withdraw request",
    confirm: "Withdraw this request? It will be kept for audit.",
  },
};

export const OPEN_RELEASE_STATUSES: ReleaseStatusName[] = ["SUBMITTED", "UNDER_SCRUTINY", "INFO_REQUESTED", "PENDING_APPROVAL", "APPROVED"];

export function canReleaseTransition(from: ReleaseStatusName, action: ReleaseAction): boolean {
  return RELEASE_TRANSITIONS[action].from.includes(from);
}
