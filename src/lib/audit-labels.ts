// Human-readable names for audit actions (shared by dashboards and history panels).

export const ACTION_LABELS: Record<string, string> = {
  INSTRUMENT_SUBMIT: "Submitted for scrutiny",
  INSTRUMENT_RESUBMIT: "Correction submitted",
  INSTRUMENT_START_REVIEW: "Review started",
  INSTRUMENT_REQUEST_CORRECTION: "Correction requested",
  INSTRUMENT_SEND_FOR_VERIFICATION: "Sent for verification",
  INSTRUMENT_ACCEPT: "Instrument accepted",
  INSTRUMENT_REJECT: "Instrument rejected",
  INSTRUMENT_VERIFICATION_CONFIRMED: "Verification confirmed",
  INSTRUMENT_MARK_REPLACED: "Marked replaced",
  INSTRUMENT_MARK_RELEASED: "Release recorded",
  VERIFICATION_RECORDED: "Verification recorded",
  DOCUMENT_UPLOADED: "Document uploaded",
  DOCUMENT_VERSION_UPLOADED: "Document re-uploaded",
  RELEASE_REQUEST_SUBMITTED: "Release/refund requested",
  RELEASE_FORWARD: "Release forwarded for approval",
  RELEASE_APPROVE: "Release approved",
  RELEASE_REJECT: "Release rejected",
  RELEASE_COMPLETE: "Release completion recorded",
  RENEWAL_STARTED: "Renewal/replacement started",
  DISCREPANCY_RAISED: "Discrepancy raised",
  DISCREPANCY_WAIVED: "Discrepancy waived",
  DISCREPANCY_RESOLVED: "Discrepancy resolved",
  INSTRUMENT_DRAFT_CREATED: "Draft created",
  INSTRUMENT_DRAFT_UPDATED: "Draft updated",
  INSTRUMENT_CORRECTED: "Values corrected",
  INSTRUMENT_WITHDRAW: "Withdrawn",
  INSTITUTION_REGISTERED: "Institution registered",
  INSTITUTION_APPROVE: "Institution approved",
  INSTITUTION_REJECT: "Registration rejected",
  INSTITUTION_SUSPEND: "Institution suspended",
  RELEASE_START_SCRUTINY: "Release scrutiny started",
  RELEASE_REQUEST_INFO: "Information requested",
  RELEASE_PROVIDE_INFO: "Information provided",
  RELEASE_WITHDRAW: "Release request withdrawn",
  RENEWAL_APPROVED: "Renewal approved",
  RENEWAL_REJECTED: "Renewal rejected",
  LEGACY_RECORD_IMPORTED: "Legacy record imported",
  COMMENT_ADDED: "Comment added",
  DOCUMENT_REVIEWED: "Document reviewed",
};

export function actionLabel(action: string) {
  const fallback = action.replace(/_/g, " ").toLowerCase();
  return ACTION_LABELS[action] ?? fallback.charAt(0).toUpperCase() + fallback.slice(1);
}
