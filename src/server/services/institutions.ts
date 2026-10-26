import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db";
import type { Actor } from "../auth/actor";
import { SYSTEM_REGISTRATION } from "../auth/system";
import { institutionScope, requirePermission } from "../auth/scope";
import { recordAudit } from "../audit";
import { hashPassword } from "../auth/password";
import { ConflictError, InvalidTransitionError, NotFoundError, ValidationError, isUniqueViolation } from "../errors";
import { nextSequence } from "../counters";
import { notify, officerIdsForInstitution, userIdsByRole } from "../notifications/notify";
import { assertUuid } from "./common";
import type { registrationSchema } from "@/lib/validation";
import { text } from "@/lib/validation";
import { now } from "../clock";

export async function listInstitutions(actor: Actor, f: { q?: string; status?: string; regionId?: string }, paging: { skip: number; take: number }) {
  requirePermission(actor, "institution:read");
  const and: Prisma.InstitutionWhereInput[] = [institutionScope(actor)];
  const q = f.q?.trim().slice(0, 100);
  if (q) and.push({ OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { city: { contains: q, mode: "insensitive" } }] });
  if (f.status && ["PENDING_APPROVAL", "ACTIVE", "SUSPENDED", "REJECTED"].includes(f.status)) and.push({ status: f.status as "ACTIVE" });
  if (f.regionId && /^[0-9a-f-]{36}$/i.test(f.regionId)) and.push({ regionId: f.regionId });
  const where = { AND: and };
  const showFinancials = actor.role !== "ADMIN";
  const [rows, total] = await Promise.all([
    prisma.institution.findMany({
      where,
      orderBy: [{ status: "asc" }, { name: "asc" }],
      include: {
        region: true,
        ...(showFinancials ? { _count: { select: { instruments: { where: { status: "ACCEPTED" } } } } } : {}),
      },
      skip: paging.skip, take: paging.take,
    }),
    prisma.institution.count({ where }),
  ]);
  let heldValue = new Map<string, string>();
  if (showFinancials && rows.length) {
    const sums = await prisma.instrument.groupBy({
      by: ["institutionId"],
      where: { institutionId: { in: rows.map((r) => r.id) }, status: "ACCEPTED" },
      _sum: { amount: true },
    });
    heldValue = new Map(sums.map((s) => [s.institutionId, s._sum.amount?.toString() ?? "0"]));
  }
  return { rows: rows.map((r) => ({ ...r, heldValue: heldValue.get(r.id) ?? null })), total, showFinancials };
}

export async function getInstitution(actor: Actor, id: string) {
  requirePermission(actor, "institution:read");
  assertUuid(id, "Institution");
  const inst = await prisma.institution.findFirst({
    where: { AND: [{ id }, institutionScope(actor)] },
    include: { region: true, users: { select: { id: true, name: true, email: true, status: true, designation: true } } },
  });
  if (!inst) throw new NotFoundError("Institution");
  return inst;
}

type RegistrationInput = z.infer<typeof registrationSchema>;

/** Public self-registration: creates a PENDING institution and a PENDING user awaiting approval. */
export async function registerInstitution(input: RegistrationInput) {
  const region = await prisma.region.findFirst({ where: { code: input.regionCode, isActive: true } });
  if (!region) throw new ValidationError("Select a valid region.", { regionCode: ["Invalid region"] });
  const existing = await prisma.user.findUnique({ where: { email: input.email } });
  // Do not reveal whether an email is registered: respond identically.
  if (existing) return { ok: true as const };
  const passwordHash = await hashPassword(input.password);
  try {
    await prisma.$transaction(async (tx) => {
      const seq = await nextSequence(tx, "institution-code");
      const institution = await tx.institution.create({
        data: {
          code: `REG-${region.code}-${String(seq).padStart(4, "0")}`,
          approvalReference: input.approvalReference,
          name: input.institutionName,
          category: input.category,
          regionId: region.id,
          addressLine: input.addressLine,
          city: input.city,
          state: input.state,
          pincode: input.pincode,
          contactName: input.contactName,
          contactEmail: input.email,
          contactPhone: input.contactPhone,
          status: "PENDING_APPROVAL",
          createdAt: now(),
        },
      });
      const user = await tx.user.create({
        data: { email: input.email, name: input.contactName, passwordHash, role: "INSTITUTION_USER", status: "PENDING", institutionId: institution.id },
      });
      await recordAudit(tx, SYSTEM_REGISTRATION, {
        action: "INSTITUTION_REGISTERED",
        resourceType: "Institution",
        resourceId: institution.id,
        institutionId: institution.id,
        after: { code: institution.code, name: institution.name, region: region.code, userId: user.id },
      });
      const recipients = [...(await userIdsByRole(tx, "ADMIN")), ...(await officerIdsForInstitution(tx, institution.id))];
      await notify(tx, {
        recipientIds: recipients,
        type: "INSTITUTION_REGISTRATION",
        title: `Registration awaiting approval: ${institution.name}`,
        message: `${institution.code} registered from ${institution.city}, ${institution.state}.`,
        link: `/institutions/${institution.id}`,
        institutionId: institution.id,
      });
    });
  } catch (err) {
    if (isUniqueViolation(err)) return { ok: true as const };
    throw err;
  }
  return { ok: true as const };
}

export const institutionDecisionSchema = z.object({
  action: z.enum(["APPROVE", "REJECT", "SUSPEND", "REACTIVATE"]),
  reason: text(1000).optional(),
});

const DECISIONS = {
  APPROVE: { from: ["PENDING_APPROVAL"], to: "ACTIVE" },
  REJECT: { from: ["PENDING_APPROVAL"], to: "REJECTED" },
  SUSPEND: { from: ["ACTIVE"], to: "SUSPENDED" },
  REACTIVATE: { from: ["SUSPENDED"], to: "ACTIVE" },
} as const;

export async function decideInstitution(actor: Actor, id: string, input: z.infer<typeof institutionDecisionSchema>) {
  requirePermission(actor, "institution:manage-registration");
  if (input.action !== "APPROVE" && !input.reason?.trim()) throw new ValidationError("A reason is required.", { reason: ["Required"] });
  const rule = DECISIONS[input.action];
  return prisma.$transaction(async (tx) => {
    const inst = await tx.institution.findFirst({ where: { AND: [{ id }, institutionScope(actor)] } });
    if (!inst) throw new NotFoundError("Institution");
    if (!(rule.from as readonly string[]).includes(inst.status)) {
      throw new InvalidTransitionError(`Cannot ${input.action.toLowerCase()} an institution that is ${inst.status.replace(/_/g, " ").toLowerCase()}.`);
    }
    const res = await tx.institution.updateMany({
      where: { id, status: inst.status },
      data: {
        status: rule.to,
        statusReason: input.reason ?? null,
        ...(input.action === "APPROVE" ? { approvedById: actor.id, approvedAt: now() } : {}),
      },
    });
    if (res.count === 0) throw new ConflictError("The institution was changed by someone else. Reload and try again.");
    if (input.action === "APPROVE" || input.action === "REACTIVATE") {
      await tx.user.updateMany({ where: { institutionId: id, status: "PENDING" }, data: { status: "ACTIVE" } });
    }
    if (input.action === "REJECT" || input.action === "SUSPEND") {
      // Suspended institutions keep their records; their users can no longer act.
      await tx.session.deleteMany({ where: { user: { institutionId: id } } });
    }
    await recordAudit(tx, actor, {
      action: `INSTITUTION_${input.action}`,
      resourceType: "Institution",
      resourceId: id,
      institutionId: id,
      before: { status: inst.status },
      after: { status: rule.to },
      reason: input.reason,
    });
    const users = await tx.user.findMany({ where: { institutionId: id }, select: { id: true } });
    await notify(tx, {
      recipientIds: users.map((u) => u.id),
      type: "INSTITUTION_REGISTRATION",
      title: `Institution ${rule.to.toLowerCase().replace("_", " ")}`,
      message: input.reason ?? "Your institution registration has been approved.",
      link: `/institutions/${id}`,
      institutionId: id,
    });
    return tx.institution.findUniqueOrThrow({ where: { id } });
  });
}
