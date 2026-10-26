import { describe, expect, it } from "vitest";
import { INSTRUMENT_TRANSITIONS, SYSTEM_TRANSITIONS, availableActions, canTransition } from "@/server/workflow/instrument-machine";
import { RELEASE_TRANSITIONS, canReleaseTransition } from "@/server/workflow/release-machine";
import { applicableWindow, escalationLevel } from "@/server/jobs/monitor";
import { roleHas, PERMISSIONS, type RoleName } from "@/server/auth/permissions";

describe("instrument state model", () => {
  it("a draft can only be submitted or withdrawn", () => {
    expect(availableActions("DRAFT").sort()).toEqual(["SUBMIT", "WITHDRAW"]);
  });
  it("submission is not approval: accept is only reachable from VERIFIED", () => {
    expect(INSTRUMENT_TRANSITIONS.ACCEPT.from).toEqual(["VERIFIED"]);
    expect(canTransition("PENDING_SCRUTINY", "ACCEPT")).toBe(false);
    expect(canTransition("UNDER_REVIEW", "ACCEPT")).toBe(false);
  });
  it("terminal states have no user actions", () => {
    for (const s of ["REJECTED", "REPLACED", "RELEASED", "WITHDRAWN"] as const) expect(availableActions(s)).toEqual([]);
  });
  it("matured/expired is not a state, and nothing transitions back into ACCEPTED except acceptance", () => {
    const intoAccepted = Object.values(INSTRUMENT_TRANSITIONS).filter((t) => t.to === "ACCEPTED");
    expect(intoAccepted).toHaveLength(1);
    expect(Object.values(SYSTEM_TRANSITIONS).some((t) => t.to === "ACCEPTED")).toBe(false);
  });
  it("rejections and corrections require a recorded reason", () => {
    expect(INSTRUMENT_TRANSITIONS.REJECT.requiresNote).toBe(true);
    expect(INSTRUMENT_TRANSITIONS.REQUEST_CORRECTION.requiresNote).toBe(true);
    expect(RELEASE_TRANSITIONS.REJECT.requiresNote).toBe(true);
    expect(RELEASE_TRANSITIONS.APPROVE.requiresNote).toBe(true);
  });
});

describe("release state model", () => {
  it("cannot be approved before scrutiny/forwarding, nor completed before approval", () => {
    expect(canReleaseTransition("SUBMITTED", "APPROVE")).toBe(false);
    expect(canReleaseTransition("UNDER_SCRUTINY", "APPROVE")).toBe(false);
    expect(canReleaseTransition("PENDING_APPROVAL", "COMPLETE")).toBe(false);
    expect(canReleaseTransition("APPROVED", "COMPLETE")).toBe(true);
    expect(canReleaseTransition("REJECTED", "APPROVE")).toBe(false);
  });
  it("separates duties by permission", () => {
    expect(RELEASE_TRANSITIONS.APPROVE.permission).toBe("release:decide");
    expect(RELEASE_TRANSITIONS.FORWARD.permission).toBe("release:scrutinize");
    expect(roleHas("OFFICER", "release:decide")).toBe(false);
    expect(roleHas("APPROVING_AUTHORITY", "release:scrutinize")).toBe(false);
  });
});

describe("reminder thresholds", () => {
  const windows = [90, 60, 30, 7];
  it("picks only the smallest applicable window", () => {
    expect(applicableWindow(120, windows)).toBeNull();
    expect(applicableWindow(90, windows)).toBe(90);
    expect(applicableWindow(61, windows)).toBe(90);
    expect(applicableWindow(45, windows)).toBe(60);
    expect(applicableWindow(25, windows)).toBe(30);
    expect(applicableWindow(1, windows)).toBe(7);
  });
  it("computes escalation levels after maturity", () => {
    expect(escalationLevel(3, [7, 30])).toBe(0);
    expect(escalationLevel(7, [7, 30])).toBe(1);
    expect(escalationLevel(45, [7, 30])).toBe(2);
  });
});

describe("permission matrix (least privilege)", () => {
  const writes = PERMISSIONS.filter((p) => !["instrument:read", "institution:read", "release:read", "audit:read", "audit:export", "report:export", "dashboard:operational", "comment:internal", "document:download"].includes(p));
  it("auditors have no modification privileges", () => {
    for (const p of writes) expect(roleHas("AUDITOR", p), p).toBe(false);
  });
  it("administrators do not handle financial records or documents", () => {
    for (const p of ["instrument:read", "document:download", "release:read", "release:decide"] as const) expect(roleHas("ADMIN", p)).toBe(false);
  });
  it("only institutions create instruments; only officers review", () => {
    const roles: RoleName[] = ["INSTITUTION_USER", "OFFICER", "APPROVING_AUTHORITY", "ADMIN", "AUDITOR"];
    expect(roles.filter((r) => roleHas(r, "instrument:create"))).toEqual(["INSTITUTION_USER"]);
    expect(roles.filter((r) => roleHas(r, "instrument:review"))).toEqual(["OFFICER"]);
    expect(roles.filter((r) => roleHas(r, "release:decide"))).toEqual(["APPROVING_AUTHORITY"]);
  });
});
