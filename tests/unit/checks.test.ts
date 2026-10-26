import { describe, expect, it } from "vitest";
import { runInstrumentChecks, runReleaseChecks, type CheckInput } from "@/server/checks/consistency";
import { parseDateOnly } from "@/lib/dates";

const today = parseDateOnly("2026-10-26")!;
const base = (over: Partial<CheckInput["instrument"]> = {}, rest: Partial<CheckInput> = {}): CheckInput => ({
  instrument: {
    id: "i1", type: "FDR", instrumentNumber: "FD123", bankName: "Demo National Bank", branchName: "Main", ifscCode: "XDNB0123456",
    amount: "100000.00", issueDate: parseDateOnly("2026-01-01"), maturityDate: parseDateOnly("2027-01-01"), institutionId: "A", replacesInstrumentId: null, ...over,
  },
  documentTypes: ["FDR_RECEIPT"],
  duplicateReferences: [],
  knownBankNames: ["Demo National Bank"],
  today,
  ...rest,
});
const codes = (i: CheckInput) => runInstrumentChecks(i).map((f) => f.code).sort();

describe("automated consistency checks", () => {
  it("passes a complete, consistent record", () => {
    expect(codes(base())).toEqual([]);
  });
  it("flags missing mandatory fields as blocking", () => {
    const f = runInstrumentChecks(base({ instrumentNumber: null, bankName: "", issueDate: null, maturityDate: null, amount: null }));
    expect(f.filter((x) => x.severity === "BLOCKING").map((x) => x.code).sort()).toEqual(
      ["INVALID_AMOUNT", "MISSING_BANK", "MISSING_INSTRUMENT_NUMBER", "MISSING_ISSUE_DATE", "MISSING_MATURITY_DATE"].sort(),
    );
  });
  it("flags maturity before issue and future issue dates", () => {
    expect(codes(base({ issueDate: parseDateOnly("2026-12-01"), maturityDate: parseDateOnly("2026-11-01") }))).toEqual(
      expect.arrayContaining(["INVALID_DATE_ORDER", "ISSUE_DATE_IN_FUTURE"]),
    );
  });
  it("flags missing mandatory documents", () => {
    expect(codes(base({}, { documentTypes: [] }))).toContain("MISSING_PRIMARY_DOCUMENT");
    expect(codes(base({ type: "SECURITY_DEPOSIT" }, { documentTypes: ["DEPOSIT_CONFIRMATION"] }))).not.toContain("MISSING_PRIMARY_DOCUMENT");
  });
  it("treats duplicates and unknown banks as warnings (review aids)", () => {
    const f = runInstrumentChecks(base({ bankName: "Unlisted Bank" }, { duplicateReferences: [{ referenceNo: "SDP-1", sameInstitution: false }] }));
    expect(f.find((x) => x.code === "DUPLICATE_REFERENCE")?.severity).toBe("WARNING");
    expect(f.find((x) => x.code === "UNKNOWN_BANK")?.severity).toBe("WARNING");
  });
  it("validates renewal linkage and extension", () => {
    const original = { institutionId: "A", status: "ACCEPTED", instrumentNumber: "FD123", bankName: "Demo National Bank", amount: "200000.00", maturityDate: parseDateOnly("2027-06-01") };
    const f = codes(base({ replacesInstrumentId: "o1" }, { original }));
    expect(f).toEqual(expect.arrayContaining(["RENEWAL_SAME_REFERENCE", "RENEWAL_MATURITY_NOT_EXTENDED", "RENEWAL_AMOUNT_LOWER"]));
    expect(codes(base({ replacesInstrumentId: "o1" }, { original: { ...original, institutionId: "B" } }))).toContain("RENEWAL_LINK_INVALID");
    expect(codes(base({ replacesInstrumentId: "o1" }, { original: null }))).toContain("RENEWAL_LINK_INVALID");
  });
  it("release checks require supporting evidence", () => {
    const f = runReleaseChecks({ supportingDocumentCount: 0, instrumentStatus: "ACCEPTED", maturityDate: parseDateOnly("2027-01-01"), requestedAmount: "5", instrumentAmount: "4", today });
    expect(f.map((x) => x.code).sort()).toEqual(["RELEASE_AMOUNT_EXCEEDS", "RELEASE_BEFORE_MATURITY", "RELEASE_MISSING_SUPPORTING_DOCUMENT"]);
  });
});
