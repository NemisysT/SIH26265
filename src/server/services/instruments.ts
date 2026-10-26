// Financial instrument lifecycle: drafting, submission, scrutiny transitions and renewal linkage.
// Every function takes the acting user, enforces permission + data scope, and writes its audit
// event in the same transaction as the change.
import { Prisma } from "@prisma/client";
import { prisma, type Tx } from "../db";
import type { Actor } from "../auth/actor";
import { can, instrumentScope, requirePermission } from "../auth/scope";
import { recordAudit, diff } from "../audit";
import { nextReference } from "../counters";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "../errors";
import { assertUuid } from "./common";
import { applyInstrumentChecks } from "./checks";
import { institutionUserIds, notify, officerIdsForInstitution } from "../notifications/notify";
import {
  INSTITUTION_EDITABLE,
  INSTRUMENT_TRANSITIONS,
  SYSTEM_TRANSITIONS,
  type InstrumentAction,
  type InstrumentStatusName,
  type SystemInstrumentTransition,
} from "../workflow/instrument-machine";
import { SUBMISSION_REQUIRED_FIELDS, type InstrumentDraftInput } from "@/lib/validation";
import { addDays, businessToday, parseDateOnly } from "@/lib/dates";
import { getSettings } from "../settings";
import { now } from "../clock";

export const instrumentDetailInclude = {
  institution: { include: { region: true } },
  // Storage keys never leave the server.
  documents: { orderBy: [{ docType: "asc" }, { version: "desc" }], omit: { storageKey: true } },
  verifications: { orderBy: { attemptedAt: "desc" } },
  discrepancies: { orderBy: [{ status: "asc" }, { raisedAt: "desc" }] },
  comments: { orderBy: { createdAt: "asc" } },
  releaseRequests: { orderBy: { submittedAt: "desc" } },
  replaces: { select: { id: true, referenceNo: true, status: true, maturityDate: true, amount: true, instrumentNumber: true, bankName: true } },
  replacements: { select: { id: true, referenceNo: true, status: true, maturityDate: true }, orderBy: { createdAt: "desc" } },
  renewalAsNew: true,
  renewalsAsOriginal: { orderBy: { submittedAt: "desc" }, include: { newInstrument: { select: { id: true, referenceNo: true, status: true } } } },
} satisfies Prisma.InstrumentInclude;

export type InstrumentDetail = Prisma.InstrumentGetPayload<{ include: typeof instrumentDetailInclude }>;

/** Load an instrument the actor may see, or throw NotFound (never Forbidden, to avoid disclosure). */
export async function loadScopedInstrument(db: Tx | typeof prisma, actor: Actor, id: string) {
  assertUuid(id, "Instrument");
  requirePermission(actor, "instrument:read");
  const inst = await db.instrument.findFirst({ where: { AND: [{ id }, instrumentScope(actor)] } });
  if (!inst) throw new NotFoundError("Instrument");
  return inst;
}

export async function getInstrumentDetail(actor: Actor, id: string): Promise<InstrumentDetail> {
  await loadScopedInstrument(prisma, actor, id);
  const detail = await prisma.instrument.findUniqueOrThrow({ where: { id }, include: instrumentDetailInclude });
  if (!can(actor, "comment:internal")) {
    detail.comments = detail.comments.filter((c) => c.visibility === "SHARED");
    // Bank verification letters are Bureau working papers, not shared with institutions.
    detail.documents = detail.documents.filter((d) => d.docType !== "BANK_VERIFICATION_LETTER");
  }
  return detail;
}

function toData(input: Partial<InstrumentDraftInput>) {
  const data: Prisma.InstrumentUncheckedUpdateInput = {};
  const set = <K extends keyof Prisma.InstrumentUncheckedUpdateInput>(k: K, v: Prisma.InstrumentUncheckedUpdateInput[K]) => {
    data[k] = v;
  };
  if ("type" in input && input.type) set("type", input.type);
  for (const k of ["instrumentNumber", "bankName", "branchName", "ifscCode", "purpose", "notes"] as const) {
    if (k in input) set(k, input[k] ?? null);
  }
  if ("amount" in input) set("amount", input.amount ? new Prisma.Decimal(input.amount) : null);
  for (const k of ["issueDate", "maturityDate", "validUntil"] as const) {
    if (k in input) set(k, input[k] ? parseDateOnly(input[k]!) : null);
  }
  return data;
}

async function assertInstitutionActive(tx: Tx, institutionId: string) {
  const inst = await tx.institution.findUnique({ where: { id: institutionId }, select: { status: true } });
  if (inst?.status !== "ACTIVE") throw new ForbiddenError("Your institution must be approved (active) before submitting instruments.");
}

export async function createDraft(actor: Actor, input: InstrumentDraftInput) {
  requirePermission(actor, "instrument:create");
  if (!actor.institutionId) throw new ForbiddenError();
  const institutionId = actor.institutionId;
  if (input.clientRequestId) {
    const existing = await prisma.instrument.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (existing) {
      if (existing.institutionId !== institutionId) throw new ConflictError("Duplicate request identifier.");
      return existing; // idempotent retry of the same create
    }
  }
  return prisma.$transaction(async (tx) => {
    await assertInstitutionActive(tx, institutionId);
    const referenceNo = await nextReference(tx, "SDP", now().getUTCFullYear());
    const created = await tx.instrument.create({
      data: {
        ...(toData(input) as Prisma.InstrumentUncheckedCreateInput),
        type: input.type,
        referenceNo,
        institutionId,
        status: "DRAFT",
        createdById: actor.id,
        clientRequestId: input.clientRequestId,
        createdAt: now(),
        statusChangedAt: now(),
      },
    });
    await recordAudit(tx, actor, {
      action: "INSTRUMENT_DRAFT_CREATED",
      resourceType: "Instrument",
      resourceId: created.id,
      institutionId,
      after: { referenceNo, ...input, clientRequestId: undefined },
    });
    return created;
  });
}

export async function updateInstrumentFields(actor: Actor, id: string, input: Partial<InstrumentDraftInput>, expectedVersion: number) {
  requirePermission(actor, "instrument:edit-own");
  return prisma.$transaction(async (tx) => {
    const inst = await loadScopedInstrument(tx, actor, id);
    if (!INSTITUTION_EDITABLE.includes(inst.status as InstrumentStatusName)) {
      throw new InvalidTransitionError(`Records in status ${inst.status} cannot be edited. Changes after submission require a correction request.`);
    }
    if (inst.status !== "DRAFT" && input.type && input.type !== inst.type) {
      throw new ValidationError("The instrument type cannot be changed after submission.");
    }
    const data = toData(input);
    const changes = diff(inst as unknown as Record<string, unknown>, data as Record<string, unknown>);
    const res = await tx.instrument.updateMany({
      where: { id, version: expectedVersion },
      data: { ...(data as Prisma.InstrumentUncheckedUpdateManyInput), version: { increment: 1 } },
    });
    if (res.count === 0) throw new ConflictError("This record was changed by someone else. Reload and try again.", "STALE_VERSION");
    if (changes.changed.length) {
      await recordAudit(tx, actor, {
        action: inst.status === "DRAFT" ? "INSTRUMENT_DRAFT_UPDATED" : "INSTRUMENT_CORRECTED",
        resourceType: "Instrument",
        resourceId: id,
        institutionId: inst.institutionId,
        before: changes.before,
        after: changes.after,
      });
    }
    return tx.instrument.findUniqueOrThrow({ where: { id } });
  });
}

export function missingRequiredFields(inst: Record<string, unknown>): string[] {
  return SUBMISSION_REQUIRED_FIELDS.filter(([k]) => inst[k] === null || inst[k] === undefined || inst[k] === "").map(([, label]) => label);
}

/** Change status with optimistic concurrency; throws on stale version. */
async function setStatus(
  tx: Tx,
  id: string,
  version: number,
  to: InstrumentStatusName,
  extra: Prisma.InstrumentUncheckedUpdateManyInput = {},
) {
  const res = await tx.instrument.updateMany({
    where: { id, version },
    data: { ...extra, status: to, statusChangedAt: now(), version: { increment: 1 } },
  });
  if (res.count === 0) throw new ConflictError("This record was changed by someone else. Reload and try again.", "STALE_VERSION");
}

export interface TransitionInput {
  action: InstrumentAction;
  expectedVersion?: number;
  note?: string;
}

export async function transitionInstrument(actor: Actor, id: string, input: TransitionInput) {
  const rule = INSTRUMENT_TRANSITIONS[input.action];
  if (!rule) throw new ValidationError("Unknown action.");
  requirePermission(actor, rule.permission);
  const note = input.note?.trim() || undefined;
  if (rule.requiresNote && !note) throw new ValidationError("A reason or observation is required for this action.", { note: ["Required"] });

  return prisma.$transaction(async (tx) => {
    const inst = await loadScopedInstrument(tx, actor, id);
    if (input.expectedVersion !== undefined && input.expectedVersion !== inst.version) {
      throw new ConflictError("This record was changed by someone else. Reload and try again.", "STALE_VERSION");
    }
    const from = inst.status as InstrumentStatusName;
    if (!rule.from.includes(from)) {
      throw new InvalidTransitionError(`"${rule.label}" is not permitted while the instrument is ${from.replace(/_/g, " ").toLowerCase()}.`);
    }
    const settings = await getSettings(tx);
    const extra: Prisma.InstrumentUncheckedUpdateManyInput = {};
    const today = businessToday(now());

    switch (input.action) {
      case "SUBMIT":
      case "RESUBMIT": {
        await assertInstitutionActive(tx, inst.institutionId);
        const missing = missingRequiredFields(inst as unknown as Record<string, unknown>);
        if (missing.length) {
          throw new ValidationError(`Complete the required fields before submitting: ${missing.join(", ")}.`, {
            missing,
          } as unknown as Record<string, string[]>);
        }
        if (inst.issueDate && inst.maturityDate && inst.maturityDate <= inst.issueDate) {
          throw new ValidationError("The maturity date must be after the issue date.", { maturityDate: ["Must be after the issue date"] });
        }
        extra.submittedAt = now();
        if (!inst.firstSubmittedAt) extra.firstSubmittedAt = now();
        extra.verificationStatus = input.action === "RESUBMIT" ? "PENDING" : "NOT_REVIEWED";
        break;
      }
      case "START_REVIEW":
        extra.reviewerId = actor.id;
        extra.verificationStatus = "PENDING";
        break;
      case "REQUEST_CORRECTION":
        extra.verificationStatus = "CORRECTION_REQUESTED";
        break;
      case "SEND_FOR_VERIFICATION":
        extra.verificationStatus = "PENDING";
        break;
      case "ACCEPT": {
        if (inst.verificationStatus !== "CONFIRMED") {
          throw new InvalidTransitionError("Only instruments with a confirmed verification result can be accepted.");
        }
        const open = await tx.discrepancy.count({ where: { instrumentId: id, status: "OPEN" } });
        if (open > 0) throw new InvalidTransitionError(`Resolve or waive the ${open} open discrepancy(ies) before accepting.`);
        const maturity = inst.maturityDate;
        if (!maturity || maturity <= today) {
          throw new InvalidTransitionError("A matured instrument cannot be accepted as current security; a renewal or replacement is required.");
        }
        extra.decidedById = actor.id;
        extra.decidedAt = now();
        break;
      }
      case "REJECT":
        extra.decidedById = actor.id;
        extra.decidedAt = now();
        extra.decisionReason = note;
        break;
      case "WITHDRAW":
        extra.decisionReason = note;
        break;
    }

    await setStatus(tx, id, inst.version, rule.to, extra);
    await recordAudit(tx, actor, {
      action: `INSTRUMENT_${input.action}`,
      resourceType: "Instrument",
      resourceId: id,
      institutionId: inst.institutionId,
      before: { status: from, verificationStatus: inst.verificationStatus },
      after: { status: rule.to, verificationStatus: extra.verificationStatus ?? inst.verificationStatus },
      reason: note,
    });
    if (note) {
      await tx.comment.create({
        data: {
          instrumentId: id,
          authorId: actor.id,
          authorLabel: `${actor.name} (${rule.label})`,
          visibility: "SHARED",
          body: note,
          createdAt: now(),
        },
      });
    }

    // ---- side effects
    const link = `/instruments/${id}`;
    const ref = inst.referenceNo;
    const renewal = await tx.renewalCase.findUnique({ where: { newInstrumentId: id } });

    if (input.action === "SUBMIT" || input.action === "RESUBMIT") {
      if (renewal) {
        await tx.renewalCase.update({ where: { id: renewal.id }, data: { proposedMaturityDate: inst.maturityDate } });
      }
      await applyInstrumentChecks(tx, id, actor, input.action === "SUBMIT" ? "submission" : "correction submitted");
      const officers = await officerIdsForInstitution(tx, inst.institutionId);
      const type = input.action === "SUBMIT" ? (renewal ? "RENEWAL_SUBMITTED" : "SUBMISSION_RECEIVED") : "CORRECTION_SUBMITTED";
      await notify(tx, {
        recipientIds: officers,
        type,
        title: `${input.action === "SUBMIT" ? (renewal ? "Renewal/replacement submitted" : "New submission") : "Correction submitted"}: ${ref}`,
        message: `${ref} is pending scrutiny.`,
        link,
        institutionId: inst.institutionId,
        instrumentId: id,
      });
      await notify(tx, {
        recipientIds: await institutionUserIds(tx, inst.institutionId),
        type: "SUBMISSION_RECEIVED",
        title: `Received for scrutiny: ${ref}`,
        message: "Your submission was received. Receipt is not approval; you will be notified of the outcome.",
        link,
        institutionId: inst.institutionId,
        instrumentId: id,
      });
    }
    if (input.action === "REQUEST_CORRECTION") {
      await notify(tx, {
        recipientIds: await institutionUserIds(tx, inst.institutionId),
        type: "CORRECTION_REQUESTED",
        title: `Correction requested: ${ref}`,
        message: note!,
        link,
        institutionId: inst.institutionId,
        instrumentId: id,
        dueDate: addDays(today, settings.correctionResponseDays),
      });
    }
    if (input.action === "SEND_FOR_VERIFICATION") {
      await notify(tx, {
        recipientIds: await institutionUserIds(tx, inst.institutionId),
        type: "VERIFICATION_PENDING",
        title: `Verification in progress: ${ref}`,
        message: "The Bureau is awaiting independent confirmation of this instrument.",
        link,
        institutionId: inst.institutionId,
        instrumentId: id,
      });
    }
    if (input.action === "ACCEPT" || input.action === "REJECT") {
      if (renewal) await settleRenewal(tx, actor, renewal.id, input.action === "ACCEPT" ? "APPROVED" : "REJECTED", note);
      await notify(tx, {
        recipientIds: await institutionUserIds(tx, inst.institutionId),
        type: "VERIFICATION_RESULT",
        title: `${input.action === "ACCEPT" ? "Accepted" : "Rejected"}: ${ref}`,
        message: input.action === "ACCEPT" ? "The instrument has been accepted and is recorded as held security." : `Reason: ${note}`,
        link,
        institutionId: inst.institutionId,
        instrumentId: id,
      });
    }
    if (input.action === "WITHDRAW" && renewal) {
      await settleRenewal(tx, actor, renewal.id, "WITHDRAWN", note);
    }
    return tx.instrument.findUniqueOrThrow({ where: { id } });
  });
}

/** System-side transition (verification confirmed, replaced, released) — validated against the table. */
export async function systemTransition(tx: Tx, actor: Actor, id: string, t: SystemInstrumentTransition, reason: string) {
  const rule = SYSTEM_TRANSITIONS[t];
  const inst = await tx.instrument.findUniqueOrThrow({ where: { id } });
  if (!rule.from.includes(inst.status as InstrumentStatusName)) {
    throw new InvalidTransitionError(`Instrument ${inst.referenceNo} cannot move from ${inst.status} to ${rule.to}.`);
  }
  await setStatus(tx, id, inst.version, rule.to, t === "VERIFICATION_CONFIRMED" ? { verificationStatus: "CONFIRMED" } : {});
  await recordAudit(tx, actor, {
    action: `INSTRUMENT_${t}`,
    resourceType: "Instrument",
    resourceId: id,
    institutionId: inst.institutionId,
    before: { status: inst.status },
    after: { status: rule.to },
    reason,
  });
}

async function settleRenewal(tx: Tx, actor: Actor, renewalId: string, status: "APPROVED" | "REJECTED" | "WITHDRAWN", note?: string) {
  const rc = await tx.renewalCase.findUniqueOrThrow({ where: { id: renewalId } });
  if (rc.status !== "IN_PROGRESS") return;
  await tx.renewalCase.update({ where: { id: renewalId }, data: { status, decidedAt: now(), decisionNote: note ?? null } });
  if (status === "APPROVED") {
    // The original keeps its own dates, amount, bank details and documents; only its status records
    // that it has been superseded.
    await systemTransition(tx, actor, rc.originalInstrumentId, "MARK_REPLACED", `Superseded by accepted ${rc.kind.toLowerCase()} (${rc.referenceNo}).`);
  }
  const orig = await tx.instrument.findUniqueOrThrow({ where: { id: rc.originalInstrumentId }, select: { institutionId: true } });
  await recordAudit(tx, actor, {
    action: `RENEWAL_${status}`,
    resourceType: "RenewalCase",
    resourceId: renewalId,
    institutionId: orig.institutionId,
    before: { status: "IN_PROGRESS" },
    after: { status },
    reason: note,
  });
}

// ---------------------------------------------------------------- renewal / replacement

export interface RenewalInput extends InstrumentDraftInput {
  kind: "RENEWAL" | "REPLACEMENT";
  reason: string;
}

/** Create a NEW linked draft instrument plus a renewal case; the original record is untouched. */
export async function startRenewal(actor: Actor, originalId: string, input: RenewalInput) {
  requirePermission(actor, "renewal:submit");
  return prisma.$transaction(async (tx) => {
    const original = await loadScopedInstrument(tx, actor, originalId);
    if (original.status !== "ACCEPTED") {
      throw new InvalidTransitionError("Only an accepted (held) instrument can be renewed or replaced.");
    }
    const open = await tx.renewalCase.findFirst({ where: { originalInstrumentId: originalId, status: "IN_PROGRESS" } });
    if (open) throw new ConflictError(`A renewal/replacement (${open.referenceNo}) is already in progress for this instrument.`, "DUPLICATE");
    const openRelease = await tx.releaseRequest.findFirst({
      where: { instrumentId: originalId, status: { in: ["SUBMITTED", "UNDER_SCRUTINY", "INFO_REQUESTED", "PENDING_APPROVAL", "APPROVED"] } },
    });
    if (openRelease) throw new ConflictError("A release/refund request is open for this instrument; it cannot be renewed at the same time.");
    await assertInstitutionActive(tx, original.institutionId);
    const year = now().getUTCFullYear();
    const referenceNo = await nextReference(tx, "SDP", year);
    const { kind, reason, clientRequestId, ...fields } = input;
    const created = await tx.instrument.create({
      data: {
        ...(toData(fields) as Prisma.InstrumentUncheckedCreateInput),
        type: fields.type,
        referenceNo,
        institutionId: original.institutionId,
        status: "DRAFT",
        replacesInstrumentId: originalId,
        createdById: actor.id,
        clientRequestId,
        createdAt: now(),
        statusChangedAt: now(),
      },
    });
    const caseRef = await nextReference(tx, "RNW", year);
    const rc = await tx.renewalCase.create({
      data: {
        referenceNo: caseRef,
        kind,
        originalInstrumentId: originalId,
        newInstrumentId: created.id,
        reason,
        previousMaturityDate: original.maturityDate,
        proposedMaturityDate: created.maturityDate,
        submittedById: actor.id,
        submittedAt: now(),
        createdAt: now(),
      },
    });
    await recordAudit(tx, actor, {
      action: "RENEWAL_STARTED",
      resourceType: "RenewalCase",
      resourceId: rc.id,
      institutionId: original.institutionId,
      after: { kind, original: original.referenceNo, newInstrument: referenceNo, reason },
    });
    return { instrument: created, renewal: rc };
  });
}
