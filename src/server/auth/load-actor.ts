import { prisma } from "../db";
import type { Actor } from "./actor";
import type { RoleName } from "./permissions";

/** Build an Actor for a user id (used by the seed script, CLI jobs and tests — never by HTTP requests). */
export async function loadActor(userId: string): Promise<Actor> {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { officerRegions: true } });
  return {
    kind: "user",
    id: u.id,
    role: u.role as RoleName,
    name: u.name,
    email: u.email,
    institutionId: u.institutionId,
    regionIds: u.officerRegions.map((r) => r.regionId),
  };
}
