// Deterministic demonstration data. ALL institutions, banks, people and instruments are
// FICTIONAL and flagged isDemo. The history is produced by driving the real service layer with an
// injectable clock, so every record carries a genuine audit trail, documents and notifications.
//
// Dates are offsets from a reference date (default: today in IST; override with
// SEED_REFERENCE_DATE=YYYY-MM-DD) so "expiring in 25 days" stays true whenever you seed.
//
//   npm run db:seed              # RESETS demo data; refuses if non-demo accounts exist
//   npm run db:seed -- --force   # wipe everything anyway (development only)
//   npm run db:seed -- --if-empty  # seed only a completely empty database; never deletes anything
//                                  (used by run.sh / run.ps1 on first start)
import "../scripts/load-env";
import { promises as fs } from "node:fs";
import { prisma } from "@/server/db";
import { env } from "@/server/env";
import { setClock } from "@/server/clock";
import { hashPassword } from "@/server/auth/password";
import { loadActor } from "@/server/auth/load-actor";
import type { Actor } from "@/server/auth/actor";
import { addDays, businessToday, parseDateOnly, toDateOnlyString } from "@/lib/dates";
import { syntheticPdf } from "@/server/storage/synthetic-pdf";
import { createDraft, startRenewal, transitionInstrument } from "@/server/services/instruments";
import { uploadDocument } from "@/server/services/documents";
import { raiseDiscrepancy, recordVerification, runExternalVerification } from "@/server/services/verification";
import { createReleaseRequest, transitionRelease } from "@/server/services/releases";
import { applyInstrumentChecks } from "@/server/services/checks";
import { registerInstitution, decideInstitution } from "@/server/services/institutions";
import { recordAudit } from "@/server/audit";
import { nextReference } from "@/server/counters";
import { runMonitor } from "@/server/jobs/monitor";
import { DEFAULT_SETTINGS } from "@/server/settings";

const FORCE = process.argv.includes("--force");
const IF_EMPTY = process.argv.includes("--if-empty");
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? "Demo@SDP2026";
const REF = parseDateOnly(process.env.SEED_REFERENCE_DATE) ?? businessToday(new Date());
let minuteCounter = 0;

/** Instant on business day REF+offset, 10:00 IST plus a monotonic counter to keep ordering stable. */
function at(offset: number): Date {
  minuteCounter += 7;
  return new Date(addDays(REF, offset).getTime() + (4 * 60 + 30 + (minuteCounter % 400)) * 60_000);
}
const day = (offset: number) => toDateOnlyString(addDays(REF, offset))!;
const clock = (offset: number) => setClock(at(offset));

// Deterministic PRNG (mulberry32) for filler data.
let seedState = 26265;
function rand() {
  seedState |= 0;
  seedState = (seedState + 0x6d2b79f5) | 0;
  let t = Math.imul(seedState ^ (seedState >>> 15), 1 | seedState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];

const BANKS = [
  { name: "Demo National Bank", shortCode: "DNB", ifsc: "XDNB0" },
  { name: "Example Commercial Bank", shortCode: "ECB", ifsc: "XECB0" },
  { name: "Sample Cooperative Bank", shortCode: "SCB", ifsc: "XSCB0" },
  { name: "Fictional Rural Bank", shortCode: "FRB", ifsc: "XFRB0" },
  { name: "Illustrative Urban Bank", shortCode: "IUB", ifsc: "XIUB0" },
];
const BRANCHES = ["Civil Lines", "Main Road", "University Campus", "Station Road", "Industrial Area", "Market Square"];

const REGIONS = [
  { code: "NR", name: "Northern Region" },
  { code: "SR", name: "Southern Region" },
  { code: "ER", name: "Eastern Region" },
  { code: "WR", name: "Western Region" },
  { code: "CR", name: "Central Region" },
];

const INSTITUTIONS = [
  { key: "northfield", name: "Northfield Institute of Technology (Demo)", region: "NR", category: "Engineering & Technology", city: "Dehradun", state: "Uttarakhand" },
  { key: "himgiri", name: "Himgiri College of Pharmacy (Demo)", region: "NR", category: "Pharmacy", city: "Shimla", state: "Himachal Pradesh" },
  { key: "coastal", name: "Coastal College of Engineering (Demo)", region: "SR", category: "Engineering & Technology", city: "Mangaluru", state: "Karnataka" },
  { key: "southern", name: "Southern Polytechnic Institute (Demo)", region: "SR", category: "Polytechnic (Diploma)", city: "Madurai", state: "Tamil Nadu" },
  { key: "eastbrook", name: "Eastbrook Institute of Management (Demo)", region: "ER", category: "Management", city: "Bhubaneswar", state: "Odisha" },
  { key: "deltaview", name: "Deltaview Engineering College (Demo)", region: "ER", category: "Engineering & Technology", city: "Kolkata", state: "West Bengal" },
  { key: "westgate", name: "Westgate Technical Institute (Demo)", region: "WR", category: "Engineering & Technology", city: "Nashik", state: "Maharashtra" },
  { key: "westarch", name: "Westgate College of Architecture (Demo)", region: "WR", category: "Architecture", city: "Vadodara", state: "Gujarat" },
  { key: "centralplains", name: "Central Plains Institute of Technology (Demo)", region: "CR", category: "Engineering & Technology", city: "Bhopal", state: "Madhya Pradesh" },
  { key: "meadowbrook", name: "Meadowbrook College of Engineering (Demo)", region: "CR", category: "Engineering & Technology", city: "Raipur", state: "Chhattisgarh" },
  { key: "lakeshore", name: "Lakeshore Institute of Applied Sciences (Demo)", region: "WR", category: "Applied Arts & Crafts", city: "Udaipur", state: "Rajasthan" },
] as const;
type InstKey = (typeof INSTITUTIONS)[number]["key"];

/** Rows in the core tables; zero everywhere means a freshly migrated database. */
async function existingRows() {
  const [users, institutions, instruments, documents, regions, auditEvents] = await Promise.all([
    prisma.user.count(),
    prisma.institution.count(),
    prisma.instrument.count(),
    prisma.document.count(),
    prisma.region.count(),
    prisma.auditEvent.count(),
  ]);
  return { users, institutions, instruments, documents, regions, auditEvents };
}

async function resetDatabase() {
  if (env.isProduction && !env.demoMode) throw new Error("Refusing to seed demonstration data in production unless DEMO_MODE=true.");
  if (IF_EMPTY) {
    // Non-destructive path: no TRUNCATE and no removal of stored documents.
    await fs.mkdir(env.storageDir, { recursive: true });
    return;
  }
  const nonDemoUsers = await prisma.user.count({ where: { isDemo: false } });
  if (nonDemoUsers > 0 && !FORCE) {
    throw new Error(`Refusing to seed: ${nonDemoUsers} non-demo user account(s) exist. Re-run with --force to wipe ALL data.`);
  }
  if (env.isProduction && !process.env.DEMO_PASSWORD) {
    throw new Error("Set DEMO_PASSWORD explicitly before seeding a production-mode deployment; the documented default is for local use only.");
  }
  // TRUNCATE bypasses the append-only audit trigger (which guards UPDATE/DELETE); it is used only
  // by this explicit development reset, never by the application.
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE
    "notification_deliveries", "notifications", "audit_events", "comments", "discrepancies", "verification_records",
    "documents", "renewal_cases", "release_requests", "instruments", "sessions", "officer_regions", "users",
    "institutions", "regions", "bank_references", "system_settings", "counters", "job_runs" RESTART IDENTITY CASCADE`);
  await fs.rm(env.storageDir, { recursive: true, force: true });
  await fs.mkdir(env.storageDir, { recursive: true });
}

const pdf = (title: string, lines: string[]) => ({ name: `${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`, buffer: syntheticPdf(title, lines) });

interface Spec {
  type?: "FDR" | "SECURITY_DEPOSIT";
  number: string;
  bank: (typeof BANKS)[number];
  amount: string;
  issue: number;
  maturity: number;
  purpose?: string;
}

function draftInput(s: Spec) {
  return {
    type: s.type ?? "FDR",
    instrumentNumber: s.number,
    bankName: s.bank.name,
    branchName: pick(BRANCHES),
    ifscCode: `${s.bank.ifsc}${String(100000 + Math.floor(rand() * 899999))}`,
    amount: s.amount,
    issueDate: day(s.issue),
    maturityDate: day(s.maturity),
    purpose: s.purpose ?? "Security deposit towards institutional approval (demonstration)",
  };
}

async function main() {
  if (IF_EMPTY) {
    const rows = await existingRows();
    const total = Object.values(rows).reduce((a, b) => a + b, 0);
    if (total > 0) {
      console.log(`Existing data found (${rows.users} users, ${rows.institutions} institutions, ${rows.instruments} instruments); demonstration seed skipped.`);
      const marker = await prisma.systemSetting.findUnique({ where: { key: "demo_seed" } });
      const nonDemo = await prisma.user.count({ where: { isDemo: false } });
      if (!marker && nonDemo === 0 && rows.users > 0 && rows.institutions > 0) {
        console.warn("Note: no demo-seed completion marker was found. If a previous first-run seed was interrupted, reset the demo data with `./run.sh reset-demo` (or `.\\run.ps1 reset-demo`).");
      }
      return;
    }
  }
  console.log(`Seeding demonstration data (reference date ${toDateOnlyString(REF)})…`);
  await resetDatabase();
  setClock(at(-420));

  // ---------------------------------------------------------------- reference data & settings
  const regions = Object.fromEntries(
    await Promise.all(REGIONS.map(async (r) => [r.code, await prisma.region.create({ data: r })] as const)),
  );
  await prisma.bankReference.createMany({ data: BANKS.map((b) => ({ name: b.name, shortCode: b.shortCode, isFictional: true })) });
  await prisma.systemSetting.create({ data: { key: "policy", value: DEFAULT_SETTINGS } });

  // ---------------------------------------------------------------- staff accounts
  const passwordHash = await hashPassword(DEMO_PASSWORD);
  const mkUser = (email: string, name: string, role: "OFFICER" | "APPROVING_AUTHORITY" | "ADMIN" | "AUDITOR" | "INSTITUTION_USER", extra: object = {}) =>
    prisma.user.create({ data: { email, name, role, passwordHash, status: "ACTIVE", isDemo: true, ...extra } });

  const admin = await mkUser("admin@demo.example.org", "Asha Verma (Demo Admin)", "ADMIN", { designation: "System Administrator" });
  const offNorth = await mkUser("officer.north@demo.example.org", "Rohan Mehta (Demo Officer)", "OFFICER", {
    designation: "Section Officer, Regulation Bureau",
    officerRegions: { create: ["NR", "CR", "ER"].map((c) => ({ regionId: regions[c].id })) },
  });
  const offSouth = await mkUser("officer.south@demo.example.org", "Kavya Iyer (Demo Officer)", "OFFICER", {
    designation: "Section Officer, Regulation Bureau",
    officerRegions: { create: ["SR", "WR"].map((c) => ({ regionId: regions[c].id })) },
  });
  const authority = await mkUser("authority@demo.example.org", "Vikram Rao (Demo Approving Authority)", "APPROVING_AUTHORITY", { designation: "Deputy Director (Demo)" });
  await mkUser("auditor@demo.example.org", "Meera Nair (Demo Auditor)", "AUDITOR", { designation: "Internal Auditor (Demo)" });

  // ---------------------------------------------------------------- institutions & their users
  const inst: Record<string, { id: string; userId: string }> = {};
  let n = 0;
  for (const i of INSTITUTIONS) {
    n++;
    const created = await prisma.institution.create({
      data: {
        code: `DEMO-${i.region}-${String(n).padStart(4, "0")}`,
        approvalReference: `DEMO/APR/${2020 + (n % 5)}/${String(1000 + n * 37)}`,
        name: i.name,
        category: i.category,
        regionId: regions[i.region].id,
        addressLine: `Plot ${10 + n}, Demo Knowledge Park`,
        city: i.city,
        state: i.state,
        pincode: String(400000 + n * 1111).slice(0, 6),
        contactName: `Registrar, ${i.name.replace(" (Demo)", "")}`,
        contactEmail: `inst.${i.key}@demo.example.org`,
        contactPhone: `+91 90000 ${String(10000 + n).slice(-5)}`,
        status: i.key === "lakeshore" ? "SUSPENDED" : "ACTIVE",
        statusReason: i.key === "lakeshore" ? "Suspended for demonstration: registration documents under re-verification." : null,
        approvedById: admin.id,
        approvedAt: at(-420),
        isDemo: true,
        createdAt: at(-430),
      },
    });
    const user = await mkUser(`inst.${i.key}@demo.example.org`, `${i.name.replace(" (Demo)", "")} – Nodal Officer`, "INSTITUTION_USER", {
      institutionId: created.id,
      designation: "Nodal Officer (Demo)",
    });
    inst[i.key] = { id: created.id, userId: user.id };
  }

  const A = {
    north: await loadActor(offNorth.id),
    south: await loadActor(offSouth.id),
    authority: await loadActor(authority.id),
    admin: await loadActor(admin.id),
  };
  const I = async (k: InstKey) => loadActor(inst[k].userId);
  const officerFor = (k: InstKey) => {
    const region = INSTITUTIONS.find((x) => x.key === k)!.region;
    return ["SR", "WR"].includes(region) ? A.south : A.north;
  };

  // ---------------------------------------------------------------- lifecycle helpers
  async function draft(k: InstKey, s: Spec, d: number) {
    clock(d);
    return createDraft(await I(k), draftInput(s));
  }
  async function attach(k: InstKey, id: string, s: Spec, d: number, docType: "FDR_RECEIPT" | "DEPOSIT_CONFIRMATION" | "RENEWAL_DOCUMENT" = "FDR_RECEIPT") {
    clock(d);
    return uploadDocument(await I(k), { instrumentId: id, docType }, pdf(`${docType === "FDR_RECEIPT" ? "FDR receipt" : "Deposit confirmation"} ${s.number}`, [
      `Bank: ${s.bank.name} (fictional)`,
      `Instrument no.: ${s.number}`,
      `Amount: INR ${s.amount}`,
      `Issue date: ${day(s.issue)}   Maturity date: ${day(s.maturity)}`,
      "Depositor: demonstration institution",
    ]));
  }
  async function act(actor: Actor, id: string, action: Parameters<typeof transitionInstrument>[2]["action"], d: number, note?: string) {
    clock(d);
    return transitionInstrument(actor, id, { action, note });
  }
  async function confirmByLetter(k: InstKey, id: string, s: Spec, d: number) {
    const off = officerFor(k);
    clock(d);
    const letter = await uploadDocument(off, { instrumentId: id, docType: "BANK_VERIFICATION_LETTER" }, pdf(`Bank confirmation ${s.number}`, [
      `${s.bank.name} (fictional) confirms deposit no. ${s.number}`,
      `for INR ${s.amount}, maturing ${day(s.maturity)}.`,
      "This letter is synthetic demonstration content.",
    ]));
    clock(d);
    await recordVerification(off, id, {
      method: "BANK_CONFIRMATION_LETTER",
      result: "CONFIRMED",
      evidenceReference: `DEMO/${s.bank.shortCode}/CONF/${s.number.slice(-5)}`,
      evidenceDocumentId: letter.id,
      observations: "Bank confirmation letter received and matched against the submitted receipt (synthetic).",
    });
  }
  /** Full happy path: draft → documents → submit → review → verification → accept. */
  async function accepted(k: InstKey, s: Spec, start: number) {
    const off = officerFor(k);
    const d = await draft(k, s, start);
    await attach(k, d.id, s, start, s.type === "SECURITY_DEPOSIT" ? "DEPOSIT_CONFIRMATION" : "FDR_RECEIPT");
    await act(await I(k), d.id, "SUBMIT", start);
    await act(off, d.id, "START_REVIEW", start + 2);
    await act(off, d.id, "SEND_FOR_VERIFICATION", start + 3);
    await confirmByLetter(k, d.id, s, start + 6);
    await act(off, d.id, "ACCEPT", start + 7);
    return d;
  }

  const supporting = (title: string) => [pdf(title, ["Covering letter requesting release/refund (synthetic).", "Signed by the institution's authorised signatory (demonstration)."])];
  async function release(k: InstKey, instrumentId: string, d: number, type: "RELEASE" | "REFUND", amount: string, reason: string) {
    clock(d);
    return createReleaseRequest(await I(k), { instrumentId, type, requestedAmount: amount, reason }, supporting(`Release request letter`));
  }
  async function relAct(actor: Actor, id: string, action: Parameters<typeof transitionRelease>[2]["action"], d: number, note?: string, completionReference?: string) {
    clock(d);
    return transitionRelease(actor, id, { action, note, completionReference });
  }

  const fd = (prefix: string) => `${prefix}${String(Math.floor(rand() * 1e10)).padStart(10, "0")}`;
  const [DNB, ECB, SCB, FRB, IUB] = BANKS;

  // ---------------------------------------------------------------- Northfield (NR) — primary demo institution
  console.log("  Northfield scenarios…");
  const nf1: Spec = { number: fd("NF"), bank: DNB, amount: "2500000.00", issue: -300, maturity: 430 };
  await accepted("northfield", nf1, -298);

  const nf2: Spec = { number: fd("NF"), bank: ECB, amount: "1000000.00", issue: -340, maturity: 25 };
  await accepted("northfield", nf2, -338); // expiring within 30 days → reminder

  const nf3: Spec = { number: fd("NF"), bank: SCB, amount: "750000.00", issue: -377, maturity: -12 };
  await accepted("northfield", nf3, -375); // matured 12 days ago, no action → overdue + escalation L1

  // Draft with a missing maturity date.
  clock(-1);
  await createDraft(await I("northfield"), { type: "FDR", instrumentNumber: fd("NF"), bankName: IUB.name, amount: "500000.00", issueDate: day(-3) });

  // Correction required (amount mismatch) — correction now overdue.
  const nf5: Spec = { number: fd("NF"), bank: DNB, amount: "5000000.00", issue: -30, maturity: 700 };
  const nf5d = await draft("northfield", nf5, -26);
  await attach("northfield", nf5d.id, nf5, -26);
  await act(await I("northfield"), nf5d.id, "SUBMIT", -25);
  await act(A.north, nf5d.id, "START_REVIEW", -23);
  clock(-21);
  await raiseDiscrepancy(A.north, nf5d.id, { severity: "BLOCKING", message: "Amount on the uploaded receipt (INR 5,00,000.00) differs from the amount entered (INR 50,00,000.00).", field: "amount" });
  await act(A.north, nf5d.id, "REQUEST_CORRECTION", -20, "Please correct the deposit amount to match the receipt and re-upload a legible copy.");

  // Completed renewal: original replaced by an accepted renewal (history preserved).
  const nf6: Spec = { number: fd("NF"), bank: ECB, amount: "1500000.00", issue: -405, maturity: -40 };
  const nf6d = await accepted("northfield", nf6, -403);
  clock(-48);
  const ren = await startRenewal(await I("northfield"), nf6d.id, {
    kind: "RENEWAL",
    reason: "Original FDR matures shortly; renewed with the same bank for a further year.",
    ...draftInput({ number: fd("NF"), bank: ECB, amount: "1575000.00", issue: -44, maturity: 321 }),
  });
  const nf6r: Spec = { number: ren.instrument.instrumentNumber!, bank: ECB, amount: "1575000.00", issue: -44, maturity: 321 };
  await attach("northfield", ren.instrument.id, nf6r, -44);
  await act(await I("northfield"), ren.instrument.id, "SUBMIT", -44);
  await act(A.north, ren.instrument.id, "START_REVIEW", -42);
  await confirmByLetter("northfield", ren.instrument.id, nf6r, -38);
  await act(A.north, ren.instrument.id, "ACCEPT", -37);
  // …and release of the replaced FDR: approved, awaiting completion evidence.
  const relNf6 = await release("northfield", nf6d.id, -25, "RELEASE", "1500000.00", "Original FDR has been replaced by an accepted renewal; requesting discharge of the matured receipt.");
  await relAct(A.north, relNf6.id, "START_SCRUTINY", -24);
  await relAct(A.north, relNf6.id, "FORWARD", -22, "Replacement accepted; original is no longer required as security. Recommend release.");
  await relAct(A.authority, relNf6.id, "APPROVE", -20, "Approved: replacement instrument is held and verified.");

  // Security deposit with a release request pending the authority's decision.
  const nf7: Spec = { type: "SECURITY_DEPOSIT", number: `SD${fd("")}`, bank: FRB, amount: "300000.00", issue: -380, maturity: -5 };
  const nf7d = await accepted("northfield", nf7, -378);
  const relNf7 = await release("northfield", nf7d.id, -4, "REFUND", "300000.00", "Programme closed as per approval records; requesting refund of the matured security deposit.");
  await relAct(A.north, relNf7.id, "START_SCRUTINY", -3);
  await relAct(A.north, relNf7.id, "FORWARD", -2, "Deposit matured; supporting closure letter attached. No outstanding dues found in portal records.");

  // Recently submitted, pending scrutiny.
  const nf8: Spec = { number: fd("NF"), bank: DNB, amount: "2000000.00", issue: -6, maturity: 724 };
  const nf8d = await draft("northfield", nf8, -3);
  await attach("northfield", nf8d.id, nf8, -3);
  await act(await I("northfield"), nf8d.id, "SUBMIT", -2);

  // ---------------------------------------------------------------- Coastal (SR)
  console.log("  Coastal scenarios…");
  // Submitted without any document → missing-document flag; scrutiny now overdue.
  const co9: Spec = { number: fd("CC"), bank: SCB, amount: "1200000.00", issue: -15, maturity: 715 };
  const co9d = await draft("coastal", co9, -11);
  await act(await I("coastal"), co9d.id, "SUBMIT", -10);

  // Duplicate reference: Eastbrook already holds an accepted FDR with the same bank + number.
  const dupNumber = fd("DUP");
  await accepted("eastbrook", { number: dupNumber, bank: DNB, amount: "800000.00", issue: -200, maturity: 530 }, -198);
  const co10: Spec = { number: dupNumber, bank: DNB, amount: "800000.00", issue: -9, maturity: 721 };
  const co10d = await draft("coastal", co10, -6);
  await attach("coastal", co10d.id, co10, -6);
  await act(await I("coastal"), co10d.id, "SUBMIT", -5);
  await act(A.south, co10d.id, "START_REVIEW", -3);

  // Verification pending, with a DEMO/SIMULATED provider query on record.
  const co12: Spec = { number: fd("CC"), bank: IUB, amount: "1800000.00", issue: -20, maturity: 710 };
  const co12d = await draft("coastal", co12, -16);
  await attach("coastal", co12d.id, co12, -16);
  await act(await I("coastal"), co12d.id, "SUBMIT", -15);
  await act(A.south, co12d.id, "START_REVIEW", -8);
  await act(A.south, co12d.id, "SEND_FOR_VERIFICATION", -6);
  clock(-6);
  process.env.VERIFICATION_PROVIDER ??= "demo";
  await runExternalVerification(A.south, co12d.id);
  clock(-6);
  await recordVerification(A.south, co12d.id, {
    method: "MANUAL_DOCUMENT_REVIEW",
    result: "PENDING",
    observations: "Receipt is legible and internally consistent. Confirmation letter requested from the issuing bank branch.",
  });

  // Renewal in progress for an instrument maturing in 55 days.
  const co13: Spec = { number: fd("CC"), bank: ECB, amount: "1000000.00", issue: -310, maturity: 55 };
  const co13d = await accepted("coastal", co13, -308);
  clock(-5);
  const ren13 = await startRenewal(await I("coastal"), co13d.id, {
    kind: "REPLACEMENT",
    reason: "Replacing with a fresh FDR from a different branch ahead of maturity.",
    ...draftInput({ number: fd("CC"), bank: DNB, amount: "1000000.00", issue: -6, maturity: 720 }),
  });
  await attach("coastal", ren13.instrument.id, { number: ren13.instrument.instrumentNumber!, bank: DNB, amount: "1000000.00", issue: -6, maturity: 720 }, -4, "RENEWAL_DOCUMENT");
  await attach("coastal", ren13.instrument.id, { number: ren13.instrument.instrumentNumber!, bank: DNB, amount: "1000000.00", issue: -6, maturity: 720 }, -4);
  await act(await I("coastal"), ren13.instrument.id, "SUBMIT", -4);

  // Historical completed release.
  const co14: Spec = { number: fd("CC"), bank: SCB, amount: "600000.00", issue: -460, maturity: -95 };
  const co14d = await accepted("coastal", co14, -458);
  const rel14 = await release("coastal", co14d.id, -80, "REFUND", "600000.00", "Course discontinued with approval; requesting refund of matured deposit.");
  await relAct(A.south, rel14.id, "START_SCRUTINY", -78);
  await relAct(A.south, rel14.id, "FORWARD", -75, "Closure documentation verified against portal records.");
  await relAct(A.authority, rel14.id, "APPROVE", -72, "Approved for refund on maturity.");
  clock(-61);
  await uploadDocument(A.south, { releaseRequestId: rel14.id, docType: "RELEASE_COMPLETION_EVIDENCE" }, pdf("Discharge advice", ["Bank discharge advice for the matured deposit (synthetic).", "No real funds were transferred."]));
  await relAct(A.south, rel14.id, "COMPLETE", -60, "Discharge advice received from the bank (synthetic).", "DEMO/DISCHARGE/2026/0042");

  // Rejected refund request (decision + reason retained).
  const co16: Spec = { number: fd("CC"), bank: FRB, amount: "900000.00", issue: -165, maturity: 200 };
  const co16d = await accepted("coastal", co16, -163);
  const rel16 = await release("coastal", co16d.id, -19, "REFUND", "900000.00", "Requesting early refund to meet working-capital needs.");
  await relAct(A.south, rel16.id, "START_SCRUTINY", -18);
  await relAct(A.south, rel16.id, "FORWARD", -17, "Instrument has not matured and continues to secure the current approval. Forwarded for decision.");
  await relAct(A.authority, rel16.id, "REJECT", -15, "Rejected: the deposit secures a current approval and the stated grounds do not justify early release.");

  // Rejected instrument.
  const co17: Spec = { number: fd("CC"), bank: IUB, amount: "400000.00", issue: -60, maturity: 670 };
  const co17d = await draft("coastal", co17, -52);
  await attach("coastal", co17d.id, co17, -52);
  await act(await I("coastal"), co17d.id, "SUBMIT", -50);
  await act(A.south, co17d.id, "START_REVIEW", -47);
  await act(A.south, co17d.id, "REJECT", -44, "Receipt names a different depositor than the institution; a fresh instrument in the institution's name is required.");

  // Release request submitted 13 days ago — scrutiny overdue.
  const co18: Spec = { number: fd("CC"), bank: DNB, amount: "350000.00", issue: -400, maturity: -20 };
  const co18d = await accepted("coastal", co18, -398);
  await release("coastal", co18d.id, -13, "RELEASE", "350000.00", "Matured FDR; institution has deposited a fresh instrument under a separate approval.");

  // ---------------------------------------------------------------- Eastbrook (ER)
  console.log("  Eastbrook scenarios…");
  // Verified, awaiting formal acceptance.
  const eb1: Spec = { number: fd("EB"), bank: SCB, amount: "1100000.00", issue: -12, maturity: 718 };
  const eb1d = await draft("eastbrook", eb1, -9);
  await attach("eastbrook", eb1d.id, eb1, -9);
  await act(await I("eastbrook"), eb1d.id, "SUBMIT", -8);
  await act(A.north, eb1d.id, "START_REVIEW", -4);
  await confirmByLetter("eastbrook", eb1d.id, eb1, -1);
  // Matured, release request waiting for more information.
  const eb2: Spec = { number: fd("EB"), bank: FRB, amount: "450000.00", issue: -395, maturity: -30 };
  const eb2d = await accepted("eastbrook", eb2, -393);
  const rel19 = await release("eastbrook", eb2d.id, -12, "RELEASE", "450000.00", "Matured; requesting release of original receipt.");
  await relAct(A.north, rel19.id, "START_SCRUTINY", -11);
  await relAct(A.north, rel19.id, "REQUEST_INFO", -10, "Please upload the bank's maturity statement and confirm whether a replacement instrument has been deposited.");

  // ---------------------------------------------------------------- Westgate (WR) — legacy imports with data problems
  console.log("  Legacy imports…");
  const legacy = await loadActor(inst.westgate.userId);
  for (const [i, rec] of [
    { instrumentNumber: null, bankName: null, branchName: "Old Town", amount: "650000.00", issueDate: day(-900), maturityDate: day(195), notes: "Imported from legacy register; receipt number and bank not captured." },
    { instrumentNumber: "LEG-0099-17", bankName: "Legacy Mutual Bank", branchName: null, ifscCode: "BADIFSC", amount: "275000.00", issueDate: day(-500), maturityDate: day(-560), notes: "Imported from legacy register; dates appear transposed." },
  ].entries()) {
    clock(-7 + i);
    await prisma.$transaction(async (tx) => {
      const referenceNo = await nextReference(tx, "SDP", at(0).getUTCFullYear());
      const created = await tx.instrument.create({
        data: {
          referenceNo,
          institutionId: inst.westgate.id,
          type: "FDR",
          origin: "LEGACY_IMPORT",
          instrumentNumber: rec.instrumentNumber,
          bankName: rec.bankName,
          branchName: rec.branchName,
          ifscCode: "ifscCode" in rec ? rec.ifscCode : null,
          amount: rec.amount,
          issueDate: parseDateOnly(rec.issueDate),
          maturityDate: parseDateOnly(rec.maturityDate),
          notes: rec.notes,
          status: "PENDING_SCRUTINY",
          submittedAt: at(-7 + i),
          firstSubmittedAt: at(-7 + i),
          statusChangedAt: at(-7 + i),
          createdById: legacy.id,
          createdAt: at(-7 + i),
        },
      });
      const system = { kind: "system" as const, label: "legacy-import" };
      await recordAudit(tx, system, { action: "LEGACY_RECORD_IMPORTED", resourceType: "Instrument", resourceId: created.id, institutionId: inst.westgate.id, after: rec });
      await applyInstrumentChecks(tx, created.id, system, "legacy import");
    });
  }
  // An instrument matured 35 days ago with no action → escalated to approving authorities.
  await accepted("westgate", { number: fd("WG"), bank: ECB, amount: "1250000.00", issue: -400, maturity: -35 }, -398);

  // ---------------------------------------------------------------- portfolio filler (all accepted)
  console.log("  Portfolio filler…");
  const fillerInst: InstKey[] = ["himgiri", "southern", "deltaview", "westarch", "centralplains", "meadowbrook", "westgate", "eastbrook", "southern", "himgiri"];
  const maturities = [8, 19, 41, 67, 88, 120, 150, 240, 300, 365, 410, 500, 560, 640, 690, -2, 33, 77];
  for (const [i, m] of maturities.entries()) {
    const k = fillerInst[i % fillerInst.length];
    const tenure = 365 + Math.floor(rand() * 400);
    const issue = m - tenure;
    const lakhs = [3, 5, 7.5, 10, 12, 15, 20, 25, 30, 40][Math.floor(rand() * 10)];
    await accepted(k, { number: fd(k.slice(0, 2).toUpperCase()), bank: pick(BANKS), amount: (lakhs * 100000).toFixed(2), issue, maturity: m }, Math.max(issue + 2, -500));
  }

  // ---------------------------------------------------------------- pending self-registration
  clock(-1);
  await registerInstitution({
    institutionName: "Riverside School of Management (Demo)",
    approvalReference: undefined,
    category: "Management",
    regionCode: "ER",
    addressLine: "Plot 77, Demo Riverside Campus",
    city: "Guwahati",
    state: "Assam",
    pincode: "781001",
    contactName: "Riverside – Nodal Officer",
    contactPhone: "+91 90000 77777",
    email: "inst.riverside@demo.example.org",
    password: DEMO_PASSWORD,
  });
  // A rejected registration for the record.
  clock(-30);
  await registerInstitution({
    institutionName: "Incomplete Registration Test College (Demo)",
    category: "Engineering & Technology",
    regionCode: "CR",
    addressLine: "Unknown",
    city: "Indore",
    state: "Madhya Pradesh",
    pincode: "452001",
    contactName: "Unverified Contact",
    contactPhone: "+91 90000 00000",
    email: "inst.incomplete@demo.example.org",
    password: DEMO_PASSWORD,
  });
  const incomplete = await prisma.institution.findFirstOrThrow({ where: { name: { startsWith: "Incomplete Registration" } } });
  clock(-28);
  await decideInstitution(A.admin, incomplete.id, { action: "REJECT", reason: "Approval reference and address could not be matched to any record (demonstration)." });

  // ---------------------------------------------------------------- finishing touches
  await prisma.$transaction([
    prisma.institution.updateMany({ data: { isDemo: true } }),
    prisma.user.updateMany({ data: { isDemo: true } }),
    prisma.instrument.updateMany({ data: { isDemo: true } }),
    prisma.releaseRequest.updateMany({ data: { isDemo: true } }),
    prisma.notification.updateMany({ where: { createdAt: { lt: at(-10) } }, data: { readAt: at(-9) } }),
  ]);

  // Today's monitoring pass generates current reminders/escalations and simulated email deliveries.
  setClock(new Date(addDays(REF, 0).getTime() + 3 * 3600_000));
  const { summary } = await runMonitor({ trigger: "CLI" });
  setClock(null);

  // Completion marker: lets `--if-empty` distinguish a finished demo seed from an interrupted one.
  await prisma.systemSetting.upsert({
    where: { key: "demo_seed" },
    create: { key: "demo_seed", value: { completedAt: new Date().toISOString(), referenceDate: toDateOnlyString(REF) } },
    update: { value: { completedAt: new Date().toISOString(), referenceDate: toDateOnlyString(REF) } },
  });

  const counts = {
    institutions: await prisma.institution.count(),
    users: await prisma.user.count(),
    instruments: await prisma.instrument.count(),
    documents: await prisma.document.count(),
    releaseRequests: await prisma.releaseRequest.count(),
    renewalCases: await prisma.renewalCase.count(),
    notifications: await prisma.notification.count(),
    auditEvents: await prisma.auditEvent.count(),
  };
  console.log("Seed complete:", counts);
  console.log("Monitor pass:", summary);
  console.log(`Demo accounts use the password from DEMO_PASSWORD (default documented in README).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
