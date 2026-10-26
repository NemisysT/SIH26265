// Administration: accounts, roles, reference data. Administrative actions are audited like any
// other change; there is no interface for editing or deleting audit records.
import { z } from "zod";
import { prisma } from "../db";
import type { Actor } from "../auth/actor";
import { requirePermission } from "../auth/scope";
import { recordAudit } from "../audit";
import { hashPassword } from "../auth/password";
import { ConflictError, ForbiddenError, NotFoundError, ValidationError, isUniqueViolation } from "../errors";
import { assertUuid } from "./common";
import { passwordPolicy, requiredText, text } from "@/lib/validation";

const roles = ["INSTITUTION_USER", "OFFICER", "APPROVING_AUTHORITY", "ADMIN", "AUDITOR"] as const;

export const createUserSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(200),
  name: requiredText(120, "Name"),
  designation: text(120).optional(),
  role: z.enum(roles),
  institutionId: z.string().uuid().optional(),
  regionIds: z.array(z.string().uuid()).max(20).default([]),
  password: passwordPolicy,
});

export const updateUserSchema = z.object({
  role: z.enum(roles).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  regionIds: z.array(z.string().uuid()).max(20).optional(),
  designation: text(120).optional(),
  reason: text(500).pipe(z.string().min(3, "Give a reason for the change")),
});

export async function listUsers(actor: Actor) {
  requirePermission(actor, "admin:users");
  return prisma.user.findMany({
    orderBy: [{ role: "asc" }, { name: "asc" }],
    select: {
      id: true, email: true, name: true, designation: true, role: true, status: true, lastLoginAt: true, isDemo: true,
      institution: { select: { id: true, name: true, code: true } },
      officerRegions: { include: { region: true } },
    },
  });
}

function validateRoleShape(role: string, institutionId: string | null | undefined, regionIds: string[]) {
  if (role === "INSTITUTION_USER" && !institutionId) throw new ValidationError("Institution users must belong to an institution.", { institutionId: ["Required"] });
  if (role !== "INSTITUTION_USER" && institutionId) throw new ValidationError("Only institution users can be linked to an institution.");
  if (role === "OFFICER" && regionIds.length === 0) throw new ValidationError("Officers must be assigned at least one region.", { regionIds: ["Required"] });
}

export async function createUser(actor: Actor, input: z.infer<typeof createUserSchema>) {
  requirePermission(actor, "admin:users");
  validateRoleShape(input.role, input.institutionId, input.regionIds);
  const passwordHash = await hashPassword(input.password);
  try {
    return await prisma.$transaction(async (tx) => {
      if (input.institutionId) {
        const inst = await tx.institution.findUnique({ where: { id: input.institutionId } });
        if (!inst) throw new ValidationError("Unknown institution.");
      }
      const user = await tx.user.create({
        data: {
          email: input.email,
          name: input.name,
          designation: input.designation,
          role: input.role,
          institutionId: input.institutionId ?? null,
          passwordHash,
          status: "ACTIVE",
          officerRegions: input.role === "OFFICER" ? { create: input.regionIds.map((regionId) => ({ regionId })) } : undefined,
        },
      });
      await recordAudit(tx, actor, {
        action: "USER_CREATED",
        resourceType: "User",
        resourceId: user.id,
        institutionId: user.institutionId,
        after: { email: user.email, role: user.role, regionIds: input.regionIds },
      });
      return user;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("A user with this email already exists.");
    throw err;
  }
}

export async function updateUser(actor: Actor, id: string, input: z.infer<typeof updateUserSchema>) {
  requirePermission(actor, "admin:users");
  assertUuid(id, "User");
  if (id === actor.id && (input.role || input.status === "DISABLED")) {
    throw new ForbiddenError("Administrators cannot change their own role or disable their own account.");
  }
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { id }, include: { officerRegions: true } });
    if (!user) throw new NotFoundError("User");
    const role = input.role ?? user.role;
    const regionIds = input.regionIds ?? user.officerRegions.map((r) => r.regionId);
    validateRoleShape(role, user.institutionId, role === "OFFICER" ? regionIds : []);
    if (user.role === "ADMIN" && (role !== "ADMIN" || input.status === "DISABLED")) {
      const admins = await tx.user.count({ where: { role: "ADMIN", status: "ACTIVE" } });
      if (admins <= 1) throw new ConflictError("The last active administrator cannot be removed.");
    }
    await tx.user.update({
      where: { id },
      data: { role, status: input.status ?? user.status, designation: input.designation ?? user.designation },
    });
    if (input.regionIds || role !== "OFFICER") {
      await tx.officerRegion.deleteMany({ where: { userId: id } });
      if (role === "OFFICER") await tx.officerRegion.createMany({ data: regionIds.map((regionId) => ({ userId: id, regionId })) });
    }
    if (input.role || input.status === "DISABLED") await tx.session.deleteMany({ where: { userId: id } });
    await recordAudit(tx, actor, {
      action: "USER_UPDATED",
      resourceType: "User",
      resourceId: id,
      institutionId: user.institutionId,
      before: { role: user.role, status: user.status, regionIds: user.officerRegions.map((r) => r.regionId) },
      after: { role, status: input.status ?? user.status, regionIds: role === "OFFICER" ? regionIds : [] },
      reason: input.reason,
    });
    return tx.user.findUniqueOrThrow({ where: { id }, select: { id: true, role: true, status: true } });
  });
}

// ---------------------------------------------------------------- reference data

export const regionSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^[A-Z]{2,6}$/, "2–6 letters"),
  name: requiredText(80, "Name"),
});
export const bankSchema = z.object({
  name: requiredText(120, "Bank name"),
  shortCode: z.string().trim().toUpperCase().regex(/^[A-Z]{2,8}$/, "2–8 letters"),
  isFictional: z.boolean().default(true),
});
export const toggleSchema = z.object({ isActive: z.boolean() });

export async function createReference(actor: Actor, kind: "region" | "bank", input: unknown) {
  requirePermission(actor, "admin:reference-data");
  try {
    return await prisma.$transaction(async (tx) => {
      const created =
        kind === "region"
          ? await tx.region.create({ data: regionSchema.parse(input) })
          : await tx.bankReference.create({ data: bankSchema.parse(input) });
      await recordAudit(tx, actor, { action: `REFERENCE_${kind.toUpperCase()}_CREATED`, resourceType: kind === "region" ? "Region" : "BankReference", resourceId: created.id, after: created });
      return created;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ConflictError("An entry with this name or code already exists.");
    throw err;
  }
}

export async function toggleReference(actor: Actor, kind: "region" | "bank", id: string, isActive: boolean) {
  requirePermission(actor, "admin:reference-data");
  assertUuid(id);
  return prisma.$transaction(async (tx) => {
    const before = kind === "region" ? await tx.region.findUnique({ where: { id } }) : await tx.bankReference.findUnique({ where: { id } });
    if (!before) throw new NotFoundError();
    const updated =
      kind === "region" ? await tx.region.update({ where: { id }, data: { isActive } }) : await tx.bankReference.update({ where: { id }, data: { isActive } });
    await recordAudit(tx, actor, {
      action: `REFERENCE_${kind.toUpperCase()}_${isActive ? "ACTIVATED" : "DEACTIVATED"}`,
      resourceType: kind === "region" ? "Region" : "BankReference",
      resourceId: id,
      before: { isActive: before.isActive },
      after: { isActive },
    });
    return updated;
  });
}
