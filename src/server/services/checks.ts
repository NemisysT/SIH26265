// Persists automated consistency findings as discrepancies. A discrepancy raised here only closes
// when a later run (triggered by a recorded correction, document upload or officer re-check) no
// longer detects the condition; that closure is itself recorded with who/what triggered it.
import type { Tx } from "../db";
import type { AnyActor } from "../auth/actor";
import { actorLabel } from "../auth/actor";
import { recordAudit } from "../audit";
import { runInstrumentChecks, normaliseBank, normaliseRef, type Finding } from "../checks/consistency";
import { businessToday } from "@/lib/dates";
import { now } from "../clock";

export async function findDuplicateReferences(tx: Tx, instrument: { id: string; bankName: string | null; instrumentNumber: string | null; institutionId: string }) {
  if (!instrument.instrumentNumber || !instrument.bankName) return [];
  const rows = await tx.$queryRaw<{ referenceNo: string; institutionId: string }[]>`
    SELECT "referenceNo", "institutionId"::text AS "institutionId" FROM "instruments"
    WHERE "id" <> ${instrument.id}::uuid
      AND "status" NOT IN ('DRAFT', 'WITHDRAWN')
      AND upper(regexp_replace(coalesce("instrumentNumber", ''), '[\\s\\-/]', '', 'g')) = ${normaliseRef(instrument.instrumentNumber)}
      AND upper(regexp_replace(trim(coalesce("bankName", '')), '\\s+', ' ', 'g')) = ${normaliseBank(instrument.bankName)}
    LIMIT 10`;
  return rows.map((r) => ({ referenceNo: r.referenceNo, sameInstitution: r.institutionId === instrument.institutionId }));
}

export async function computeInstrumentFindings(tx: Tx, instrumentId: string): Promise<Finding[]> {
  const inst = await tx.instrument.findUniqueOrThrow({
    where: { id: instrumentId },
    include: {
      documents: { where: { isCurrent: true, reviewStatus: { not: "REJECTED" } }, select: { docType: true } },
      replaces: true,
    },
  });
  // Renewal attempts of the same original carry the original's number legitimately; exclude lineage.
  const duplicates = (await findDuplicateReferences(tx, inst)).filter(
    (d) => !inst.replaces || d.referenceNo !== inst.replaces.referenceNo,
  );
  const banks = await tx.bankReference.findMany({ where: { isActive: true }, select: { name: true } });
  return runInstrumentChecks({
    instrument: { ...inst, type: inst.type },
    documentTypes: inst.documents.map((d) => d.docType),
    duplicateReferences: duplicates,
    original: inst.replaces,
    knownBankNames: banks.map((b) => b.name),
    today: businessToday(now()),
  });
}

/**
 * Run checks and reconcile OPEN automated discrepancies. Returns current findings.
 * `trigger` describes why the run happened (e.g. "correction submitted").
 */
export async function applyInstrumentChecks(tx: Tx, instrumentId: string, actor: AnyActor, trigger: string) {
  const findings = await computeInstrumentFindings(tx, instrumentId);
  const inst = await tx.instrument.findUniqueOrThrow({ where: { id: instrumentId }, select: { institutionId: true } });
  const open = await tx.discrepancy.findMany({ where: { instrumentId, source: "AUTOMATED", status: "OPEN" } });
  const openCodes = new Set(open.map((d) => d.code));
  const foundCodes = new Set(findings.map((f) => f.code));

  const toCreate = findings.filter((f) => !openCodes.has(f.code));
  if (toCreate.length) {
    await tx.discrepancy.createMany({
      data: toCreate.map((f) => ({
        instrumentId,
        code: f.code,
        field: f.field,
        severity: f.severity,
        source: "AUTOMATED" as const,
        message: f.message,
        raisedAt: now(),
      })),
    });
  }
  const toResolve = open.filter((d) => !foundCodes.has(d.code));
  for (const d of toResolve) {
    await tx.discrepancy.update({
      where: { id: d.id },
      data: {
        status: "RESOLVED",
        resolvedAt: now(),
        resolvedById: actor.kind === "user" ? actor.id : null,
        resolutionNote: `Condition no longer detected on automated re-check after ${trigger} (by ${actorLabel(actor)}).`,
      },
    });
  }
  const blocking = findings.filter((f) => f.severity === "BLOCKING");
  await tx.verificationRecord.create({
    data: {
      instrumentId,
      method: "AUTOMATED_CONSISTENCY_CHECK",
      source: "SYSTEM",
      initiatedById: actor.kind === "user" ? actor.id : null,
      initiatedBy: `system:consistency-checks (${trigger})`,
      attemptedAt: now(),
      result: blocking.length ? "DISCREPANCY" : "PENDING",
      discrepancyDetails: findings.length ? findings.map((f) => `[${f.severity}] ${f.message}`).join("\n") : null,
      observations: findings.length
        ? `${findings.length} finding(s); ${blocking.length} blocking. Automated checks are review aids, not verification.`
        : "No automated findings. This is not verification of the instrument.",
    },
  });
  if (toCreate.length || toResolve.length) {
    await recordAudit(tx, actor, {
      action: "AUTOMATED_CHECKS_RECONCILED",
      resourceType: "Instrument",
      resourceId: instrumentId,
      institutionId: inst.institutionId,
      after: { raised: toCreate.map((f) => f.code), resolved: toResolve.map((d) => d.code), trigger },
    });
  }
  return findings;
}
