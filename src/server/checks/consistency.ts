// Automated consistency checks. These are REVIEW AIDS: they flag missing or inconsistent
// institution-submitted data for an officer to examine. A duplicate reference, for example, is not
// proof of fraud, and passing every check is not verification.
import { daysBetween } from "@/lib/dates";
import { IFSC_PATTERN } from "@/lib/validation";

export type Severity = "BLOCKING" | "WARNING";

export interface Finding {
  code: string;
  severity: Severity;
  field?: string;
  message: string;
}

export interface CheckInput {
  instrument: {
    id: string;
    type: "FDR" | "SECURITY_DEPOSIT";
    instrumentNumber: string | null;
    bankName: string | null;
    branchName: string | null;
    ifscCode: string | null;
    amount: { toString(): string } | null;
    issueDate: Date | null;
    maturityDate: Date | null;
    institutionId: string;
    replacesInstrumentId: string | null;
  };
  /** Current (latest-version), non-rejected documents attached to the instrument. */
  documentTypes: string[];
  /** Other non-draft, non-withdrawn instruments with the same bank + instrument number. */
  duplicateReferences: { referenceNo: string; sameInstitution: boolean }[];
  /** Original instrument when this record is a renewal / replacement. */
  original?: {
    institutionId: string;
    status: string;
    instrumentNumber: string | null;
    bankName: string | null;
    amount: { toString(): string } | null;
    maturityDate: Date | null;
  } | null;
  knownBankNames: string[];
  today: Date;
}

const PRIMARY_DOCS: Record<string, string[]> = {
  FDR: ["FDR_RECEIPT"],
  SECURITY_DEPOSIT: ["DEPOSIT_CONFIRMATION", "FDR_RECEIPT"],
};

export const CHECK_DESCRIPTIONS: Record<string, string> = {
  MISSING_INSTRUMENT_NUMBER: "Instrument / receipt number is missing",
  MISSING_BANK: "Issuing bank is missing",
  MISSING_BRANCH: "Branch is missing",
  MISSING_ISSUE_DATE: "Issue date is missing",
  MISSING_MATURITY_DATE: "Maturity date is missing",
  INVALID_DATE_ORDER: "Maturity date is not after the issue date",
  ISSUE_DATE_IN_FUTURE: "Issue date is in the future",
  INVALID_AMOUNT: "Deposit amount is missing or not positive",
  INVALID_IFSC: "IFSC code format is invalid",
  UNKNOWN_BANK: "Bank is not in the reference list",
  MISSING_PRIMARY_DOCUMENT: "Mandatory receipt / confirmation document is missing",
  DUPLICATE_REFERENCE: "Same bank and instrument number found on another record",
  ALREADY_MATURED: "Instrument had already matured when submitted",
  RENEWAL_LINK_INVALID: "Renewal is not linked to a valid accepted original",
  RENEWAL_SAME_REFERENCE: "Renewal carries the same instrument number as the original",
  RENEWAL_MATURITY_NOT_EXTENDED: "Renewal does not extend the original maturity date",
  RENEWAL_AMOUNT_LOWER: "Renewal amount is lower than the original",
};

export function normaliseRef(v: string | null | undefined): string {
  return (v ?? "").replace(/[\s\-/]/g, "").toUpperCase();
}

export function normaliseBank(v: string | null | undefined): string {
  return (v ?? "").replace(/\s+/g, " ").trim().toUpperCase();
}

export function runInstrumentChecks(input: CheckInput): Finding[] {
  const { instrument: i, today } = input;
  const f: Finding[] = [];
  const add = (code: string, severity: Severity, field?: string, detail?: string) =>
    f.push({ code, severity, field, message: detail ? `${CHECK_DESCRIPTIONS[code]}: ${detail}` : CHECK_DESCRIPTIONS[code] });

  if (!i.instrumentNumber?.trim()) add("MISSING_INSTRUMENT_NUMBER", "BLOCKING", "instrumentNumber");
  if (!i.bankName?.trim()) add("MISSING_BANK", "BLOCKING", "bankName");
  if (!i.branchName?.trim()) add("MISSING_BRANCH", "WARNING", "branchName");
  if (!i.issueDate) add("MISSING_ISSUE_DATE", "BLOCKING", "issueDate");
  if (!i.maturityDate) add("MISSING_MATURITY_DATE", "BLOCKING", "maturityDate");
  if (i.issueDate && i.maturityDate && i.maturityDate.getTime() <= i.issueDate.getTime()) {
    add("INVALID_DATE_ORDER", "BLOCKING", "maturityDate");
  }
  if (i.issueDate && i.issueDate.getTime() > today.getTime()) add("ISSUE_DATE_IN_FUTURE", "WARNING", "issueDate");
  if (!i.amount || !(Number(i.amount.toString()) > 0)) add("INVALID_AMOUNT", "BLOCKING", "amount");
  if (i.ifscCode && !IFSC_PATTERN.test(i.ifscCode)) add("INVALID_IFSC", "WARNING", "ifscCode");
  if (i.bankName?.trim()) {
    const known = new Set(input.knownBankNames.map(normaliseBank));
    if (!known.has(normaliseBank(i.bankName))) add("UNKNOWN_BANK", "WARNING", "bankName", `"${i.bankName}"`);
  }

  const primary = PRIMARY_DOCS[i.type] ?? [];
  if (!input.documentTypes.some((t) => primary.includes(t))) {
    add("MISSING_PRIMARY_DOCUMENT", "BLOCKING", "documents");
  }

  if (input.duplicateReferences.length > 0) {
    const refs = input.duplicateReferences.map((d) => d.referenceNo).join(", ");
    add("DUPLICATE_REFERENCE", "WARNING", "instrumentNumber", `see ${refs}`);
  }

  if (i.maturityDate && daysBetween(today, i.maturityDate) <= 0) add("ALREADY_MATURED", "WARNING", "maturityDate");

  if (i.replacesInstrumentId) {
    const o = input.original;
    if (!o || o.institutionId !== i.institutionId || !["ACCEPTED", "REPLACED"].includes(o.status)) {
      add("RENEWAL_LINK_INVALID", "BLOCKING");
    } else {
      if (
        normaliseRef(o.instrumentNumber) !== "" &&
        normaliseRef(o.instrumentNumber) === normaliseRef(i.instrumentNumber) &&
        normaliseBank(o.bankName) === normaliseBank(i.bankName)
      ) {
        add("RENEWAL_SAME_REFERENCE", "WARNING", "instrumentNumber", "confirm the bank renewed under the same number");
      }
      if (o.maturityDate && i.maturityDate && i.maturityDate.getTime() <= o.maturityDate.getTime()) {
        add("RENEWAL_MATURITY_NOT_EXTENDED", "BLOCKING", "maturityDate");
      }
      if (o.amount && i.amount && Number(i.amount.toString()) < Number(o.amount.toString())) {
        add("RENEWAL_AMOUNT_LOWER", "WARNING", "amount");
      }
    }
  }
  return f;
}

// ---------------------------------------------------------------- release requests

export interface ReleaseCheckInput {
  supportingDocumentCount: number;
  instrumentStatus: string;
  maturityDate: Date | null;
  requestedAmount: { toString(): string };
  instrumentAmount: { toString(): string } | null;
  today: Date;
}

export const RELEASE_CHECK_DESCRIPTIONS: Record<string, string> = {
  RELEASE_MISSING_SUPPORTING_DOCUMENT: "No supporting document attached to the release/refund request",
  RELEASE_BEFORE_MATURITY: "Instrument is still held and has not matured — grounds for early release must be examined",
  RELEASE_AMOUNT_EXCEEDS: "Requested amount exceeds the recorded instrument amount",
};

export function runReleaseChecks(input: ReleaseCheckInput): Finding[] {
  const f: Finding[] = [];
  if (input.supportingDocumentCount === 0) {
    f.push({ code: "RELEASE_MISSING_SUPPORTING_DOCUMENT", severity: "BLOCKING", message: RELEASE_CHECK_DESCRIPTIONS.RELEASE_MISSING_SUPPORTING_DOCUMENT });
  }
  if (input.instrumentStatus === "ACCEPTED" && input.maturityDate && daysBetween(input.today, input.maturityDate) > 0) {
    f.push({ code: "RELEASE_BEFORE_MATURITY", severity: "WARNING", message: RELEASE_CHECK_DESCRIPTIONS.RELEASE_BEFORE_MATURITY });
  }
  if (input.instrumentAmount && Number(input.requestedAmount.toString()) > Number(input.instrumentAmount.toString())) {
    f.push({ code: "RELEASE_AMOUNT_EXCEEDS", severity: "BLOCKING", message: RELEASE_CHECK_DESCRIPTIONS.RELEASE_AMOUNT_EXCEEDS });
  }
  return f;
}
