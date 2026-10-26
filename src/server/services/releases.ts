// Release / refund requests: officer scrutiny → approving authority decision → recorded completion.
// No money moves through this system; "completed" records evidence that processing happened elsewhere.
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma, type Tx } from "../db";
import type { Actor } from "../auth/actor";
import { releaseScope, requirePermission } from "../auth/scope";
import { recordAudit } from "../audit";
import { nextReference } from "../counters";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError, isUniqueViolation } from "../errors";
import { RELEASE_TRANSITIONS, OPEN_RELEASE_STATUSES, type ReleaseAction, type ReleaseStatusName } from "../workflow/release-machine";
import { loadScopedInstrument, systemTransition } from "./instruments";
import { runReleaseChecks } from "../checks/consistency";
import { institutionUserIds, notify, officerIdsForInstitution, userIdsByRole } from "../notifications/notify";
import { deleteStoredFile, storeFile, validateUpload, type ValidatedFile } from "../storage/files";
import { getSettings } from "../settings";
import { assertUuid } from "./common";
import { businessToday } from "@/lib/dates";
import { amountString, text } from "@/lib/validation";
import { now } from "../clock";

export const createReleaseSchema = z.object({
  instrumentId: z.string().uuid(),
  type: z.enum(["RELEASE", "REFUND"]),
  requestedAmount: amountString,
  reason: text(2000).pipe(z.string().min(10, "Explain the grounds for the request (at least 10 characters)")),
  clientRequestId: z.string().uuid().optional(),
});
export type CreateReleaseInput = z.infer<typeof createReleaseSchema>;

export const releaseDetailInclude = {
  institution: { include: { region: true } },
  instrument: { select: { id: true, referenceNo: true, status: true, amount: true, maturityDate: true, bankName: true, instrumentNumber: true, type: true, institutionId: true } },
  documents: { orderBy: [{ docType: "asc" }, { version: "desc" }], omit: { storageKey: true } },
  discrepancies: { orderBy: { raisedAt: "desc" } },
  comments: { orderBy: { createdAt: "asc" } },
} satisfies Prisma.ReleaseRequestInclude;

export async function loadScopedRelease(db: Tx | typeof prisma, actor: Actor, id: string) {
  assertUuid(id, "Release request");
  requirePermission(actor, "release:read");
  const rr = await db.releaseRequest.findFirst({ where: { AND: [{ id }, releaseScope(actor)] } });
  if (!rr) throw new NotFoundError("Release request");
  return rr;
}

export async function getReleaseDetail(actor: Actor, id: string) {
  await loadScopedRelease(prisma, actor, id);
  const detail = await prisma.releaseRequest.findUniqueOrThrow({ where: { id }, include: releaseDetailInclude });
  if (actor.role === "INSTITUTION_USER") detail.comments = detail.comments.filter((c) => c.visibility === "SHARED");
  return detail;
}

/** Create a request together with its supporting documents in one atomic operation. */
export async function createReleaseRequest(actor: Actor, input: CreateReleaseInput, files: { name: string; buffer: Buffer }[]) {
  requirePermission(actor, "release:create");
  if (input.clientRequestId) {
    const existing = await prisma.releaseRequest.findUnique({ where: { clientRequestId: input.clientRequestId } });
    if (existing) {
      if (existing.institutionId !== actor.institutionId) throw new ConflictError("Duplicate request identifier.");
      return existing; // idempotent retry
    }
  }
  if (files.length === 0) {
    throw new ValidationError("Attach at least one supporting document (e.g. covering letter or closure certificate).", {
      files: ["At least one supporting document is required"],
    });
  }
  if (files.length > 5) throw new ValidationError("Attach at most 5 documents per submission.");
  const settings = await getSettings();
  const validated: ValidatedFile[] = files.map((f) => validateUpload(f, settings.maxUploadMb * 1024 * 1024));

  // Eligibility pre-check before writing any files.
  await prisma.$transaction((tx) => assertEligible(tx, actor, input));
  const keys: string[] = [];
  try {
    for (const v of validated) keys.push(await storeFile(v.buffer, now()));
    return await prisma.$transaction(async (tx) => {
      const inst = await assertEligible(tx, actor, input);
      const referenceNo = await nextReference(tx, "REL", now().getUTCFullYear());
      const rr = await tx.releaseRequest.create({
        data: {
          referenceNo,
          institutionId: inst.institutionId,
          instrumentId: inst.id,
          type: input.type,
          requestedAmount: new Prisma.Decimal(input.requestedAmount),
          reason: input.reason,
          submittedById: actor.id,
          clientRequestId: input.clientRequestId,
          submittedAt: now(),
          statusChangedAt: now(),
          createdAt: now(),
        },
      });
      for (const [i, v] of validated.entries()) {
        await tx.document.create({
          data: {
            institutionId: inst.institutionId,
            releaseRequestId: rr.id,
            docType: "RELEASE_SUPPORTING",
            originalName: v.originalName,
            storageKey: keys[i],
            sizeBytes: v.sizeBytes,
            mimeType: v.mimeType,
            sha256: v.sha256,
            uploadedById: actor.id,
            uploadedAt: now(),
          },
        });
      }
      const findings = runReleaseChecks({
        supportingDocumentCount: validated.length,
        instrumentStatus: inst.status,
        maturityDate: inst.maturityDate,
        requestedAmount: rr.requestedAmount,
        instrumentAmount: inst.amount,
        today: businessToday(now()),
      });
      if (findings.length) {
        await tx.discrepancy.createMany({
          data: findings.map((f) => ({ releaseRequestId: rr.id, code: f.code, severity: f.severity, source: "AUTOMATED" as const, message: f.message, raisedAt: now() })),
        });
      }
      await recordAudit(tx, actor, {
        action: "RELEASE_REQUEST_SUBMITTED",
        resourceType: "ReleaseRequest",
        resourceId: rr.id,
        institutionId: inst.institutionId,
        after: { referenceNo, instrument: inst.referenceNo, type: input.type, requestedAmount: input.requestedAmount, documents: validated.length, findings: findings.map((f) => f.code) },
        reason: input.reason,
      });
      await notify(tx, {
        recipientIds: await officerIdsForInstitution(tx, inst.institutionId),
        type: "RELEASE_SUBMITTED",
        title: `Release/refund request ${referenceNo}`,
        message: `${inst.referenceNo}: ${input.type.toLowerCase()} requested and awaiting scrutiny.`,
        link: `/releases/${rr.id}`,
        institutionId: inst.institutionId,
        releaseRequestId: rr.id,
        instrumentId: inst.id,
      });
      return rr;
    });
  } catch (err) {
    for (const k of keys) await deleteStoredFile(k).catch(() => undefined);
    if (isUniqueViolation(err)) throw new ConflictError("A release/refund request is already open for this instrument.", "DUPLICATE");
    throw err;
  }
}

async function assertEligible(tx: Tx, actor: Actor, input: CreateReleaseInput) {
  const inst = await loadScopedInstrument(tx, actor, input.instrumentId);
  if (!["ACCEPTED", "REPLACED"].includes(inst.status)) {
    throw new InvalidTransitionError("Only accepted or replaced instruments are eligible for release/refund.");
  }
  if (inst.amount && Number(input.requestedAmount) > Number(inst.amount.toString())) {
    throw new ValidationError("The requested amount cannot exceed the recorded instrument amount.", { requestedAmount: ["Exceeds instrument amount"] });
  }
  const open = await tx.releaseRequest.findFirst({ where: { instrumentId: inst.id, status: { in: OPEN_RELEASE_STATUSES } } });
  if (open) throw new ConflictError(`Request ${open.referenceNo} is already open for this instrument.`, "DUPLICATE");
  const renewal = await tx.renewalCase.findFirst({ where: { originalInstrumentId: inst.id, status: "IN_PROGRESS" } });
  if (renewal) throw new ConflictError("A renewal/replacement is in progress for this instrument; wait for its outcome.");
  return inst;
}

export interface ReleaseTransitionInput {
  action: ReleaseAction;
  note?: string;
  expectedVersion?: number;
  completionReference?: string;
}

export async function transitionRelease(actor: Actor, id: string, input: ReleaseTransitionInput) {
  const rule = RELEASE_TRANSITIONS[input.action];
  if (!rule) throw new ValidationError("Unknown action.");
  requirePermission(actor, rule.permission);
  const note = input.note?.trim() || undefined;
  if (rule.requiresNote && !note) throw new ValidationError("A reason or observation is required for this action.", { note: ["Required"] });

  return prisma.$transaction(async (tx) => {
    const rr = await loadScopedRelease(tx, actor, id);
    if (input.expectedVersion !== undefined && input.expectedVersion !== rr.version) {
      throw new ConflictError("This request was changed by someone else. Reload and try again.", "STALE_VERSION");
    }
    const from = rr.status as ReleaseStatusName;
    if (!rule.from.includes(from)) {
      throw new InvalidTransitionError(`"${rule.label}" is not permitted while the request is ${from.replace(/_/g, " ").toLowerCase()}.`);
    }
    const data: Prisma.ReleaseRequestUncheckedUpdateManyInput = {};
    switch (input.action) {
      case "START_SCRUTINY":
        data.assignedOfficerId = actor.id;
        break;
      case "REQUEST_INFO":
        // Officers ask during scrutiny; authorities ask during approval.
        if (from === "UNDER_SCRUTINY" && actor.role !== "OFFICER") throw new ForbiddenError();
        if (from === "PENDING_APPROVAL" && actor.role !== "APPROVING_AUTHORITY") throw new ForbiddenError();
        data.infoRequestNote = note;
        break;
      case "PROVIDE_INFO":
        if (actor.role !== "INSTITUTION_USER") throw new ForbiddenError();
        break;
      case "FORWARD": {
        const blocking = await tx.discrepancy.count({ where: { releaseRequestId: id, status: "OPEN", severity: "BLOCKING" } });
        if (blocking > 0) throw new InvalidTransitionError("Resolve the blocking findings (e.g. missing supporting documents) before forwarding.");
        data.scrutinyNote = note;
        data.scrutinizedById = actor.id;
        data.scrutinizedAt = now();
        break;
      }
      case "APPROVE":
      case "REJECT":
        // Separation of duties: the decider must not be the officer who scrutinised the request.
        if (rr.scrutinizedById === actor.id || rr.assignedOfficerId === actor.id) {
          throw new ForbiddenError("The person who scrutinised a request cannot also decide it.");
        }
        data.decision = input.action === "APPROVE" ? "APPROVED" : "REJECTED";
        data.decisionReason = note;
        data.decidedById = actor.id;
        data.decidedAt = now();
        break;
      case "COMPLETE": {
        const ref = input.completionReference?.trim();
        if (!ref) throw new ValidationError("Record the completion reference (e.g. bank discharge/transfer advice number).", { completionReference: ["Required"] });
        if (rr.decision !== "APPROVED" || !rr.decidedById) throw new InvalidTransitionError("Completion requires a recorded approval.");
        const evidence = await tx.document.count({ where: { releaseRequestId: id, docType: "RELEASE_COMPLETION_EVIDENCE", isCurrent: true } });
        if (evidence === 0) throw new InvalidTransitionError("Upload the completion evidence document before recording completion.");
        data.completionReference = ref.slice(0, 120);
        data.completionNote = note;
        data.completedById = actor.id;
        data.completedAt = now();
        break;
      }
      case "WITHDRAW":
        if (actor.role !== "INSTITUTION_USER") throw new ForbiddenError();
        break;
    }
    const res = await tx.releaseRequest.updateMany({
      where: { id, version: rr.version },
      data: { ...data, status: rule.to, statusChangedAt: now(), version: { increment: 1 } },
    });
    if (res.count === 0) throw new ConflictError("This request was changed by someone else. Reload and try again.", "STALE_VERSION");

    if (input.action === "COMPLETE") {
      await systemTransition(tx, actor, rr.instrumentId, "MARK_RELEASED", `Release/refund ${rr.referenceNo} completed (ref ${data.completionReference}).`);
    }
    await recordAudit(tx, actor, {
      action: `RELEASE_${input.action}`,
      resourceType: "ReleaseRequest",
      resourceId: id,
      institutionId: rr.institutionId,
      before: { status: from },
      after: { status: rule.to, ...(data.decision ? { decision: data.decision } : {}), ...(data.completionReference ? { completionReference: data.completionReference } : {}) },
      reason: note,
    });
    if (note) {
      await tx.comment.create({
        data: { releaseRequestId: id, authorId: actor.id, authorLabel: `${actor.name} (${rule.label})`, visibility: "SHARED", body: note, createdAt: now() },
      });
    }

    const link = `/releases/${id}`;
    const base = { institutionId: rr.institutionId, releaseRequestId: id, instrumentId: rr.instrumentId, link };
    if (input.action === "FORWARD") {
      await notify(tx, { ...base, recipientIds: await userIdsByRole(tx, "APPROVING_AUTHORITY"), type: "RELEASE_SUBMITTED", title: `Approval required: ${rr.referenceNo}`, message: "Scrutiny complete; the request awaits a decision." });
    }
    if (input.action === "APPROVE" || input.action === "REJECT") {
      await notify(tx, { ...base, recipientIds: await institutionUserIds(tx, rr.institutionId), type: "RELEASE_DECISION", title: `${input.action === "APPROVE" ? "Approved" : "Rejected"}: ${rr.referenceNo}`, message: input.action === "APPROVE" ? "Approved. Completion will be recorded once processing evidence is available." : `Reason: ${note}` });
      await notify(tx, { ...base, recipientIds: await officerIdsForInstitution(tx, rr.institutionId), type: "RELEASE_DECISION", title: `Decision recorded: ${rr.referenceNo}`, message: `${data.decision}. ${input.action === "APPROVE" ? "Record completion once evidence is received." : ""}` });
    }
    if (input.action === "REQUEST_INFO") {
      await notify(tx, { ...base, recipientIds: await institutionUserIds(tx, rr.institutionId), type: "CORRECTION_REQUESTED", title: `Information requested: ${rr.referenceNo}`, message: note! });
    }
    if (input.action === "PROVIDE_INFO") {
      const recipients = rr.assignedOfficerId ? [rr.assignedOfficerId] : await officerIdsForInstitution(tx, rr.institutionId);
      await notify(tx, { ...base, recipientIds: recipients, type: "CORRECTION_SUBMITTED", title: `Information provided: ${rr.referenceNo}`, message: "The institution responded; scrutiny can continue." });
    }
    if (input.action === "COMPLETE") {
      await notify(tx, { ...base, recipientIds: await institutionUserIds(tx, rr.institutionId), type: "RELEASE_DECISION", title: `Completion recorded: ${rr.referenceNo}`, message: `Completion reference ${data.completionReference}.` });
    }
    return tx.releaseRequest.findUniqueOrThrow({ where: { id } });
  });
}

export interface ReleaseFilters {
  q?: string;
  status?: string;
  view?: "open" | "awaiting-me" | "decided" | "all";
  institutionId?: string;
}

export async function listReleaseRequests(actor: Actor, filters: ReleaseFilters, paging: { skip: number; take: number }) {
  requirePermission(actor, "release:read");
  const and: Prisma.ReleaseRequestWhereInput[] = [releaseScope(actor)];
  if (filters.q) {
    and.push({
      OR: [
        { referenceNo: { contains: filters.q, mode: "insensitive" } },
        { instrument: { referenceNo: { contains: filters.q, mode: "insensitive" } } },
        { instrument: { instrumentNumber: { contains: filters.q, mode: "insensitive" } } },
        { institution: { name: { contains: filters.q, mode: "insensitive" } } },
        { institution: { code: { contains: filters.q, mode: "insensitive" } } },
      ],
    });
  }
  const validStatuses = ["SUBMITTED", "UNDER_SCRUTINY", "INFO_REQUESTED", "PENDING_APPROVAL", "APPROVED", "REJECTED", "COMPLETED", "WITHDRAWN"];
  if (filters.status && validStatuses.includes(filters.status)) and.push({ status: filters.status as ReleaseStatusName });
  if (filters.institutionId) and.push({ institutionId: filters.institutionId });
  if (filters.view === "open") and.push({ status: { in: OPEN_RELEASE_STATUSES } });
  if (filters.view === "decided") and.push({ status: { in: ["APPROVED", "REJECTED", "COMPLETED"] } });
  if (filters.view === "awaiting-me") {
    if (actor.role === "OFFICER") and.push({ status: { in: ["SUBMITTED", "UNDER_SCRUTINY", "APPROVED"] } });
    else if (actor.role === "APPROVING_AUTHORITY") and.push({ status: "PENDING_APPROVAL" });
    else if (actor.role === "INSTITUTION_USER") and.push({ status: "INFO_REQUESTED" });
  }
  const where = { AND: and };
  const [rows, total, sum] = await Promise.all([
    prisma.releaseRequest.findMany({
      where,
      include: { institution: { select: { name: true, code: true } }, instrument: { select: { referenceNo: true, instrumentNumber: true, bankName: true } } },
      orderBy: [{ statusChangedAt: "desc" }],
      skip: paging.skip, take: paging.take,
    }),
    prisma.releaseRequest.count({ where }),
    prisma.releaseRequest.aggregate({ where, _sum: { requestedAmount: true } }),
  ]);
  return { rows, total, totalAmount: sum._sum.requestedAmount };
}

export function releaseActionsFor(actor: Actor, rr: { status: string; assignedOfficerId: string | null; scrutinizedById: string | null }): ReleaseAction[] {
  const actions: ReleaseAction[] = [];
  for (const [action, rule] of Object.entries(RELEASE_TRANSITIONS) as [ReleaseAction, (typeof RELEASE_TRANSITIONS)[ReleaseAction]][]) {
    if (!rule.from.includes(rr.status as ReleaseStatusName)) continue;
    if (action === "REQUEST_INFO") {
      if (rr.status === "UNDER_SCRUTINY" && actor.role !== "OFFICER") continue;
      if (rr.status === "PENDING_APPROVAL" && actor.role !== "APPROVING_AUTHORITY") continue;
    }
    if ((action === "PROVIDE_INFO" || action === "WITHDRAW") && actor.role !== "INSTITUTION_USER") continue;
    if ((action === "APPROVE" || action === "REJECT") && (rr.scrutinizedById === actor.id || rr.assignedOfficerId === actor.id)) continue;
    const roleOk =
      (rule.permission === "release:read" && ["OFFICER", "APPROVING_AUTHORITY"].includes(actor.role)) ||
      (rule.permission !== "release:read" && requireOk(actor, rule.permission));
    if (roleOk) actions.push(action);
  }
  return actions;
}

function requireOk(actor: Actor, p: Parameters<typeof requirePermission>[1]) {
  try {
    requirePermission(actor, p);
    return true;
  } catch {
    return false;
  }
}
