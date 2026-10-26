// Record-level data scoping. Every list/detail query for institution-owned data is combined with
// these filters, so changing an identifier in a URL or API call cannot reach another institution's
// records (out-of-scope records are reported as "not found").
import type { Prisma } from "@prisma/client";
import type { Actor } from "./actor";
import { roleHas, type Permission } from "./permissions";
import { ForbiddenError } from "../errors";

export function requirePermission(actor: Actor, permission: Permission): void {
  if (!roleHas(actor.role, permission)) throw new ForbiddenError();
}

export function can(actor: Actor, permission: Permission): boolean {
  return roleHas(actor.role, permission);
}

/** Matches nothing — used when an actor has no data scope at all. */
const NONE = { id: { in: [] as string[] } };

export function institutionScope(actor: Actor): Prisma.InstitutionWhereInput {
  switch (actor.role) {
    case "INSTITUTION_USER":
      return actor.institutionId ? { id: actor.institutionId } : NONE;
    case "OFFICER":
      return { regionId: { in: actor.regionIds } };
    case "APPROVING_AUTHORITY":
    case "AUDITOR":
    case "ADMIN":
      return {};
    default:
      return NONE;
  }
}

export function instrumentScope(actor: Actor): Prisma.InstrumentWhereInput {
  switch (actor.role) {
    case "INSTITUTION_USER":
      return actor.institutionId ? { institutionId: actor.institutionId } : NONE;
    case "OFFICER":
      // Officers never see institution drafts — a draft is private until submitted.
      return { institution: { regionId: { in: actor.regionIds } }, status: { not: "DRAFT" } };
    case "APPROVING_AUTHORITY":
    case "AUDITOR":
      return { status: { not: "DRAFT" } };
    default:
      return NONE; // administrators do not handle financial records
  }
}

export function releaseScope(actor: Actor): Prisma.ReleaseRequestWhereInput {
  switch (actor.role) {
    case "INSTITUTION_USER":
      return actor.institutionId ? { institutionId: actor.institutionId } : NONE;
    case "OFFICER":
      return { institution: { regionId: { in: actor.regionIds } } };
    case "APPROVING_AUTHORITY":
    case "AUDITOR":
      return {};
    default:
      return NONE;
  }
}
