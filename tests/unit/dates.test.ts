import { describe, expect, it } from "vitest";
import { businessToday, daysBetween, maturityState, parseDateOnly, isoDateInIST } from "@/lib/dates";

describe("business dates", () => {
  it("parses strict YYYY-MM-DD only", () => {
    expect(parseDateOnly("2026-02-28")?.toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(parseDateOnly("2026-02-30")).toBeNull();
    expect(parseDateOnly("28/02/2026")).toBeNull();
    expect(parseDateOnly("")).toBeNull();
  });

  it("uses India Standard Time for 'today'", () => {
    // 20:00 UTC on 31 Dec is already 1 Jan in IST.
    expect(isoDateInIST(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(businessToday(new Date("2026-12-31T20:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("classifies maturity: matured on and after the maturity date", () => {
    const today = parseDateOnly("2026-10-26")!;
    expect(maturityState(parseDateOnly("2026-10-26"), today, 90)).toBe("MATURED");
    expect(maturityState(parseDateOnly("2026-10-01"), today, 90)).toBe("MATURED");
    expect(maturityState(parseDateOnly("2026-10-27"), today, 90)).toBe("EXPIRING");
    expect(maturityState(parseDateOnly("2027-01-24"), today, 90)).toBe("EXPIRING");
    expect(maturityState(parseDateOnly("2027-01-25"), today, 90)).toBe("ACTIVE");
    expect(maturityState(null, today, 90)).toBe("NO_DATE");
    expect(daysBetween(today, parseDateOnly("2026-11-25")!)).toBe(30);
  });
});
