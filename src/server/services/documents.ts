// Document upload / download with per-request authorisation. Binaries live in protected storage;
// metadata (including the SHA-256) lives in the database. Each re-upload of the same document type
// creates a new version and keeps the previous one.
import type { DocumentType } from "@prisma/client";
import { prisma, type Tx } from "../db";
import type { Actor } from "../auth/actor";
import { can, instrumentScope, releaseScope, requirePermission } from "../auth/scope";
import { recordAudit } from "../audit";
import { ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "../errors";
import { deleteStoredFile, readStoredFile, storeFile, validateUpload } from "../storage/files";
import { getSettings } from "../settings";
import { loadScopedInstrument } from "./instruments";
import { applyInstrumentChecks } from "./checks";
import { assertUuid } from "./common";
import { INSTITUTION_DOCUMENT_STATUSES, type InstrumentStatusName } from "../workflow/instrument-machine";
import { now } from "../clock";

const INSTITUTION_INSTRUMENT_DOCS: DocumentType[] = ["FDR_RECEIPT", "DEPOSIT_CONFIRMATION", "RENEWAL_DOCUMENT", "OTHER"];
const OFFICER_INSTRUMENT_DOCS: DocumentType[] = ["BANK_VERIFICATION_LETTER"];
const INSTITUTION_RELEASE_DOCS: DocumentType[] = ["RELEASE_SUPPORTING", "OTHER"];
const OFFICER_RELEASE_DOCS: DocumentType[] = ["RELEASE_COMPLETION_EVIDENCE"];

export interface UploadTarget {
  instrumentId?: string;
  releaseRequestId?: string;
  docType: DocumentType;
}

export interface IncomingFile {
  name: string;
  buffer: Buffer;
}

/** Authorise an upload and return the owning institution + parent identifiers. */
async function authoriseUpload(tx: Tx, actor: Actor, target: UploadTarget) {
  if (target.instrumentId) {
    const inst = await loadScopedInstrument(tx, actor, target.instrumentId);
    if (actor.role === "INSTITUTION_USER") {
      requirePermission(actor, "document:upload-institution");
      if (!INSTITUTION_INSTRUMENT_DOCS.includes(target.docType)) throw new ForbiddenError("This document type cannot be uploaded by an institution.");
      if (!INSTITUTION_DOCUMENT_STATUSES.includes(inst.status as InstrumentStatusName)) {
        throw new InvalidTransitionError("Documents can only be added while the record is a draft, awaiting scrutiny or under correction.");
      }
    } else {
      requirePermission(actor, "document:upload-officer");
      if (!OFFICER_INSTRUMENT_DOCS.includes(target.docType)) throw new ForbiddenError("Officers may upload bank verification letters only.");
      if (!["UNDER_REVIEW", "VERIFICATION_PENDING"].includes(inst.status)) {
        throw new InvalidTransitionError("Verification evidence can be added only while the instrument is under review.");
      }
    }
    return { institutionId: inst.institutionId, instrumentId: inst.id, releaseRequestId: null, status: inst.status };
  }
  if (target.releaseRequestId) {
    assertUuid(target.releaseRequestId, "Release request");
    requirePermission(actor, "release:read");
    const rr = await tx.releaseRequest.findFirst({ where: { AND: [{ id: target.releaseRequestId }, releaseScope(actor)] } });
    if (!rr) throw new NotFoundError("Release request");
    if (actor.role === "INSTITUTION_USER") {
      requirePermission(actor, "document:upload-institution");
      if (!INSTITUTION_RELEASE_DOCS.includes(target.docType)) throw new ForbiddenError("This document type cannot be uploaded by an institution.");
      if (!["SUBMITTED", "INFO_REQUESTED"].includes(rr.status)) {
        throw new InvalidTransitionError("Supporting documents can be added only before scrutiny starts or when information is requested.");
      }
    } else {
      requirePermission(actor, "release:complete");
      if (!OFFICER_RELEASE_DOCS.includes(target.docType)) throw new ForbiddenError("Officers may upload completion evidence only.");
      if (rr.status !== "APPROVED") throw new InvalidTransitionError("Completion evidence can be added only after approval.");
    }
    return { institutionId: rr.institutionId, instrumentId: null, releaseRequestId: rr.id, status: rr.status };
  }
  throw new ValidationError("A document must be attached to an instrument or a release request.");
}

/**
 * Validate → store file → DB transaction. If the transaction fails the stored file is removed, so
 * an interrupted or failed upload never leaves an orphaned binary or a phantom record.
 */
export async function uploadDocument(actor: Actor, target: UploadTarget, file: IncomingFile) {
  const settings = await getSettings();
  const validated = validateUpload(file, settings.maxUploadMb * 1024 * 1024);
  // Authorise before touching storage.
  await prisma.$transaction((tx) => authoriseUpload(tx, actor, target));
  const storageKey = await storeFile(validated.buffer, now());
  try {
    return await prisma.$transaction(async (tx) => {
      const owner = await authoriseUpload(tx, actor, target); // re-check inside the write transaction
      const parentWhere = owner.instrumentId ? { instrumentId: owner.instrumentId } : { releaseRequestId: owner.releaseRequestId };
      const previous = await tx.document.findFirst({
        where: { ...parentWhere, docType: target.docType, isCurrent: true },
        orderBy: { version: "desc" },
      });
      if (previous) await tx.document.update({ where: { id: previous.id }, data: { isCurrent: false } });
      const doc = await tx.document.create({
        data: {
          institutionId: owner.institutionId,
          instrumentId: owner.instrumentId,
          releaseRequestId: owner.releaseRequestId,
          docType: target.docType,
          originalName: validated.originalName,
          storageKey,
          sizeBytes: validated.sizeBytes,
          mimeType: validated.mimeType,
          sha256: validated.sha256,
          version: (previous?.version ?? 0) + 1,
          supersedesId: previous?.id,
          uploadedById: actor.id,
          uploadedAt: now(),
        },
      });
      await recordAudit(tx, actor, {
        action: previous ? "DOCUMENT_VERSION_UPLOADED" : "DOCUMENT_UPLOADED",
        resourceType: owner.instrumentId ? "Instrument" : "ReleaseRequest",
        resourceId: (owner.instrumentId ?? owner.releaseRequestId)!,
        institutionId: owner.institutionId,
        after: {
          documentId: doc.id,
          docType: doc.docType,
          version: doc.version,
          originalName: doc.originalName,
          sizeBytes: doc.sizeBytes,
          mimeType: doc.mimeType,
          sha256: doc.sha256,
          supersedes: previous?.id ?? null,
        },
      });
      if (owner.instrumentId && owner.status === "PENDING_SCRUTINY") {
        await applyInstrumentChecks(tx, owner.instrumentId, actor, "document upload");
      }
      if (owner.releaseRequestId && target.docType === "RELEASE_SUPPORTING") {
        await tx.discrepancy.updateMany({
          where: { releaseRequestId: owner.releaseRequestId, code: "RELEASE_MISSING_SUPPORTING_DOCUMENT", status: "OPEN" },
          data: { status: "RESOLVED", resolvedAt: now(), resolvedById: actor.id, resolutionNote: `Supporting document uploaded (${doc.originalName}).` },
        });
      }
      return doc;
    });
  } catch (err) {
    await deleteStoredFile(storageKey).catch(() => undefined);
    throw err;
  }
}

/** Authorise a download. Auditors see metadata only; bank letters are internal to the Bureau. */
export async function authoriseDownload(actor: Actor, documentId: string) {
  assertUuid(documentId, "Document");
  requirePermission(actor, "document:download");
  const doc = await prisma.document.findUnique({ where: { id: documentId } });
  if (!doc) throw new NotFoundError("Document");
  let visible = false;
  if (doc.instrumentId) {
    visible = (await prisma.instrument.count({ where: { AND: [{ id: doc.instrumentId }, instrumentScope(actor)] } })) > 0;
  } else if (doc.releaseRequestId) {
    visible = (await prisma.releaseRequest.count({ where: { AND: [{ id: doc.releaseRequestId }, releaseScope(actor)] } })) > 0;
  }
  if (!visible) throw new NotFoundError("Document");
  if (doc.docType === "BANK_VERIFICATION_LETTER" && !can(actor, "comment:internal")) throw new NotFoundError("Document");
  return doc;
}

export async function downloadDocument(actor: Actor, documentId: string) {
  const doc = await authoriseDownload(actor, documentId);
  const buffer = await readStoredFile(doc.storageKey);
  await recordAudit(prisma, actor, {
    action: "DOCUMENT_DOWNLOADED",
    resourceType: doc.instrumentId ? "Instrument" : "ReleaseRequest",
    resourceId: (doc.instrumentId ?? doc.releaseRequestId)!,
    institutionId: doc.institutionId,
    after: { documentId: doc.id, version: doc.version },
  });
  return { doc, buffer };
}

export async function reviewDocument(actor: Actor, documentId: string, input: { status: "ACCEPTED" | "REJECTED"; note?: string }) {
  requirePermission(actor, "document:review");
  assertUuid(documentId, "Document");
  if (input.status === "REJECTED" && !input.note?.trim()) throw new ValidationError("Give a reason for rejecting the document.", { note: ["Required"] });
  return prisma.$transaction(async (tx) => {
    const doc = await tx.document.findUnique({ where: { id: documentId } });
    if (!doc?.instrumentId) throw new NotFoundError("Document");
    const inst = await loadScopedInstrument(tx, actor, doc.instrumentId);
    if (!["UNDER_REVIEW", "VERIFICATION_PENDING"].includes(inst.status)) {
      throw new InvalidTransitionError("Documents are reviewed while the instrument is under review.");
    }
    if (!doc.isCurrent) throw new InvalidTransitionError("Only the current version of a document can be reviewed.");
    const updated = await tx.document.update({
      where: { id: documentId },
      data: { reviewStatus: input.status, reviewNote: input.note ?? null, reviewedById: actor.id, reviewedAt: now() },
    });
    await recordAudit(tx, actor, {
      action: "DOCUMENT_REVIEWED",
      resourceType: "Instrument",
      resourceId: inst.id,
      institutionId: inst.institutionId,
      before: { documentId, reviewStatus: doc.reviewStatus },
      after: { reviewStatus: input.status },
      reason: input.note,
    });
    if (input.status === "REJECTED") await applyInstrumentChecks(tx, inst.id, actor, "document rejected");
    return updated;
  });
}
