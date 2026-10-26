// End-to-end business workflows through the service layer against a real PostgreSQL database.
// Numbered comments map to the required validation checklist (README › Validation).
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/server/db";
import { setClock } from "@/server/clock";
import { buildWorld, draftInput, pdfFile, submitted, accepted, type World } from "../helpers";
import { createDraft, getInstrumentDetail, startRenewal, transitionInstrument, updateInstrumentFields } from "@/server/services/instruments";
import { uploadDocument, authoriseDownload, downloadDocument } from "@/server/services/documents";
import { recordVerification, runExternalVerification, resolveDiscrepancy, raiseDiscrepancy } from "@/server/services/verification";
import { createReleaseRequest, transitionRelease, listReleaseRequests } from "@/server/services/releases";
import { searchInstruments } from "@/server/services/search";
import { generateReport } from "@/server/services/reports";
import { runMonitor } from "@/server/jobs/monitor";
import { getDashboard } from "@/server/services/dashboard";
import { ConflictError, ForbiddenError, InvalidTransitionError, NotFoundError, ValidationError } from "@/server/errors";
import { instrumentDraftSchema } from "@/lib/validation";
import { addDays, businessToday, toDateOnlyString } from "@/lib/dates";

let w: World;
beforeEach(async () => {
  w = await buildWorld();
});

const day = (offset: number) => toDateOnlyString(addDays(businessToday(), offset))!;

describe("instrument submission and review", () => {
  it("1. an institution user can draft, document and submit an instrument", async () => {
    const d = await createDraft(w.instA, draftInput());
    expect(d.status).toBe("DRAFT");
    await uploadDocument(w.instA, { instrumentId: d.id, docType: "FDR_RECEIPT" }, pdfFile());
    const s = await transitionInstrument(w.instA, d.id, { action: "SUBMIT" });
    expect(s.status).toBe("PENDING_SCRUTINY");
    expect(s.submittedAt).not.toBeNull();
    expect(s.verificationStatus).toBe("NOT_REVIEWED"); // submission is not verification
  });

  it("2. required-field validation rejects incomplete submissions", async () => {
    const d = await createDraft(w.instA, { type: "FDR", instrumentNumber: "X1", amount: "1000.00" });
    await expect(transitionInstrument(w.instA, d.id, { action: "SUBMIT" })).rejects.toThrow(ValidationError);
    expect((await prisma.instrument.findUniqueOrThrow({ where: { id: d.id } })).status).toBe("DRAFT");
    // Malformed values are rejected at the schema boundary.
    expect(instrumentDraftSchema.safeParse({ type: "FDR", amount: "-5" }).success).toBe(false);
    expect(instrumentDraftSchema.safeParse({ type: "FDR", amount: "12.345" }).success).toBe(false);
    expect(instrumentDraftSchema.safeParse({ type: "FDR", maturityDate: "2026-02-30" }).success).toBe(false);
    // Maturity must follow issue.
    const bad = await createDraft(w.instA, draftInput({ issueDate: day(10), maturityDate: day(5) }));
    await expect(transitionInstrument(w.instA, bad.id, { action: "SUBMIT" })).rejects.toThrow(/maturity date must be after/i);
  });

  it("3. a submitted instrument appears in the correct regional review queue only", async () => {
    const s = await submitted(w.instA);
    const north = await searchInstruments(w.officerNorth, { status: "PENDING_SCRUTINY" }, { skip: 0, take: 50 });
    const south = await searchInstruments(w.officerSouth, { status: "PENDING_SCRUTINY" }, { skip: 0, take: 50 });
    expect(north.rows.map((r) => r.id)).toContain(s.id);
    expect(south.rows.map((r) => r.id)).not.toContain(s.id);
    // Drafts are never visible to officers.
    const draft = await createDraft(w.instA, draftInput());
    await expect(getInstrumentDetail(w.officerNorth, draft.id)).rejects.toThrow(NotFoundError);
  });

  it("4. an officer can inspect the record and record observations", async () => {
    const s = await submitted(w.instA);
    await transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" });
    await recordVerification(w.officerNorth, s.id, { method: "MANUAL_DOCUMENT_REVIEW", result: "PENDING", observations: "Receipt legible; awaiting bank letter." });
    const detail = await getInstrumentDetail(w.officerNorth, s.id);
    expect(detail.status).toBe("UNDER_REVIEW");
    expect(detail.verifications.some((v) => v.method === "MANUAL_DOCUMENT_REVIEW" && v.observations?.includes("awaiting bank letter"))).toBe(true);
  });

  it("5. users without the officer role cannot perform officer-only actions", async () => {
    const s = await submitted(w.instA);
    await expect(transitionInstrument(w.instA, s.id, { action: "START_REVIEW" })).rejects.toThrow(ForbiddenError);
    await expect(transitionInstrument(w.auditor, s.id, { action: "START_REVIEW" })).rejects.toThrow(ForbiddenError);
    await expect(transitionInstrument(w.authority, s.id, { action: "START_REVIEW" })).rejects.toThrow(ForbiddenError);
    await expect(recordVerification(w.instA, s.id, { method: "MANUAL_DOCUMENT_REVIEW", result: "CONFIRMED", observations: "self-approval" })).rejects.toThrow(ForbiddenError);
    // Officers from another region cannot act either (scope, reported as not found).
    await expect(transitionInstrument(w.officerSouth, s.id, { action: "START_REVIEW" })).rejects.toThrow(NotFoundError);
  });

  it("6. an institution cannot access another institution's records by identifier", async () => {
    const s = await submitted(w.instA);
    await expect(getInstrumentDetail(w.instB, s.id)).rejects.toThrow(NotFoundError);
    await expect(transitionInstrument(w.instB, s.id, { action: "WITHDRAW", note: "hijack" })).rejects.toThrow(NotFoundError);
    await expect(uploadDocument(w.instB, { instrumentId: s.id, docType: "OTHER" }, pdfFile())).rejects.toThrow(NotFoundError);
    const list = await searchInstruments(w.instB, {}, { skip: 0, take: 100 });
    expect(list.rows.every((r) => r.institutionId === w.institutionB)).toBe(true);
    await expect(getInstrumentDetail(w.instB, "not-a-uuid")).rejects.toThrow(NotFoundError);
  });

  it("7. missing documents produce an actionable discrepancy that closes only after a recorded upload", async () => {
    const d = await createDraft(w.instA, draftInput());
    await transitionInstrument(w.instA, d.id, { action: "SUBMIT" });
    const open = await prisma.discrepancy.findMany({ where: { instrumentId: d.id, status: "OPEN" } });
    expect(open.map((x) => x.code)).toContain("MISSING_PRIMARY_DOCUMENT");
    expect(open.find((x) => x.code === "MISSING_PRIMARY_DOCUMENT")?.severity).toBe("BLOCKING");
    // Cannot be waived away by an officer.
    const disc = open.find((x) => x.code === "MISSING_PRIMARY_DOCUMENT")!;
    await expect(resolveDiscrepancy(w.officerNorth, disc.id, { outcome: "WAIVED", note: "ignore it" })).rejects.toThrow(InvalidTransitionError);
    await uploadDocument(w.instA, { instrumentId: d.id, docType: "FDR_RECEIPT" }, pdfFile());
    const after = await prisma.discrepancy.findUniqueOrThrow({ where: { id: disc.id } });
    expect(after.status).toBe("RESOLVED");
    expect(after.resolutionNote).toMatch(/document upload/);
  });

  it("4b/invariant 4. an officer discrepancy blocks acceptance until resolved with a reason", async () => {
    const s = await submitted(w.instA);
    await transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" });
    const d = await raiseDiscrepancy(w.officerNorth, s.id, { severity: "BLOCKING", message: "Amount on receipt differs" });
    const letter = await uploadDocument(w.officerNorth, { instrumentId: s.id, docType: "BANK_VERIFICATION_LETTER" }, pdfFile("l.pdf"));
    await expect(
      recordVerification(w.officerNorth, s.id, { method: "BANK_CONFIRMATION_LETTER", result: "CONFIRMED", evidenceReference: "R1", evidenceDocumentId: letter.id, observations: "ok" }),
    ).rejects.toThrow(/blocking discrepancy/);
    await resolveDiscrepancy(w.officerNorth, d.id, { outcome: "RESOLVED", note: "Bank confirmed amount by phone and letter" });
    await recordVerification(w.officerNorth, s.id, { method: "BANK_CONFIRMATION_LETTER", result: "CONFIRMED", evidenceReference: "R1", evidenceDocumentId: letter.id, observations: "ok" });
    expect((await prisma.instrument.findUniqueOrThrow({ where: { id: s.id } })).status).toBe("VERIFIED");
  });
});

describe("verification integrity", () => {
  it("manual review cannot confirm when independent confirmation is required; simulated results never confirm", async () => {
    const s = await submitted(w.instA);
    await transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" });
    await expect(recordVerification(w.officerNorth, s.id, { method: "MANUAL_DOCUMENT_REVIEW", result: "CONFIRMED", observations: "looks fine" })).rejects.toThrow(/independent confirmation/);
    const rec = await runExternalVerification(w.officerNorth, s.id);
    expect(rec.isSimulated).toBe(true);
    expect(rec.independentlyConfirmed).toBe(false);
    expect(rec.result).toBe("PENDING");
    expect(rec.observations).toMatch(/SIMULATED/);
    const inst = await prisma.instrument.findUniqueOrThrow({ where: { id: s.id } });
    expect(inst.verificationStatus).not.toBe("CONFIRMED");
    expect(inst.status).toBe("UNDER_REVIEW");
  });
});

describe("maturity monitoring", () => {
  it("8–9. generates the correct threshold reminder once, and re-runs do not duplicate", async () => {
    const a = await accepted(w.instA, w.officerNorth, { issueDate: day(-300), maturityDate: day(25) });
    const b = await accepted(w.instA, w.officerNorth, { issueDate: day(-300), maturityDate: day(45) });
    await accepted(w.instA, w.officerNorth, { issueDate: day(-300), maturityDate: day(200) });
    await runMonitor({ trigger: "TEST" });
    const reminders = await prisma.notification.findMany({ where: { type: "MATURITY_UPCOMING" } });
    expect(reminders.filter((n) => n.instrumentId === a.id).map((n) => n.dedupeKey)).toEqual([expect.stringContaining(":T-30:")]);
    expect(reminders.filter((n) => n.instrumentId === b.id).map((n) => n.dedupeKey)).toEqual([expect.stringContaining(":T-60:")]);
    expect(reminders).toHaveLength(2); // the 200-day instrument is outside every window
    await runMonitor({ trigger: "TEST" });
    await runMonitor({ trigger: "TEST" });
    expect(await prisma.notification.count({ where: { type: "MATURITY_UPCOMING" } })).toBe(2);
  });

  it("escalates matured, unactioned instruments and skips those already being renewed", async () => {
    const m = await accepted(w.instA, w.officerNorth, { issueDate: day(-400), maturityDate: day(30) });
    const r = await accepted(w.instA, w.officerNorth, { issueDate: day(-400), maturityDate: day(30) });
    await startRenewal(w.instA, r.id, { ...draftInput({ maturityDate: day(400) }), kind: "RENEWAL", reason: "renewing" });
    // 70 days later both matured 40 days ago (past both escalation thresholds, 7 and 30 days);
    // only the unactioned one escalates.
    setClock(new Date(addDays(businessToday(), 70).getTime() + 6 * 3600_000));
    await runMonitor({ trigger: "TEST" });
    setClock(null);
    const esc = await prisma.notification.findMany({ where: { type: { in: ["OVERDUE_ACTION", "ESCALATION", "MATURITY_REACHED"] }, instrumentId: { in: [m.id, r.id] } } });
    expect(esc.some((n) => n.instrumentId === m.id && n.type === "ESCALATION")).toBe(true); // level 2 → authorities
    expect(esc.some((n) => n.instrumentId === m.id && n.type === "MATURITY_REACHED")).toBe(true);
    expect(esc.some((n) => n.instrumentId === r.id)).toBe(false);
    expect(esc.filter((n) => n.type === "ESCALATION").every((n) => n.recipientId === w.authority.id)).toBe(true);
  });

  it("respects changed maturity dates (new date → new reminder key)", async () => {
    const s = await submitted(w.instA, { issueDate: day(-300), maturityDate: day(20) });
    // simulate a correction cycle that changes the date
    await transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" });
    await transitionInstrument(w.officerNorth, s.id, { action: "REQUEST_CORRECTION", note: "wrong date" });
    const cur = await prisma.instrument.findUniqueOrThrow({ where: { id: s.id } });
    await updateInstrumentFields(w.instA, s.id, { maturityDate: day(50) }, cur.version);
    const changed = await prisma.instrument.findUniqueOrThrow({ where: { id: s.id } });
    expect(toDateOnlyString(changed.maturityDate)).toBe(day(50));
  });
});

describe("renewal and replacement", () => {
  it("10. renewal creates a linked record and preserves the original's history", async () => {
    const orig = await accepted(w.instA, w.officerNorth, { issueDate: day(-350), maturityDate: day(15), amount: "750000.00" });
    const before = await prisma.instrument.findUniqueOrThrow({ where: { id: orig.id } });
    const { instrument: renewed, renewal } = await startRenewal(w.instA, orig.id, { ...draftInput({ maturityDate: day(380), amount: "800000.00" }), kind: "RENEWAL", reason: "Annual renewal" });
    expect(renewed.replacesInstrumentId).toBe(orig.id);
    expect(renewal.status).toBe("IN_PROGRESS");
    // A second concurrent renewal is refused.
    await expect(startRenewal(w.instA, orig.id, { ...draftInput(), kind: "RENEWAL", reason: "again" })).rejects.toThrow(ConflictError);
    await uploadDocument(w.instA, { instrumentId: renewed.id, docType: "FDR_RECEIPT" }, pdfFile());
    await transitionInstrument(w.instA, renewed.id, { action: "SUBMIT" });
    await transitionInstrument(w.officerNorth, renewed.id, { action: "START_REVIEW" });
    const letter = await uploadDocument(w.officerNorth, { instrumentId: renewed.id, docType: "BANK_VERIFICATION_LETTER" }, pdfFile("l.pdf"));
    await recordVerification(w.officerNorth, renewed.id, { method: "BANK_CONFIRMATION_LETTER", result: "CONFIRMED", evidenceReference: "R", evidenceDocumentId: letter.id, observations: "ok" });
    await transitionInstrument(w.officerNorth, renewed.id, { action: "ACCEPT" });
    const after = await prisma.instrument.findUniqueOrThrow({ where: { id: orig.id } });
    expect(after.status).toBe("REPLACED");
    for (const k of ["instrumentNumber", "bankName", "branchName", "issueDate", "maturityDate", "amount"] as const) {
      expect(String(after[k])).toBe(String(before[k]));
    }
    expect(await prisma.document.count({ where: { instrumentId: orig.id } })).toBe(await prisma.document.count({ where: { instrumentId: orig.id, isCurrent: true } }) + 0);
    expect((await prisma.renewalCase.findUniqueOrThrow({ where: { id: renewal.id } })).status).toBe("APPROVED");
    // An expired instrument does not silently become valid: the original stays REPLACED, not ACCEPTED.
    await expect(transitionInstrument(w.officerNorth, orig.id, { action: "ACCEPT" })).rejects.toThrow(InvalidTransitionError);
  });
});

describe("state transitions", () => {
  it("11. invalid transitions are rejected by the backend", async () => {
    const s = await submitted(w.instA);
    await expect(transitionInstrument(w.officerNorth, s.id, { action: "ACCEPT" })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionInstrument(w.instA, s.id, { action: "SUBMIT" })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionInstrument(w.officerNorth, s.id, { action: "REJECT" })).rejects.toThrow(ValidationError); // reason required
    // Editing a submitted record is not allowed.
    await expect(updateInstrumentFields(w.instA, s.id, { amount: "1.00" }, s.version)).rejects.toThrow(InvalidTransitionError);
  });

  it("detects stale versions and concurrent double-processing", async () => {
    const s = await submitted(w.instA);
    await expect(transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW", expectedVersion: s.version - 1 })).rejects.toThrow(ConflictError);
    const results = await Promise.allSettled([
      transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" }),
      transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.auditEvent.count({ where: { resourceId: s.id, action: "INSTRUMENT_START_REVIEW" } })).toBe(1);
  });

  it("a matured instrument cannot be accepted as current security", async () => {
    const s = await submitted(w.instA, { issueDate: day(-400), maturityDate: day(-1) });
    await transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" });
    await prisma.discrepancy.updateMany({ where: { instrumentId: s.id, code: "ALREADY_MATURED" }, data: { status: "WAIVED" } });
    const letter = await uploadDocument(w.officerNorth, { instrumentId: s.id, docType: "BANK_VERIFICATION_LETTER" }, pdfFile("l.pdf"));
    await recordVerification(w.officerNorth, s.id, { method: "BANK_CONFIRMATION_LETTER", result: "CONFIRMED", evidenceReference: "R", evidenceDocumentId: letter.id, observations: "ok" });
    await expect(transitionInstrument(w.officerNorth, s.id, { action: "ACCEPT" })).rejects.toThrow(/matured instrument cannot be accepted/);
  });
});

describe("release / refund workflow", () => {
  async function openRequest() {
    const inst = await accepted(w.instA, w.officerNorth, { issueDate: day(-400), maturityDate: day(10) });
    const rr = await createReleaseRequest(w.instA, { instrumentId: inst.id, type: "REFUND", requestedAmount: "500000.00", reason: "Programme closed; refund requested." }, [pdfFile("letter.pdf")]);
    return { inst, rr };
  }

  it("requires supporting documents and rejects duplicates", async () => {
    const inst = await accepted(w.instA, w.officerNorth);
    await expect(createReleaseRequest(w.instA, { instrumentId: inst.id, type: "RELEASE", requestedAmount: "100.00", reason: "No documents attached here" }, [])).rejects.toThrow(ValidationError);
    await expect(createReleaseRequest(w.instA, { instrumentId: inst.id, type: "RELEASE", requestedAmount: "9999999.00", reason: "Too much money requested" }, [pdfFile()])).rejects.toThrow(/exceed/);
    await createReleaseRequest(w.instA, { instrumentId: inst.id, type: "RELEASE", requestedAmount: "100.00", reason: "Valid request with doc" }, [pdfFile()]);
    await expect(createReleaseRequest(w.instA, { instrumentId: inst.id, type: "RELEASE", requestedAmount: "100.00", reason: "Duplicate request now" }, [pdfFile()])).rejects.toThrow(ConflictError);
    await expect(createReleaseRequest(w.instB, { instrumentId: inst.id, type: "RELEASE", requestedAmount: "100.00", reason: "Other institution try" }, [pdfFile()])).rejects.toThrow(NotFoundError);
  });

  it("12. cannot bypass the scrutiny → authority authorisation path", async () => {
    const { rr } = await openRequest();
    await expect(transitionRelease(w.authority, rr.id, { action: "APPROVE", note: "skip scrutiny" })).rejects.toThrow(InvalidTransitionError);
    await expect(transitionRelease(w.officerNorth, rr.id, { action: "APPROVE", note: "officer approving" })).rejects.toThrow(ForbiddenError);
    await expect(transitionRelease(w.instA, rr.id, { action: "FORWARD", note: "self forward" })).rejects.toThrow(ForbiddenError);
    await transitionRelease(w.officerNorth, rr.id, { action: "START_SCRUTINY" });
    await expect(transitionRelease(w.officerNorth, rr.id, { action: "FORWARD" })).rejects.toThrow(ValidationError); // observations required
    await transitionRelease(w.officerNorth, rr.id, { action: "FORWARD", note: "Scrutiny complete" });
    await expect(transitionRelease(w.officerNorth, rr.id, { action: "APPROVE", note: "x" })).rejects.toThrow(ForbiddenError);
    await expect(transitionRelease(w.auditor, rr.id, { action: "APPROVE", note: "x" })).rejects.toThrow(ForbiddenError);
    const approved = await transitionRelease(w.authority, rr.id, { action: "APPROVE", note: "Approved" });
    expect(approved.status).toBe("APPROVED"); // approved is NOT completed
    expect(approved.completedAt).toBeNull();
  });

  it("13. rejected requests retain decision, reason and actor", async () => {
    const { rr } = await openRequest();
    await transitionRelease(w.officerNorth, rr.id, { action: "START_SCRUTINY" });
    await transitionRelease(w.officerNorth, rr.id, { action: "FORWARD", note: "Forwarded" });
    await transitionRelease(w.authority, rr.id, { action: "REJECT", note: "Grounds insufficient" });
    const r = await prisma.releaseRequest.findUniqueOrThrow({ where: { id: rr.id } });
    expect([r.status, r.decision, r.decisionReason, r.decidedById]).toEqual(["REJECTED", "REJECTED", "Grounds insufficient", w.authority.id]);
    await expect(transitionRelease(w.authority, rr.id, { action: "APPROVE", note: "changed my mind" })).rejects.toThrow(InvalidTransitionError);
  });

  it("14. completion requires approval, a reference and uploaded evidence", async () => {
    const { inst, rr } = await openRequest();
    await transitionRelease(w.officerNorth, rr.id, { action: "START_SCRUTINY" });
    await transitionRelease(w.officerNorth, rr.id, { action: "FORWARD", note: "ok" });
    await transitionRelease(w.authority, rr.id, { action: "APPROVE", note: "ok" });
    await expect(transitionRelease(w.officerNorth, rr.id, { action: "COMPLETE", completionReference: "DISCH-1" })).rejects.toThrow(/completion evidence/);
    await uploadDocument(w.officerNorth, { releaseRequestId: rr.id, docType: "RELEASE_COMPLETION_EVIDENCE" }, pdfFile("advice.pdf"));
    await expect(transitionRelease(w.officerNorth, rr.id, { action: "COMPLETE" })).rejects.toThrow(ValidationError);
    const done = await transitionRelease(w.officerNorth, rr.id, { action: "COMPLETE", completionReference: "DISCH-1" });
    expect(done.status).toBe("COMPLETED");
    expect((await prisma.instrument.findUniqueOrThrow({ where: { id: inst.id } })).status).toBe("RELEASED");
  });
});

describe("audit, reporting and documents", () => {
  it("15. material changes create append-only audit events", async () => {
    const s = await submitted(w.instA);
    await transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" });
    const actions = (await prisma.auditEvent.findMany({ where: { resourceId: s.id }, orderBy: { id: "asc" } })).map((e) => e.action);
    expect(actions).toEqual(expect.arrayContaining(["INSTRUMENT_DRAFT_CREATED", "DOCUMENT_UPLOADED", "INSTRUMENT_SUBMIT", "INSTRUMENT_START_REVIEW"]));
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { resourceId: s.id } });
    await expect(prisma.auditEvent.update({ where: { id: ev.id }, data: { action: "TAMPERED" } })).rejects.toThrow(/append-only/);
    await expect(prisma.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });

  it("16. search, pagination, dashboard and reports agree within the authorised scope", async () => {
    for (let i = 0; i < 3; i++) await accepted(w.instA, w.officerNorth, { amount: `${(i + 1) * 100000}.00` });
    await accepted(w.instB, w.officerSouth, { amount: "999999.00" });
    const page1 = await searchInstruments(w.officerNorth, { view: "active", sort: "amount", dir: "asc" }, { skip: 0, take: 2 });
    const page2 = await searchInstruments(w.officerNorth, { view: "active", sort: "amount", dir: "asc" }, { skip: 2, take: 2 });
    expect(page1.total).toBe(3);
    expect([...page1.rows, ...page2.rows].map((r) => r.amount?.toString())).toEqual(["100000", "200000", "300000"]);
    expect(page1.totalAmount?.toString()).toBe("600000");
    const dash = await getDashboard(w.officerNorth);
    expect(dash.metrics.activeCount).toBe(3);
    expect(dash.metrics.activeValue?.toString()).toBe("600000");
    const { csv } = await generateReport(w.officerNorth, "instrument-register", { view: "active" });
    expect(csv).toContain("Total amount (INR),600000.00");
    expect(csv).not.toContain("999999");
    expect(await prisma.auditEvent.count({ where: { action: "REPORT_EXPORTED" } })).toBe(1);
    await expect(generateReport(w.officerNorth, "audit-log", {})).rejects.toThrow(ForbiddenError);
    await expect(generateReport(w.admin, "instrument-register", {})).rejects.toThrow(ForbiddenError);
    const institutionView = await getDashboard(w.instB);
    expect(institutionView.metrics.activeValue?.toString()).toBe("999999");
  });

  it("17. protected documents cannot be downloaded without permission", async () => {
    const s = await submitted(w.instA);
    const doc = await prisma.document.findFirstOrThrow({ where: { instrumentId: s.id } });
    expect((await downloadDocument(w.instA, doc.id)).buffer.subarray(0, 5).toString()).toBe("%PDF-");
    expect((await downloadDocument(w.officerNorth, doc.id)).doc.id).toBe(doc.id);
    await expect(authoriseDownload(w.instB, doc.id)).rejects.toThrow(NotFoundError);
    await expect(authoriseDownload(w.officerSouth, doc.id)).rejects.toThrow(NotFoundError);
    await expect(authoriseDownload(w.auditor, doc.id)).rejects.toThrow(ForbiddenError); // metadata only
    await expect(authoriseDownload(w.admin, doc.id)).rejects.toThrow(ForbiddenError);
    // Bank letters are Bureau working papers.
    await transitionInstrument(w.officerNorth, s.id, { action: "START_REVIEW" });
    const letter = await uploadDocument(w.officerNorth, { instrumentId: s.id, docType: "BANK_VERIFICATION_LETTER" }, pdfFile("l.pdf"));
    await expect(authoriseDownload(w.instA, letter.id)).rejects.toThrow(NotFoundError);
    expect(await prisma.auditEvent.count({ where: { action: "DOCUMENT_DOWNLOADED" } })).toBe(2);
  });

  it("rejects invalid uploads without leaving stored files or records", async () => {
    const d = await createDraft(w.instA, draftInput());
    await expect(uploadDocument(w.instA, { instrumentId: d.id, docType: "FDR_RECEIPT" }, { name: "evil.pdf", buffer: Buffer.from("MZ not a pdf") })).rejects.toThrow(ValidationError);
    await expect(uploadDocument(w.instA, { instrumentId: d.id, docType: "BANK_VERIFICATION_LETTER" }, pdfFile())).rejects.toThrow(ForbiddenError);
    expect(await prisma.document.count({ where: { instrumentId: d.id } })).toBe(0);
  });

  it("supports document versioning without losing earlier versions", async () => {
    const d = await createDraft(w.instA, draftInput());
    const v1 = await uploadDocument(w.instA, { instrumentId: d.id, docType: "FDR_RECEIPT" }, pdfFile("v1.pdf"));
    const v2 = await uploadDocument(w.instA, { instrumentId: d.id, docType: "FDR_RECEIPT" }, pdfFile("v2.pdf"));
    expect(v2.version).toBe(2);
    expect(v2.supersedesId).toBe(v1.id);
    expect((await prisma.document.findUniqueOrThrow({ where: { id: v1.id } })).isCurrent).toBe(false);
  });

  it("idempotent create: retrying with the same client request id returns the same draft", async () => {
    const id = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
    const a = await createDraft(w.instA, { ...draftInput(), clientRequestId: id });
    const b = await createDraft(w.instA, { ...draftInput(), clientRequestId: id });
    expect(a.id).toBe(b.id);
  });
});

describe("listing scope for release requests", () => {
  it("officers see only their regions; institutions only their own", async () => {
    const inst = await accepted(w.instA, w.officerNorth);
    await createReleaseRequest(w.instA, { instrumentId: inst.id, type: "RELEASE", requestedAmount: "1.00", reason: "Some valid reason" }, [pdfFile()]);
    expect((await listReleaseRequests(w.officerNorth, {}, { skip: 0, take: 10 })).total).toBe(1);
    expect((await listReleaseRequests(w.officerSouth, {}, { skip: 0, take: 10 })).total).toBe(0);
    expect((await listReleaseRequests(w.instB, {}, { skip: 0, take: 10 })).total).toBe(0);
    await expect(listReleaseRequests(w.admin, {}, { skip: 0, take: 10 })).rejects.toThrow(ForbiddenError);
  });
});
