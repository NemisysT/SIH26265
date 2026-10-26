// Request schemas shared by API route handlers (authoritative) and client forms (convenience).
import { z } from "zod";
import { parseDateOnly } from "./dates";

const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/;

export const text = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .refine((v) => !CONTROL_CHARS.test(v), "Contains unsupported control characters");

export const requiredText = (max: number, label = "This field") =>
  text(max).pipe(z.string().min(1, `${label} is required`));

const optionalText = (max: number) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), text(max).optional());

/** Money as a decimal string with at most 2 fraction digits; kept as a string to avoid float maths. */
export const amountString = z
  .string()
  .trim()
  .regex(/^\d{1,13}(\.\d{1,2})?$/, "Enter an amount in rupees with at most 2 decimal places")
  .refine((v) => Number(v) > 0, "Amount must be greater than zero");

export const dateString = z
  .string()
  .trim()
  .refine((v) => parseDateOnly(v) !== null, "Enter a valid date (YYYY-MM-DD)");

const optionalDate = z.preprocess((v) => (v === "" || v === null ? undefined : v), dateString.optional());
const optionalAmount = z.preprocess((v) => (v === "" || v === null ? undefined : v), amountString.optional());

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

export const instrumentTypes = ["FDR", "SECURITY_DEPOSIT"] as const;

/** Draft payload: everything optional, but whatever is supplied must be well-formed. */
export const instrumentDraftSchema = z.object({
  type: z.enum(instrumentTypes),
  instrumentNumber: optionalText(60),
  bankName: optionalText(120),
  branchName: optionalText(120),
  ifscCode: z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : v.trim().toUpperCase()) : v),
    z.string().regex(IFSC_PATTERN, "IFSC must look like ABCD0123456").optional(),
  ),
  amount: optionalAmount,
  issueDate: optionalDate,
  maturityDate: optionalDate,
  validUntil: optionalDate,
  purpose: optionalText(300),
  notes: optionalText(2000),
  clientRequestId: z.string().uuid().optional(),
});
export type InstrumentDraftInput = z.infer<typeof instrumentDraftSchema>;

/** Fields that must be present before a record may leave DRAFT / CORRECTION_REQUIRED. */
export const SUBMISSION_REQUIRED_FIELDS = [
  ["instrumentNumber", "Instrument / receipt number"],
  ["bankName", "Issuing bank"],
  ["branchName", "Branch"],
  ["amount", "Deposit amount"],
  ["issueDate", "Issue date"],
  ["maturityDate", "Maturity date"],
] as const;

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  password: z.string().min(1, "Password is required").max(200),
});

export const passwordPolicy = z
  .string()
  .min(10, "Use at least 10 characters")
  .max(128)
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), "Use letters and at least one number");

export const registrationSchema = z.object({
  institutionName: requiredText(200, "Institution name"),
  approvalReference: optionalText(60),
  category: requiredText(80, "Category"),
  regionCode: requiredText(20, "Region"),
  addressLine: requiredText(300, "Address"),
  city: requiredText(80, "City"),
  state: requiredText(80, "State"),
  pincode: z.string().trim().regex(/^\d{6}$/, "PIN code must be 6 digits"),
  contactName: requiredText(120, "Contact name"),
  contactPhone: z.string().trim().regex(/^[0-9+\-\s]{8,16}$/, "Enter a valid phone number"),
  email: z.string().trim().toLowerCase().email("Enter a valid email address").max(200),
  password: passwordPolicy,
});

export const noteSchema = (min = 1, max = 2000) => text(max).pipe(z.string().min(min, "A reason or note is required"));

export { optionalText, optionalDate, optionalAmount };
