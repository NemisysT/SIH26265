// Business-date helpers. All instrument dates are calendar dates (no time component) interpreted
// in India Standard Time. They are stored in Postgres DATE columns, which Prisma returns as
// JavaScript Dates at 00:00 UTC; every helper here works on that representation.

export const BUSINESS_TIME_ZONE = "Asia/Kolkata";
const DAY_MS = 86_400_000;

/** Calendar date (YYYY-MM-DD) in IST for a given instant. */
export function isoDateInIST(instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BUSINESS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
  return parts; // en-CA formats as YYYY-MM-DD
}

/** Today's business date as a UTC-midnight Date, comparable with DATE columns. */
export function businessToday(now: Date = new Date()): Date {
  return parseDateOnly(isoDateInIST(now))!;
}

/** Parse a strict YYYY-MM-DD string into a UTC-midnight Date; returns null if invalid. */
export function parseDateOnly(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(Date.UTC(y, mo - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== mo - 1 || date.getUTCDate() !== d) return null;
  return date;
}

export function toDateOnlyString(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toISOString().slice(0, 10);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/** Whole calendar days from `from` to `to` (negative when `to` is in the past). */
export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / DAY_MS);
}

/**
 * Business rule for maturity: an instrument is MATURED on and after its maturity date
 * (days remaining <= 0). It is EXPIRING when 1..windowDays days remain.
 */
export type MaturityState = "NO_DATE" | "ACTIVE" | "EXPIRING" | "MATURED";

export function maturityState(maturityDate: Date | null | undefined, today: Date, windowDays: number): MaturityState {
  if (!maturityDate) return "NO_DATE";
  const remaining = daysBetween(today, maturityDate);
  if (remaining <= 0) return "MATURED";
  if (remaining <= windowDays) return "EXPIRING";
  return "ACTIVE";
}
