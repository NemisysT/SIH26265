// Shared fixtures for integration tests: a clean database with two regions, two institutions and
// one user per role.
import { promises as fs } from "node:fs";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { setClock } from "@/server/clock";
import { loadActor } from "@/server/auth/load-actor";
import type { Actor } from "@/server/auth/actor";
import { DEFAULT_SETTINGS } from "@/server/settings";
import { syntheticPdf } from "@/server/storage/synthetic-pdf";
import { createDraft, transitionInstrument } from "@/server/services/instruments";
import { uploadDocument } from "@/server/services/documents";
import { recordVerification } from "@/server/services/verification";
import { addDays, businessToday, toDateOnlyString } from "@/lib/dates";
import { resetRateLimits } from "@/server/rate-limit";

export async function resetDb() {
  setClock(null);
  resetRateLimits();
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "notification_deliveries", "notifications", "audit_events", "comments", "discrepancies", "verification_records",
    "documents", "renewal_cases", "release_requests", "instruments", "sessions", "officer_regions", "users",
    "institutions", "regions", "bank_references", "system_settings", "counters", "job_runs" RESTART IDENTITY CASCADE`);
  await fs.rm(env.storageDir, { recursive: true, force: true });
}

export interface World {
  instA: Actor; // institution user, North region
  instB: Actor; // institution user, South region
  officerNorth: Actor;
  officerSouth: Actor;
  authority: Actor;
  auditor: Actor;
  admin: Actor;
  institutionA: string;
  institutionB: string;
}

export async function buildWorld(): Promise<World> {
  await resetDb();
  const nr = await prisma.region.create({ data: { code: "NR", name: "Northern Region" } });
  const sr = await prisma.region.create({ data: { code: "SR", name: "Southern Region" } });
  await prisma.bankReference.createMany({ data: [{ name: "Demo National Bank", shortCode: "DNB" }, { name: "Example Commercial Bank", shortCode: "ECB" }] });
  await prisma.systemSetting.create({ data: { key: "policy", value: DEFAULT_SETTINGS } });
  const mkInst = (code: string, regionId: string) =>
    prisma.institution.create({
      data: { code, name: `Test Institute ${code}`, category: "Engineering", regionId, addressLine: "x", city: "c", state: "s", pincode: "123456", contactName: "n", contactEmail: `${code}@t.example`, contactPhone: "+91 9000000000", status: "ACTIVE" },
    });
  const a = await mkInst("T-A", nr.id);
  const b = await mkInst("T-B", sr.id);
  const hash = "scrypt$16384$8$1$AAAA$AAAA"; // never used for login in service tests
  const mkUser = async (email: string, role: "INSTITUTION_USER" | "OFFICER" | "APPROVING_AUTHORITY" | "ADMIN" | "AUDITOR", extra: object = {}) =>
    loadActor((await prisma.user.create({ data: { email, name: email.split("@")[0], role, passwordHash: hash, ...extra } })).id);
  return {
    instA: await mkUser("a@t.example", "INSTITUTION_USER", { institutionId: a.id }),
    instB: await mkUser("b@t.example", "INSTITUTION_USER", { institutionId: b.id }),
    officerNorth: await mkUser("on@t.example", "OFFICER", { officerRegions: { create: [{ regionId: nr.id }] } }),
    officerSouth: await mkUser("os@t.example", "OFFICER", { officerRegions: { create: [{ regionId: sr.id }] } }),
    authority: await mkUser("au@t.example", "APPROVING_AUTHORITY"),
    auditor: await mkUser("aud@t.example", "AUDITOR"),
    admin: await mkUser("ad@t.example", "ADMIN"),
    institutionA: a.id,
    institutionB: b.id,
  };
}

export const pdfFile = (name = "receipt.pdf") => ({ name, buffer: syntheticPdf("Test document", ["synthetic"]) });

let counter = 0;
export function draftInput(overrides: Record<string, unknown> = {}) {
  const today = businessToday();
  counter++;
  return {
    type: "FDR" as const,
    instrumentNumber: `FD-TEST-${counter.toString().padStart(4, "0")}`,
    bankName: "Demo National Bank",
    branchName: "Main Road",
    amount: "500000.00",
    issueDate: toDateOnlyString(addDays(today, -10))!,
    maturityDate: toDateOnlyString(addDays(today, 400))!,
    ...overrides,
  };
}

/** Create and submit an instrument with its receipt; returns the instrument. */
export async function submitted(inst: Actor, overrides: Record<string, unknown> = {}) {
  const d = await createDraft(inst, draftInput(overrides));
  await uploadDocument(inst, { instrumentId: d.id, docType: "FDR_RECEIPT" }, pdfFile());
  return transitionInstrument(inst, d.id, { action: "SUBMIT" });
}

/** Drive an instrument all the way to ACCEPTED through the real workflow. */
export async function accepted(inst: Actor, officer: Actor, overrides: Record<string, unknown> = {}) {
  const s = await submitted(inst, overrides);
  await transitionInstrument(officer, s.id, { action: "START_REVIEW" });
  const letter = await uploadDocument(officer, { instrumentId: s.id, docType: "BANK_VERIFICATION_LETTER" }, pdfFile("letter.pdf"));
  await recordVerification(officer, s.id, {
    method: "BANK_CONFIRMATION_LETTER",
    result: "CONFIRMED",
    evidenceReference: "BANK/CONF/1",
    evidenceDocumentId: letter.id,
    observations: "Confirmed by bank letter",
  });
  return transitionInstrument(officer, s.id, { action: "ACCEPT" });
}
