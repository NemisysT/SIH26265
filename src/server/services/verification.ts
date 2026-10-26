// Verification records and discrepancy management. The service keeps four kinds of information
// distinct: institution-submitted values, automated consistency checks, manual scrutiny, and
// independent confirmation. Only independent evidence can mark an instrument CONFIRMED when the
// policy `requireIndependentConfirmation` is on (the default); simulated results never can.
import { z } from "zod";
import { prisma } from "../db";
import type { Actor } from "../auth/actor";
import { requirePermission } from "../auth/scope";
import { recordAudit } from "../audit";
import { ConflictError, InvalidTransitionError, NotFoundError, ValidationError } from "../errors";
import { getSettings } from "../settings";
import { loadScopedInstrument, systemTransition } from "./instruments";
import { applyInstrumentChecks } from "./checks";
import { VERIFICATION_STATUSES, type InstrumentStatusName } from "../workflow/instrument-machine";
import { institutionUserIds, notify } from "../notifications/notify";
import { getVerificationProvider } from "../verification/provider";
import { assertUuid } from "./common";
import { now } from "../clock";
import { text } from "@/lib/validation";
import { toDateOnlyString } from "@/lib/dates";

export const recordVerificationSchema = z.object({
  method: z.enum(["MANUAL_DOCUMENT_REVIEW", "BANK_CONFIRMATION_LETTER"]),
  result: z.enum(["PENDING", "CONFIRMED", "DISCREPANCY", "UNABLE_TO_VERIFY"]),
  evidenceReference: text(120).optional(),
  evidenceDocumentId: z.string().uuid().optional(),
  observations: text(2000).pipe(z.string().min(3, "Record your observations")),
  discrepancyDetails: text(1000).optional(),
  expectedVersion: z.number().int().optional(),
});
export type RecordVerificationInput = z.infer<typeof recordVerificationSchema>;

export async function recordVerification(actor: Actor, instrumentId: string, input: RecordVerificationInput) {
  requirePermission(actor, "verification:record");
  return prisma.$transaction(async (tx) => {
    const inst = await loadScopedInstrument(tx, actor, instrumentId);
    if (input.expectedVersion !== undefined && input.expectedVersion !== inst.version) {
      throw new ConflictError("This record was changed by someone else. Reload and try again.", "STALE_VERSION");
    }
    if (!VERIFICATION_STATUSES.includes(inst.status as InstrumentStatusName)) {
      throw new InvalidTransitionError("Verification can only be recorded while the instrument is under review or awaiting verification.");
    }
    const settings = await getSettings(tx);
    let independentlyConfirmed = false;

    if (input.method === "BANK_CONFIRMATION_LETTER") {
      if (!input.evidenceReference || !input.evidenceDocumentId) {
        throw new ValidationError("A bank confirmation requires the letter reference and the uploaded letter.", {
          evidenceReference: input.evidenceReference ? undefined : ["Required"],
          evidenceDocumentId: input.evidenceDocumentId ? undefined : ["Upload and select the bank letter"],
        } as Record<string, string[]>);
      }
      const doc = await tx.document.findFirst({
        where: { id: input.evidenceDocumentId, instrumentId, docType: "BANK_VERIFICATION_LETTER" },
      });
      if (!doc) throw new ValidationError("The selected evidence must be a bank verification letter attached to this instrument.");
      independentlyConfirmed = input.result === "CONFIRMED";
    }

    if (input.result === "CONFIRMED") {
      if (settings.requireIndependentConfirmation && input.method !== "BANK_CONFIRMATION_LETTER") {
        throw new ValidationError(
          "Policy requires independent confirmation (bank confirmation letter). A manual document review cannot mark the instrument confirmed.",
        );
      }
      const blocking = await tx.discrepancy.count({ where: { instrumentId, status: "OPEN", severity: "BLOCKING" } });
      if (blocking > 0) throw new InvalidTransitionError(`Resolve the ${blocking} open blocking discrepancy(ies) before confirming.`);
    }
    if (input.result === "DISCREPANCY" && !input.discrepancyDetails?.trim()) {
      throw new ValidationError("Describe the discrepancy.", { discrepancyDetails: ["Required"] });
    }

    const record = await tx.verificationRecord.create({
      data: {
        instrumentId,
        method: input.method,
        source: input.method === "BANK_CONFIRMATION_LETTER" ? "BANK_CORRESPONDENCE" : "OFFICER_REVIEW",
        isSimulated: false,
        independentlyConfirmed,
        initiatedById: actor.id,
        initiatedBy: `${actor.name} (officer)`,
        attemptedAt: now(),
        result: input.result,
        evidenceReference: input.evidenceReference,
        evidenceDocumentId: input.evidenceDocumentId,
        observations: input.observations,
        discrepancyDetails: input.discrepancyDetails,
      },
    });

    if (input.result === "DISCREPANCY") {
      await tx.discrepancy.create({
        data: {
          instrumentId,
          code: "OFFICER_OBSERVATION",
          severity: "BLOCKING",
          source: "OFFICER",
          message: input.discrepancyDetails!,
          raisedById: actor.id,
          raisedAt: now(),
        },
      });
    }

    if (input.result === "CONFIRMED") {
      await systemTransition(tx, actor, instrumentId, "VERIFICATION_CONFIRMED", `Verification confirmed via ${input.method}.`);
    } else {
      await tx.instrument.update({
        where: { id: instrumentId },
        data: { verificationStatus: input.result, version: { increment: 1 } },
      });
    }

    await recordAudit(tx, actor, {
      action: "VERIFICATION_RECORDED",
      resourceType: "Instrument",
      resourceId: instrumentId,
      institutionId: inst.institutionId,
      before: { verificationStatus: inst.verificationStatus, status: inst.status },
      after: { verificationRecordId: record.id, method: input.method, result: input.result, independentlyConfirmed },
      reason: input.observations,
    });
    await notify(tx, {
      recipientIds: await institutionUserIds(tx, inst.institutionId),
      type: "VERIFICATION_RESULT",
      title: `Verification update: ${inst.referenceNo}`,
      message:
        input.result === "CONFIRMED"
          ? "Verification has been confirmed. The instrument awaits formal acceptance."
          : input.result === "DISCREPANCY"
            ? "A discrepancy was recorded. The Bureau may request a correction."
            : "A verification observation was recorded.",
      link: `/instruments/${instrumentId}`,
      institutionId: inst.institutionId,
      instrumentId,
    });
    return record;
  });
}

/** Query the configured external provider. With the DEMO adapter the result is stored as SIMULATED
 *  and never changes the instrument's verification status. */
export async function runExternalVerification(actor: Actor, instrumentId: string) {
  requirePermission(actor, "verification:record");
  const provider = getVerificationProvider();
  if (!provider) throw new ConflictError("No external verification provider is configured.", "PROVIDER_UNAVAILABLE");
  const inst = await loadScopedInstrument(prisma, actor, instrumentId);
  if (!VERIFICATION_STATUSES.includes(inst.status as InstrumentStatusName)) {
    throw new InvalidTransitionError("External verification can only be requested while the instrument is under review or awaiting verification.");
  }
  const result = await provider.verify({
    instrumentNumber: inst.instrumentNumber,
    bankName: inst.bankName,
    amount: inst.amount?.toString() ?? null,
    maturityDate: toDateOnlyString(inst.maturityDate),
  });
  return prisma.$transaction(async (tx) => {
    const record = await tx.verificationRecord.create({
      data: {
        instrumentId,
        method: "EXTERNAL_PROVIDER",
        source: "EXTERNAL_PROVIDER",
        providerName: provider.name,
        isSimulated: provider.isSimulated,
        independentlyConfirmed: false,
        initiatedById: actor.id,
        initiatedBy: `${actor.name} (officer)`,
        attemptedAt: now(),
        // A simulated outcome is informational only; it is recorded as PENDING so it can never be
        // mistaken for a confirmation or a real bank-reported discrepancy.
        result: provider.isSimulated ? "PENDING" : result.outcome === "MATCH" ? "CONFIRMED" : "DISCREPANCY",
        evidenceReference: result.reference,
        observations: `${provider.isSimulated ? "DEMO / SIMULATED — not a bank confirmation. " : ""}Provider outcome: ${result.outcome}. ${result.details}`,
      },
    });
    await recordAudit(tx, actor, {
      action: "EXTERNAL_VERIFICATION_QUERIED",
      resourceType: "Instrument",
      resourceId: instrumentId,
      institutionId: inst.institutionId,
      after: { provider: provider.name, simulated: provider.isSimulated, outcome: result.outcome, reference: result.reference },
    });
    return record;
  });
}

export async function rerunChecks(actor: Actor, instrumentId: string) {
  requirePermission(actor, "discrepancy:manage");
  return prisma.$transaction(async (tx) => {
    const inst = await loadScopedInstrument(tx, actor, instrumentId);
    if (inst.status === "DRAFT") throw new InvalidTransitionError("Checks run on submitted records only.");
    return applyInstrumentChecks(tx, instrumentId, actor, "officer re-check");
  });
}

export const raiseDiscrepancySchema = z.object({
  message: text(1000).pipe(z.string().min(5, "Describe the discrepancy")),
  severity: z.enum(["BLOCKING", "WARNING"]),
  field: text(60).optional(),
});

export async function raiseDiscrepancy(actor: Actor, instrumentId: string, input: z.infer<typeof raiseDiscrepancySchema>) {
  requirePermission(actor, "discrepancy:manage");
  return prisma.$transaction(async (tx) => {
    const inst = await loadScopedInstrument(tx, actor, instrumentId);
    if (["DRAFT", "WITHDRAWN"].includes(inst.status)) throw new InvalidTransitionError("Discrepancies can only be raised on submitted records.");
    const d = await tx.discrepancy.create({
      data: { instrumentId, code: "OFFICER_OBSERVATION", severity: input.severity, source: "OFFICER", message: input.message, field: input.field, raisedById: actor.id, raisedAt: now() },
    });
    await tx.instrument.update({ where: { id: instrumentId }, data: { verificationStatus: "DISCREPANCY", version: { increment: 1 } } });
    await recordAudit(tx, actor, {
      action: "DISCREPANCY_RAISED",
      resourceType: "Instrument",
      resourceId: instrumentId,
      institutionId: inst.institutionId,
      after: { discrepancyId: d.id, severity: d.severity, message: d.message },
    });
    return d;
  });
}

export const resolveDiscrepancySchema = z.object({
  outcome: z.enum(["RESOLVED", "WAIVED"]),
  note: text(1000).pipe(z.string().min(5, "Explain the resolution")),
});

/**
 * Authorised manual resolution. Automated BLOCKING findings cannot be waived or hand-resolved:
 * they close only when a correction removes the underlying condition.
 */
export async function resolveDiscrepancy(actor: Actor, discrepancyId: string, input: z.infer<typeof resolveDiscrepancySchema>) {
  requirePermission(actor, "discrepancy:manage");
  assertUuid(discrepancyId, "Discrepancy");
  return prisma.$transaction(async (tx) => {
    const d = await tx.discrepancy.findUnique({ where: { id: discrepancyId } });
    if (!d || !d.instrumentId) throw new NotFoundError("Discrepancy");
    const inst = await loadScopedInstrument(tx, actor, d.instrumentId);
    if (d.status !== "OPEN") throw new ConflictError("This discrepancy is already closed.");
    if (d.source === "AUTOMATED" && d.severity === "BLOCKING") {
      throw new InvalidTransitionError("Blocking automated findings close only when a correction removes the condition. Request a correction instead.");
    }
    if (d.source === "AUTOMATED" && input.outcome === "RESOLVED") {
      throw new ValidationError("Automated warnings can be waived with a reason; they are resolved automatically when corrected.");
    }
    const updated = await tx.discrepancy.update({
      where: { id: d.id },
      data: { status: input.outcome, resolvedById: actor.id, resolvedAt: now(), resolutionNote: input.note },
    });
    await recordAudit(tx, actor, {
      action: input.outcome === "WAIVED" ? "DISCREPANCY_WAIVED" : "DISCREPANCY_RESOLVED",
      resourceType: "Instrument",
      resourceId: inst.id,
      institutionId: inst.institutionId,
      before: { discrepancyId: d.id, status: "OPEN", code: d.code },
      after: { status: input.outcome },
      reason: input.note,
    });
    return updated;
  });
}

export const commentSchema = z.object({
  body: text(2000).pipe(z.string().min(1, "Write a message")),
  visibility: z.enum(["SHARED", "INTERNAL"]).default("SHARED"),
});

export async function addInstrumentComment(actor: Actor, instrumentId: string, input: z.infer<typeof commentSchema>) {
  if (!["INSTITUTION_USER", "OFFICER", "APPROVING_AUTHORITY"].includes(actor.role)) {
    requirePermission(actor, "instrument:review"); // auditors / admins are read-only here
  }
  if (input.visibility === "INTERNAL") requirePermission(actor, "comment:internal");
  return prisma.$transaction(async (tx) => {
    const inst = await loadScopedInstrument(tx, actor, instrumentId);
    const c = await tx.comment.create({
      data: { instrumentId, authorId: actor.id, authorLabel: actor.name, visibility: input.visibility, body: input.body, createdAt: now() },
    });
    await recordAudit(tx, actor, {
      action: input.visibility === "INTERNAL" ? "INTERNAL_NOTE_ADDED" : "COMMENT_ADDED",
      resourceType: "Instrument",
      resourceId: instrumentId,
      institutionId: inst.institutionId,
      after: { commentId: c.id, visibility: c.visibility },
    });
    return c;
  });
}
